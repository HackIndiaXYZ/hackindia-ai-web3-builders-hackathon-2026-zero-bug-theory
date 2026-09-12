"""ANEMIASCAN_SCREENING_COMMITMENT_V1 — the canonical commitment hash.

Must match, byte for byte, AnemiaRegistry.hashScreeningCommitment in
contracts/contracts/AnemiaRegistry.sol (the ground truth — it's what
actually runs on-chain). Cross-checked against sdk/golden-vector.json in
tests/test_commitment.py; do not change the field list, order, or types
here without regenerating that vector (`npm run vector` in contracts/) and
updating both this module and sdk/ts/commitment.mjs together.

Uses `eth_abi.encode` (the Python equivalent of Solidity's `abi.encode`),
never packed/concatenated encoding — packed encoding is ambiguous for a
struct mixing dynamic-width-adjacent fixed types like this one.
"""

from eth_abi import encode
from eth_utils import keccak

# keccak256("ANEMIASCAN_SCREENING_COMMITMENT_V1") — must equal
# AnemiaRegistry.SCHEMA_HASH() on chain.
SCHEMA_TAG = "ANEMIASCAN_SCREENING_COMMITMENT_V1"
SCHEMA_HASH = keccak(text=SCHEMA_TAG)

_TYPES = [
    "bytes32",  # schemaHash
    "bytes32",  # scanIdHash
    "bytes32",  # imageDigest
    "bytes32",  # modelHash
    "uint8",  # riskCode
    "uint8",  # recommendationCode
    "uint16",  # confidenceBps
    "uint16",  # qualityBps
    "bytes32",  # consentHash
    "uint64",  # capturedAt
    "bytes32",  # salt
]


def _to_bytes32(value: str | bytes) -> bytes:
    if isinstance(value, bytes):
        b = value
    else:
        b = bytes.fromhex(value.removeprefix("0x"))
    if len(b) != 32:
        raise ValueError(f"expected 32 bytes, got {len(b)}")
    return b


def _to_hex(value: bytes) -> str:
    return "0x" + value.hex()


def build_screening_commitment(
    *,
    scan_id_hash: str,
    image_digest: str,
    model_hash: str,
    risk_code: int,
    recommendation_code: int,
    confidence_bps: int,
    quality_bps: int,
    consent_hash: str,
    captured_at: int,
    salt: str,
) -> str:
    """Returns the 0x-prefixed commitment hash for the given fields."""
    if not (0 <= risk_code <= 255):
        raise ValueError("riskCode must fit uint8")
    if not (0 <= recommendation_code <= 255):
        raise ValueError("recommendationCode must fit uint8")
    if not (0 <= confidence_bps <= 65535):
        raise ValueError("confidenceBps must fit uint16")
    if not (0 <= quality_bps <= 65535):
        raise ValueError("qualityBps must fit uint16")
    if not (0 <= captured_at <= 2**64 - 1):
        raise ValueError("capturedAt must fit uint64")

    encoded = encode(
        _TYPES,
        [
            SCHEMA_HASH,
            _to_bytes32(scan_id_hash),
            _to_bytes32(image_digest),
            _to_bytes32(model_hash),
            risk_code,
            recommendation_code,
            confidence_bps,
            quality_bps,
            _to_bytes32(consent_hash),
            captured_at,
            _to_bytes32(salt),
        ],
    )
    return _to_hex(keccak(encoded))


def schema_hash_hex() -> str:
    return _to_hex(SCHEMA_HASH)
