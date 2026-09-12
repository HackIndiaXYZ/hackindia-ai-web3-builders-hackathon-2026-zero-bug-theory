"""CarePass token format: ANEMIASCAN-CAREPASS|1|<base64url-secret>

The secret is a random 32-byte value. Its keccak256 (via the same
`keccak256(abi.encode(bytes32))` scheme CarePool.redeemCarePass uses) is the
`passHash` stored on-chain at issuance time. Whoever presents the decoded
secret to /carepool/passes/{token}/redeem can redeem the pass — treat the
token as a bearer credential (like a gift-card code), not public data.
"""

import base64
import os

from eth_abi import encode
from eth_utils import keccak

TOKEN_PREFIX = "ANEMIASCAN-CAREPASS"
TOKEN_VERSION = "1"


def generate_secret() -> str:
    """Returns a fresh random 32-byte secret as a 0x-prefixed hex string."""
    return "0x" + os.urandom(32).hex()


def pass_hash_of(secret_hex: str) -> str:
    """Mirrors CarePool.sol: keccak256(abi.encode(bytes32 secret))."""
    secret_bytes = bytes.fromhex(secret_hex.removeprefix("0x"))
    if len(secret_bytes) != 32:
        raise ValueError("secret must be 32 bytes")
    encoded = encode(["bytes32"], [secret_bytes])
    return "0x" + keccak(encoded).hex()


def encode_token(secret_hex: str) -> str:
    secret_bytes = bytes.fromhex(secret_hex.removeprefix("0x"))
    b64 = base64.urlsafe_b64encode(secret_bytes).rstrip(b"=").decode("ascii")
    return f"{TOKEN_PREFIX}|{TOKEN_VERSION}|{b64}"


def decode_token(token: str) -> str:
    """Returns the 0x-prefixed secret hex, or raises ValueError."""
    parts = token.strip().split("|")
    if len(parts) != 3 or parts[0] != TOKEN_PREFIX:
        raise ValueError("not an AnemiaScan CarePass token")
    if parts[1] != TOKEN_VERSION:
        raise ValueError(f"unsupported CarePass token version {parts[1]!r}")

    b64 = parts[2]
    padding = "=" * (-len(b64) % 4)
    try:
        secret_bytes = base64.urlsafe_b64decode(b64 + padding)
    except Exception as err:  # noqa: BLE001 — surface as a validation error
        raise ValueError("malformed CarePass token payload") from err

    if len(secret_bytes) != 32:
        raise ValueError("CarePass token secret must decode to 32 bytes")

    return "0x" + secret_bytes.hex()
