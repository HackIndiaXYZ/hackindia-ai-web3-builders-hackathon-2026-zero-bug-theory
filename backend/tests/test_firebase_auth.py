"""Firebase ID-token verification, exercised end to end against a fake but
format-faithful Google cert endpoint.

This is the test that would have caught the bug an adversarial review found:
`_certificate_to_public_key` used to run its output through
`RSAAlgorithm.from_jwk(...)`, which expects a JWK JSON *string*. Handed a
`cryptography` public-key object instead, it raised `InvalidKeyError` on
every single call -- so `_google_public_keys()` never returned successfully
and EVERY RS256 token, real or forged, produced an uncaught 500. The auth
wall the rest of the API depends on was completely dead; every existing test
missed this because they all override `require_user` via
`app.dependency_overrides`, which never touches this code path.

These tests mint a real RSA keypair, wrap the public half in a self-signed
x509 certificate (the same PEM format Google's endpoint actually serves,
byte for byte -- `{kid: "-----BEGIN CERTIFICATE-----..."}`), monkeypatch only
the HTTP call to Google, and then drive a real signed JWT through the actual
`verify_id_token` / `require_user` code path. Nothing about the verification
logic itself is mocked.
"""

from __future__ import annotations

import datetime as dt

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from fastapi.testclient import TestClient

from app import firebase_auth
from app.config import get_settings
from app.main import app

from .fixtures import eye_scene, to_jpeg

PROJECT_ID = get_settings().firebase_project_id or "animeascan"
KID = "test-key-1"
VALID_CONSENT = "0x" + "ef" * 32


def _build_signing_material():
    """One RSA keypair, wrapped in a self-signed cert exactly like Google's."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name(
        [x509.NameAttribute(NameOID.COMMON_NAME, "securetoken.system.gserviceaccount.com")]
    )
    now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(days=1))
        .not_valid_after(now + dt.timedelta(days=3650))
        .sign(private_key, hashes.SHA256())
    )
    pem = certificate.public_bytes(serialization.Encoding.PEM).decode("utf-8")
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")
    return private_pem, pem


PRIVATE_KEY_PEM, CERTIFICATE_PEM = _build_signing_material()


def _mint_token(
    *,
    kid: str = KID,
    aud: str = PROJECT_ID,
    iss: str | None = None,
    sub: str = "uid-123",
    exp_delta: dt.timedelta = dt.timedelta(hours=1),
    iat_delta: dt.timedelta = -dt.timedelta(minutes=1),
    algorithm: str = "RS256",
    key: str = PRIVATE_KEY_PEM,
) -> str:
    import jwt

    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "aud": aud,
        "iss": iss if iss is not None else f"https://securetoken.google.com/{PROJECT_ID}",
        "sub": sub,
        "exp": now + exp_delta,
        "iat": now + iat_delta,
    }
    return jwt.encode(payload, key, algorithm=algorithm, headers={"kid": kid})


class _FakeCertResponse:
    def __init__(self, body: dict, headers: dict | None = None):
        self._body = body
        self.headers = headers or {"cache-control": "max-age=3600"}

    def raise_for_status(self):
        pass

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _reset_cert_cache(monkeypatch):
    """The cert cache is process-global; every test must start from empty
    so a bug in one case (e.g. a broken response) cannot be masked by a
    previous test's cached result."""
    firebase_auth._CERT_CACHE["keys"] = {}
    firebase_auth._CERT_CACHE["expires_at"] = 0.0
    yield
    firebase_auth._CERT_CACHE["keys"] = {}
    firebase_auth._CERT_CACHE["expires_at"] = 0.0


@pytest.fixture()
def google_certs(monkeypatch):
    """Point the real cert-fetching code at our self-signed certificate."""

    def fake_get(url, timeout=10.0):
        assert url == firebase_auth.GOOGLE_CERT_URL
        return _FakeCertResponse({KID: CERTIFICATE_PEM})

    monkeypatch.setattr(firebase_auth.httpx, "get", fake_get)


# ---------------------------------------------------------------------------
# The bug itself: fetching keys must not raise.
# ---------------------------------------------------------------------------


def test_google_public_keys_does_not_raise(google_certs):
    """This call alone reproduces the original bug: InvalidKeyError on every
    invocation, because the cryptography key object was fed to
    RSAAlgorithm.from_jwk (which wants a JWK JSON string)."""
    keys = firebase_auth._google_public_keys()
    assert KID in keys
    # The returned object must be usable as a jwt.decode `key=` argument
    # directly -- i.e. a cryptography public key object, not a JWK string.
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey

    assert isinstance(keys[KID], RSAPublicKey)


def test_cert_cache_is_reused_within_ttl(google_certs, monkeypatch):
    calls = {"n": 0}
    real_get = firebase_auth.httpx.get

    def counting_get(url, timeout=10.0):
        calls["n"] += 1
        return real_get(url, timeout=timeout)

    monkeypatch.setattr(firebase_auth.httpx, "get", counting_get)
    firebase_auth._google_public_keys()
    firebase_auth._google_public_keys()
    assert calls["n"] == 1, "the cache should avoid refetching within the TTL"


# ---------------------------------------------------------------------------
# A real, validly-signed token must verify successfully end to end.
# ---------------------------------------------------------------------------


def test_valid_token_is_accepted(google_certs):
    token = _mint_token(sub="uid-abc")
    claims = firebase_auth.verify_id_token(token)
    assert claims["sub"] == "uid-abc"
    assert claims["aud"] == PROJECT_ID


def test_require_user_dependency_accepts_a_bearer_token(google_certs):
    token = _mint_token(sub="uid-xyz")
    claims = firebase_auth.require_user(authorization=f"Bearer {token}")
    assert claims["sub"] == "uid-xyz"


# ---------------------------------------------------------------------------
# Every rejection path must fail closed with 401, never 500.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "mutate,expected_substring",
    [
        (lambda: _mint_token(aud="some-other-project"), None),
        (lambda: _mint_token(iss="https://securetoken.google.com/some-other-project"), None),
        (lambda: _mint_token(exp_delta=dt.timedelta(minutes=-5)), "expired"),
        (lambda: _mint_token(kid="unknown-kid"), "unrecognised"),
        (lambda: _mint_token(sub=""), None),
    ],
    ids=["wrong-aud", "wrong-iss", "expired", "unknown-kid", "empty-sub"],
)
def test_invalid_tokens_are_rejected_with_401_not_500(google_certs, mutate, expected_substring):
    token = mutate()
    with pytest.raises(firebase_auth.AuthError) as excinfo:
        firebase_auth.verify_id_token(token)
    assert excinfo.value.status_code == 401
    if expected_substring:
        assert expected_substring in str(excinfo.value.detail).lower()


def test_alg_none_is_rejected(google_certs):
    import jwt

    now = dt.datetime.now(dt.timezone.utc)
    forged = jwt.api_jws.encode(
        __import__("json").dumps(
            {
                "aud": PROJECT_ID,
                "iss": f"https://securetoken.google.com/{PROJECT_ID}",
                "sub": "attacker",
                "exp": (now + dt.timedelta(hours=1)).timestamp(),
                "iat": now.timestamp(),
            }
        ).encode("utf-8"),
        key=None,
        algorithm="none",
        headers={"kid": KID},
    )
    with pytest.raises(firebase_auth.AuthError) as excinfo:
        firebase_auth.verify_id_token(forged)
    assert excinfo.value.status_code == 401


def test_hs256_signed_with_public_cert_is_rejected(google_certs):
    """The classic RS256->HS256 algorithm-confusion attack: sign with HS256
    using the (public!) certificate PEM as the HMAC secret, hoping a naive
    verifier will accept it because it "matches" the same key material.

    PyJWT's own `jwt.encode(..., algorithm="HS256")` refuses to even mint
    this token (it rejects a PEM-shaped string as an HMAC secret), which is
    itself a good sign -- but it means the attack has to be constructed by
    hand, bypassing that guard, to prove the RECEIVING side rejects it too.
    """
    import base64
    import hashlib
    import hmac
    import json

    def b64url(data: bytes) -> bytes:
        return base64.urlsafe_b64encode(data).rstrip(b"=")

    now = dt.datetime.now(dt.timezone.utc)
    header = b64url(json.dumps({"alg": "HS256", "kid": KID}).encode())
    payload = b64url(
        json.dumps(
            {
                "aud": PROJECT_ID,
                "iss": f"https://securetoken.google.com/{PROJECT_ID}",
                "sub": "attacker",
                "exp": int((now + dt.timedelta(hours=1)).timestamp()),
                "iat": int(now.timestamp()),
            }
        ).encode()
    )
    signing_input = header + b"." + payload
    signature = b64url(
        hmac.new(CERTIFICATE_PEM.encode("utf-8"), signing_input, hashlib.sha256).digest()
    )
    forged = (signing_input + b"." + signature).decode("ascii")

    with pytest.raises(firebase_auth.AuthError) as excinfo:
        firebase_auth.verify_id_token(forged)
    assert excinfo.value.status_code == 401


def test_token_signed_by_a_different_key_is_rejected(google_certs):
    """A well-formed token, right kid, but signed by an attacker's own key."""
    attacker_private_pem, _ = _build_signing_material()
    token = _mint_token(key=attacker_private_pem)  # kid still points at the real cert
    with pytest.raises(firebase_auth.AuthError) as excinfo:
        firebase_auth.verify_id_token(token)
    assert excinfo.value.status_code == 401


# ---------------------------------------------------------------------------
# Full HTTP round trip: a real token reaches the screening endpoint itself.
# ---------------------------------------------------------------------------


def test_valid_token_reaches_the_screening_endpoint(google_certs):
    app.dependency_overrides.clear()  # ensure the REAL require_user runs
    token = _mint_token(sub="uid-http")
    with TestClient(app) as client:
        response = client.post(
            "/inference/predict",
            files={"image": ("scan.jpg", to_jpeg(eye_scene(seed=3)), "image/jpeg")},
            data={"consent_hash": VALID_CONSENT},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 201, response.text


def test_forged_token_gets_401_not_500_over_http(google_certs):
    app.dependency_overrides.clear()
    token = _mint_token(kid="does-not-exist")
    with TestClient(app) as client:
        response = client.post(
            "/inference/predict",
            files={"image": ("scan.jpg", to_jpeg(eye_scene(seed=3)), "image/jpeg")},
            data={"consent_hash": VALID_CONSENT},
            headers={"Authorization": f"Bearer {token}"},
        )
    assert response.status_code == 401, response.text
    assert response.headers["content-type"].startswith("application/json")
