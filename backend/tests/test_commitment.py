"""Three-way parity check: this file is the Python leg. The Solidity leg
(ground truth) is contracts/scripts/printCommitmentVector.ts, which writes
sdk/golden-vector.json; the TypeScript leg is sdk/ts/verify.mjs. All three
must reproduce the same commitment hash for the same field values.
"""

import json
from pathlib import Path

from app.commitment import build_screening_commitment, schema_hash_hex

GOLDEN_VECTOR_PATH = Path(__file__).resolve().parents[2] / "sdk" / "golden-vector.json"


def test_golden_vector_matches_solidity_ground_truth():
    assert GOLDEN_VECTOR_PATH.exists(), (
        f"{GOLDEN_VECTOR_PATH} not found. Run `npm run vector` in contracts/ first "
        "to generate it from the Solidity ground truth."
    )
    vector = json.loads(GOLDEN_VECTOR_PATH.read_text())

    assert schema_hash_hex() == vector["schemaHash"], "SCHEMA_HASH mismatch between Python and Solidity"

    fields = vector["fields"]
    commitment = build_screening_commitment(
        scan_id_hash=fields["scanIdHash"],
        image_digest=fields["imageDigest"],
        model_hash=fields["modelHash"],
        risk_code=fields["riskCode"],
        recommendation_code=fields["recommendationCode"],
        confidence_bps=fields["confidenceBps"],
        quality_bps=fields["qualityBps"],
        consent_hash=fields["consentHash"],
        captured_at=fields["capturedAt"],
        salt=fields["salt"],
    )

    assert commitment == vector["expectedCommitment"], (
        "Python commitment does not match the Solidity-generated golden vector — "
        "the on-chain and off-chain hashes would disagree in production."
    )


def test_commitment_is_sensitive_to_every_field():
    base = dict(
        scan_id_hash="0x" + "11" * 32,
        image_digest="0x" + "22" * 32,
        model_hash="0x" + "33" * 32,
        risk_code=1,
        recommendation_code=2,
        confidence_bps=1000,
        quality_bps=2000,
        consent_hash="0x" + "44" * 32,
        captured_at=1700000000,
        salt="0x" + "55" * 32,
    )
    reference = build_screening_commitment(**base)

    for key, bump in [
        ("risk_code", 2),
        ("recommendation_code", 3),
        ("confidence_bps", 1001),
        ("quality_bps", 2001),
        ("captured_at", 1700000001),
    ]:
        mutated = dict(base)
        mutated[key] = bump
        assert build_screening_commitment(**mutated) != reference, f"commitment insensitive to {key}"

    mutated_salt = dict(base)
    mutated_salt["salt"] = "0x" + "66" * 32
    assert build_screening_commitment(**mutated_salt) != reference
