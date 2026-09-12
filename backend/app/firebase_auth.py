"""Firebase ID-token verification for the screening endpoint.

The app gates its UI behind Google sign-in, but the screening endpoint itself
had no authentication at all: anyone could POST an image straight to the
backend and have it scored, anchored on-chain under the service's own
ATTESTER_ROLE key, and written to the database. Firebase was decorative.

This verifies the ID token properly, and without needing a service-account
key file. Google publishes the x509 certificates for the `securetoken` signing
key set; we fetch them (honouring the Cache-Control max-age they ship with),
verify the RS256 signature against the cert matching the token's `kid`, and
then check every claim Firebase specifies for a session cookie / ID token:

  alg  must be RS256
  aud  must equal the Firebase project id
  iss  must equal https://securetoken.google.com/<project id>
  exp  must be in the future
  iat  must be in the past
  sub  must be a non-empty string -- this is the user's uid

Checking `aud` is what stops a token minted for a *different* Firebase project
being replayed here, which is the failure mode that makes naive JWT checks
useless.
"""

from __future__ import annotations

import logging
import threading
import time

import httpx
import jwt
from fastapi import Depends, Header, HTTPException

from .config import get_settings

logger = logging.getLogger("anemiascan.auth")

GOOGLE_CERT_URL = (
    "https://www.googleapis.com/robot/v1/metadata/x509/"
    "securetoken@system.gserviceaccount.com"
)
ISSUER_TEMPLATE = "https://securetoken.google.com/{project_id}"

# Fall back to an hour if Google's response carries no usable Cache-Control.
DEFAULT_CERT_TTL_SECONDS = 3600
_CERT_LOCK = threading.Lock()
_CERT_CACHE: dict[str, object] = {"keys": {}, "expires_at": 0.0}


class AuthError(HTTPException):
    def __init__(self, detail: str, status_code: int = 401):
        super().__init__(status_code=status_code, detail=detail)


def _parse_max_age(cache_control: str | None) -> int:
    if not cache_control:
        return DEFAULT_CERT_TTL_SECONDS
    for part in cache_control.split(","):
        part = part.strip()
        if part.startswith("max-age="):
            try:
                return max(60, int(part.split("=", 1)[1]))
            except ValueError:
                break
    return DEFAULT_CERT_TTL_SECONDS


def _google_public_keys() -> dict:
    """Google's current securetoken signing certificates, cached until expiry."""
    now = time.time()
    with _CERT_LOCK:
        if _CERT_CACHE["keys"] and now < float(_CERT_CACHE["expires_at"]):
            return _CERT_CACHE["keys"]  # type: ignore[return-value]

    try:
        response = httpx.get(GOOGLE_CERT_URL, timeout=10.0)
        response.raise_for_status()
        certificates = response.json()
    except Exception as err:  # noqa: BLE001 — surfaced as a 503, never a 500
        # Serve a stale cache rather than locking everyone out on a blip.
        with _CERT_LOCK:
            if _CERT_CACHE["keys"]:
                logger.warning("using stale Google certs: %s", err)
                return _CERT_CACHE["keys"]  # type: ignore[return-value]
        raise AuthError(
            "Cannot reach Google's token-signing certificates right now.", 503
        ) from err

    keys = {kid: _certificate_to_public_key(pem) for kid, pem in certificates.items()}
    with _CERT_LOCK:
        _CERT_CACHE["keys"] = keys
        _CERT_CACHE["expires_at"] = time.time() + _parse_max_age(
            response.headers.get("cache-control")
        )
    return keys


def _certificate_to_public_key(pem: str):
    """Extract the RSA public key from an x509 certificate PEM.

    `jwt.decode(..., key=<this object>, algorithms=["RS256"])` accepts a
    `cryptography` public-key object directly (PyJWT's `RSAAlgorithm.
    prepare_key` special-cases `isinstance(key, self._crypto_key_types)` and
    returns it as-is) -- so this is handed straight to `jwt.decode` in
    `verify_id_token` below.

    An earlier version of this function returned the same object but then
    passed it through `RSAAlgorithm.from_jwk(...)`, which expects a JWK JSON
    *string*, not a key object. That raised `InvalidKeyError: Key is not
    valid JSON` on every call, so `_google_public_keys()` never returned
    successfully and every RS256 token -- real or forged -- produced an
    uncaught 500. The auth wall was completely dead in production. Verified
    by reproducing the crash before this fix and confirming its
    disappearance after (backend/tests/test_firebase_auth.py builds a
    self-signed certificate matching Google's exact format and round-trips a
    real token through this function end-to-end).
    """
    from cryptography.x509 import load_pem_x509_certificate

    return load_pem_x509_certificate(pem.encode("utf-8")).public_key()


def verify_id_token(token: str) -> dict:
    """Verify a Firebase ID token and return its claims. Raises AuthError."""
    settings = get_settings()
    project_id = settings.firebase_project_id
    if not project_id:
        raise AuthError(
            "Server is not configured to verify sign-in (FIREBASE_PROJECT_ID is "
            "unset). See backend/.env.example.",
            503,
        )

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError as err:
        raise AuthError("Malformed sign-in token.") from err

    if header.get("alg") != "RS256":
        raise AuthError("Unexpected token signing algorithm.")

    kid = header.get("kid")
    keys = _google_public_keys()
    if not kid or kid not in keys:
        raise AuthError("Sign-in token was signed by an unrecognised key.")

    try:
        claims = jwt.decode(
            token,
            key=keys[kid],
            algorithms=["RS256"],
            audience=project_id,
            issuer=ISSUER_TEMPLATE.format(project_id=project_id),
            options={"require": ["exp", "iat", "aud", "iss", "sub"]},
        )
    except jwt.ExpiredSignatureError as err:
        raise AuthError("Your session has expired. Please sign in again.") from err
    except jwt.PyJWTError as err:
        raise AuthError(f"Sign-in token rejected: {err}") from err

    subject = claims.get("sub")
    if not isinstance(subject, str) or not subject:
        raise AuthError("Sign-in token has no subject.")
    return claims


def _extract_bearer(authorization: str | None) -> str:
    if not authorization:
        raise AuthError("Sign-in required to submit a screening.")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError("Expected an 'Authorization: Bearer <id token>' header.")
    return token.strip()


def require_user(authorization: str | None = Header(default=None)) -> dict:
    """FastAPI dependency: the verified Firebase user for this request.

    Returns the token claims; `sub` is the Firebase uid. NOTE that the uid is
    deliberately NOT persisted with the screening — the privacy boundary in
    docs/DEPLOYMENT.md keeps scan records unlinked from identity. It is used
    only to authorise the call and to rate-limit abuse.
    """
    return verify_id_token(_extract_bearer(authorization))


def optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    """Same, but tolerates an absent header. Used where auth is informational."""
    if not authorization:
        return None
    try:
        return verify_id_token(_extract_bearer(authorization))
    except HTTPException:
        return None


CurrentUser = Depends(require_user)
