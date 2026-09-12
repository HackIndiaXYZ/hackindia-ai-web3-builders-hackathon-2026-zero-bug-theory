"""Wallet challenge-response auth for sponsor/clinic BridgeKey wallets.

Not used by the (deliberately walletless) patient flow. A sponsor or clinic
proves control of an address by signing a server-issued nonce; the backend
then issues a short-lived HMAC session token scoped to that address. This is
a hackathon-scale substitute for a full session store — swap
`issue_session_token`/`verify_session_token` for real JWT/session
infrastructure before this goes anywhere beyond a demo.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time

from eth_account import Account
from eth_account.messages import encode_defunct

from .config import get_settings


def generate_nonce() -> str:
    return secrets.token_hex(16)


def build_challenge_message(address: str, nonce: str, issued_at: int) -> str:
    return (
        "AnemiaScan wallet sign-in\n"
        f"address: {address}\n"
        f"nonce: {nonce}\n"
        f"issued_at: {issued_at}\n"
        "This signature does not authorize any transaction or spend."
    )


def recover_signer(message: str, signature: str) -> str:
    encoded = encode_defunct(text=message)
    return Account.recover_message(encoded, signature=signature)


class InvalidSessionToken(Exception):
    pass


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def issue_session_token(address: str, role: str) -> str:
    settings = get_settings()
    payload = {"addr": address.lower(), "role": role, "exp": int(time.time()) + settings.session_ttl_seconds}
    payload_b64 = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = hmac.new(settings.session_secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_session_token(token: str) -> dict:
    settings = get_settings()
    try:
        payload_b64, sig = token.split(".", 1)
        expected_sig = hmac.new(
            settings.session_secret.encode("utf-8"), payload_b64.encode("ascii"), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            raise InvalidSessionToken("bad signature")
        payload = json.loads(_b64url_decode(payload_b64))
    except InvalidSessionToken:
        raise
    except Exception as err:  # noqa: BLE001 — any parse failure is an invalid token
        raise InvalidSessionToken("malformed token") from err

    if payload.get("exp", 0) < time.time():
        raise InvalidSessionToken("token expired")

    return payload
