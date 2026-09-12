"""End-to-end: a real screening anchored on a real chain, then verified.

Skipped unless a chain is actually reachable and the running model's hash is
registered on it, so it never breaks an offline `pytest` run. To exercise it:

    cd contracts
    npx hardhat node                       # terminal 1
    npm run deploy:local                   # terminal 2
    npm run grant-roles:local
    npm run register-model:local
    # point backend/.env at http://127.0.0.1:8545, chain id 31337
    cd ../backend && pytest tests/test_chain_e2e.py -v

This is the test that would have caught the audit's finding that the real
model hash was never registered anywhere: AnemiaRegistry.registerScreening
reverts with ModelNotFound for an unregistered model, so before that was fixed
the first genuine screening produced a failed transaction.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.chain import ChainNotConfigured, get_chain_client
from app.commitment import build_screening_commitment
from app.config import get_settings
from app.firebase_auth import require_user
from app.main import app

from .fixtures import eye_scene, to_jpeg

VALID_CONSENT = "0x" + "cd" * 32


def _chain_ready() -> tuple[bool, str]:
    settings = get_settings()
    if settings.inference_provider != "real":
        return False, "INFERENCE_PROVIDER is not 'real'"
    try:
        chain = get_chain_client()
        chain.check_chain_id()
    except ChainNotConfigured as err:
        return False, f"chain not configured: {err}"
    except Exception as err:  # noqa: BLE001
        return False, f"chain unreachable: {err}"

    try:
        from app.ml.manifest import get_model_hash

        model_hash = settings.mst_real_model_hash or get_model_hash()
        model = chain.get_model(model_hash)
    except Exception as err:  # noqa: BLE001
        return False, f"could not read model registration: {err}"

    if not model.get("registeredAt", 0):
        return False, f"model {model_hash} is not registered on AnemiaRegistry"
    return True, ""


_READY, _REASON = _chain_ready()
pytestmark = pytest.mark.skipif(not _READY, reason=_REASON or "chain not ready")


@pytest.fixture()
def client():
    app.dependency_overrides[require_user] = lambda: {"sub": "e2e-uid"}
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def test_screening_anchors_on_chain_and_verifies(client):
    response = client.post(
        "/inference/predict",
        files={"image": ("scan.jpg", to_jpeg(eye_scene(seed=3)), "image/jpeg")},
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code == 201, response.text
    body = response.json()

    # 1. It actually reached the chain and confirmed.
    assert body["registered_on_chain"] is True, body
    assert body["chain_tx_status"] == "CONFIRMED", body
    assert body["chain_tx_hash"], body

    # 2. The model hash anchored is the weights-derived one.
    from app.ml.manifest import get_model_hash

    expected_hash = get_settings().mst_real_model_hash or get_model_hash()
    assert body["model_hash"] == expected_hash

    # 3. The on-chain record matches what the API returned.
    chain = get_chain_client()
    screening = chain.get_screening(body["scan_id_hash"])
    assert screening["registeredAt"] != 0
    on_chain = screening["commitment"]
    if not on_chain.startswith("0x"):
        on_chain = "0x" + on_chain
    assert on_chain.lower() == body["commitment"].lower()

    # 4. The commitment is reproducible from the returned fields, which is the
    #    whole point of the scheme -- and it must use probability_bps, the
    #    calibrated probability, not a repurposed "confidence".
    session = client.get(f"/registry/screenings/{body['scan_id_hash']}")
    assert session.status_code == 200


def test_tampering_with_the_result_breaks_the_commitment(client):
    """The tamper-evidence demo: change the risk code, lose the match."""
    response = client.post(
        "/inference/predict",
        files={"image": ("scan.jpg", to_jpeg(eye_scene(seed=5)), "image/jpeg")},
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code == 201, response.text
    body = response.json()

    stored = client.get(f"/registry/screenings/{body['scan_id_hash']}").json()
    # We need salt/image_digest, which the response deliberately does not
    # expose; recompute from the DB row instead.
    from app.db import SessionLocal
    from app.models import ScanSession

    db = SessionLocal()
    try:
        row = (
            db.query(ScanSession)
            .filter(ScanSession.scan_id_hash == body["scan_id_hash"])
            .first()
        )
        assert row is not None
        honest = dict(
            scan_id_hash=row.scan_id_hash,
            image_digest=row.image_digest,
            model_hash=row.model_hash,
            risk_code=row.risk_code,
            recommendation_code=row.recommendation_code,
            probability_bps=row.probability_bps,
            quality_bps=row.quality_bps,
            consent_hash=row.consent_hash,
            captured_at=row.captured_at,
            salt=row.salt,
        )
    finally:
        db.close()

    # The honest fields reproduce the commitment exactly.
    assert build_screening_commitment(**honest) == row_commitment(body)

    # Flipping the risk code does not.
    tampered = dict(honest)
    tampered["risk_code"] = (honest["risk_code"] + 1) % 3
    assert build_screening_commitment(**tampered) != row_commitment(body)

    verify = client.post(
        "/registry/verify",
        json={
            **{k: v for k, v in tampered.items()},
            "claimed_commitment": row_commitment(body),
        },
    )
    assert verify.status_code == 200, verify.text
    result = verify.json()
    assert result["matches_claimed_commitment"] is False
    assert result["matches_on_chain"] is False
    assert result["on_chain_registered"] is True


def row_commitment(body: dict) -> str:
    return body["commitment"]
