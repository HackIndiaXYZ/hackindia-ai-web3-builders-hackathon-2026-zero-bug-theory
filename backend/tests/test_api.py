"""HTTP-surface tests for the screening endpoint.

Each of these locks down a hole the audit found by probing the live service:

  * a non-image upload returned 201 (mock) or a 503 "model unavailable" (real),
    which the frontend showed as a service outage rather than a bad file
  * a malformed consent_hash raised an unhandled ValueError and returned a 500
    with a plain-text "Internal Server Error" body the client could not parse
  * there was no upload size limit at all (a 28.76MB JPEG was accepted)
  * there was no authentication: anyone could POST straight to the backend
  * a refused capture returned no machine-readable reason, so the app could
    only say "inconclusive"

Auth is exercised through FastAPI's dependency_overrides rather than a
test-only backdoor in the app, so the production code path has no bypass.
"""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.firebase_auth import require_user
from app.main import app

from .fixtures import eye_scene, to_jpeg

VALID_CONSENT = "0x" + "ab" * 32
FAKE_USER = {"sub": "test-uid", "email": "tester@example.com"}


@pytest.fixture()
def client():
    """A client whose requests are already authenticated."""
    app.dependency_overrides[require_user] = lambda: FAKE_USER
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def anon_client():
    """A client with the real auth dependency in place."""
    app.dependency_overrides.clear()
    with TestClient(app) as test_client:
        yield test_client


def _files(payload: bytes, name: str = "scan.jpg", content_type: str = "image/jpeg"):
    return {"image": (name, payload, content_type)}


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


def test_screening_requires_authentication(anon_client):
    response = anon_client.post(
        "/inference/predict",
        files=_files(to_jpeg(eye_scene(seed=3))),
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code in (401, 403), response.text
    assert "detail" in response.json()


def test_bad_bearer_token_is_rejected(anon_client):
    response = anon_client.post(
        "/inference/predict",
        files=_files(to_jpeg(eye_scene(seed=3))),
        data={"consent_hash": VALID_CONSENT},
        headers={"Authorization": "Bearer not-a-real-token"},
    )
    assert response.status_code in (401, 403, 503), response.text


# ---------------------------------------------------------------------------
# Upload validation
# ---------------------------------------------------------------------------


def test_non_image_upload_is_rejected_as_client_error(client):
    response = client.post(
        "/inference/predict",
        files=_files(b"this is not an image at all", "notes.txt", "text/plain"),
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code == 415, response.text
    assert "detail" in response.json()


def test_image_extension_but_text_content_is_rejected(client):
    """Content-Type is client-controlled, so the bytes are sniffed too."""
    response = client.post(
        "/inference/predict",
        files=_files(b"NOT-A-JPEG-AT-ALL" * 10, "scan.jpg", "image/jpeg"),
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code == 415, response.text


def test_oversized_upload_is_rejected(client):
    """No size cap existed; a 28.76MB upload was accepted and fully buffered.

    The payload has to be NOISY to be large: a flat 5000x5000 JPEG compresses
    to about 392KB, which is nowhere near the limit. A noisy 4000x4000 at
    quality 98 is ~24.8MB, which is the realistic shape of an oversized phone
    photo anyway.
    """
    import numpy as np

    rng = np.random.default_rng(1)
    noisy = Image.fromarray(rng.integers(0, 256, (4000, 4000, 3), dtype=np.uint8))
    buffer = io.BytesIO()
    noisy.save(buffer, format="JPEG", quality=98)
    payload = buffer.getvalue()
    assert len(payload) > 12 * 1024 * 1024, "fixture is not actually oversized"

    response = client.post(
        "/inference/predict",
        files=_files(payload),
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code == 413, response.status_code


def test_empty_upload_is_rejected(client):
    response = client.post(
        "/inference/predict",
        files=_files(b""),
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code in (400, 415), response.text


# ---------------------------------------------------------------------------
# consent_hash validation -- these used to be 500s
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "consent_hash",
    ["not-a-hash", "0x1234", "", "0x" + "zz" * 32, "ab" * 32],
    ids=["garbage", "too-short", "empty", "non-hex", "missing-0x"],
)
def test_malformed_consent_hash_is_422_not_500(client, consent_hash):
    response = client.post(
        "/inference/predict",
        files=_files(to_jpeg(eye_scene(seed=3))),
        data={"consent_hash": consent_hash},
    )
    assert response.status_code == 422, response.status_code
    # And the body is JSON the client can actually read.
    assert response.headers["content-type"].startswith("application/json")
    assert "detail" in response.json()


def test_verify_endpoint_rejects_malformed_hex_as_422(anon_client):
    response = anon_client.post(
        "/registry/verify",
        json={
            "scan_id_hash": "nope",
            "image_digest": "0x1234",
            "model_hash": VALID_CONSENT,
            "risk_code": 1,
            "recommendation_code": 1,
            "probability_bps": 5000,
            "quality_bps": 5000,
            "consent_hash": VALID_CONSENT,
            "captured_at": 1760000000,
            "salt": VALID_CONSENT,
            "claimed_commitment": VALID_CONSENT,
        },
    )
    assert response.status_code == 422, response.status_code
    assert response.headers["content-type"].startswith("application/json")


# ---------------------------------------------------------------------------
# The refusal contract
# ---------------------------------------------------------------------------


def test_off_target_image_returns_422_with_reasons(client):
    """A grey wall must come back as a refusal the user can act on."""
    grey = io.BytesIO()
    Image.new("RGB", (400, 400), (128, 128, 128)).save(grey, format="JPEG")

    response = client.post(
        "/inference/predict",
        files=_files(grey.getvalue()),
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code == 422, response.text
    detail = response.json()["detail"]
    assert detail["decision"] == "recapture_required"
    assert detail["reasons"], "a refusal must name at least one reason"
    assert detail["message"].strip(), "a refusal must carry a user-facing message"
    # Crucially: no score anywhere in the body.
    assert "screening_probability" not in detail
    assert "probability_bps" not in detail


# ---------------------------------------------------------------------------
# The success contract
# ---------------------------------------------------------------------------


def test_successful_screening_returns_every_spec_field(client):
    response = client.post(
        "/inference/predict",
        files=_files(to_jpeg(eye_scene(seed=3))),
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code == 201, response.text
    body = response.json()

    for field in (
        "scan_session_id",
        "scan_id_hash",
        "commitment",
        "model_hash",
        "probability_bps",
        "quality_bps",
        "model_output",
        "quality",
        "roi",
        "gate",
        "registered_on_chain",
    ):
        assert field in body, f"missing {field}"

    model = body["model_output"]
    for field in (
        "decision",
        "risk_category",
        "screening_probability",
        "operating_threshold",
        "uncertainty_margin",
        "candidate_probabilities",
        "candidate_thresholds",
        "model_disagreement",
        "near_threshold",
        "fusion_gate_weights",
        "model_version",
    ):
        assert field in model, f"missing model_output.{field}"

    assert model["decision"] in {"lower_risk", "higher_risk", "uncertain"}
    assert 0.0 < model["screening_probability"] < 1.0
    assert model["operating_threshold"] == pytest.approx(0.20755079254891556)
    assert len(model["candidate_probabilities"]) == 2
    # quality_bps must be a measured value, not the old hardcoded 10000.
    assert 0 < body["quality_bps"] < 10000
    # The ROI stage ran and actually masked something out.
    assert body["roi"]["located"] is True
    assert body["gate"]["accepted"] is True


def test_model_info_endpoint_reports_identity(anon_client):
    response = anon_client.get("/inference/model")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model_hash"].startswith("0x")
    assert len(body["model_hash"]) == 66
    if body["provider"] == "real":
        assert body["operating_threshold"] == pytest.approx(0.20755079254891556)
        assert body["assets"], "the asset manifest must be reported"
        for asset in body["assets"]:
            assert len(asset["sha256"]) == 64


def test_registry_alias_still_works(client):
    response = client.post(
        "/registry/screenings",
        files=_files(to_jpeg(eye_scene(seed=5))),
        data={"consent_hash": VALID_CONSENT},
    )
    assert response.status_code == 201, response.text


def test_explain_reports_unavailable_rather_than_inventing_text(client):
    """With no GEMINI_API_KEY the explainer must NOT fabricate an explanation."""
    response = client.post(
        "/inference/explain",
        json={
            "decision": "uncertain",
            "risk_category": "Uncertain",
            "screening_probability": 0.21,
            "operating_threshold": 0.2076,
            "uncertainty_margin": 0.0405,
            "candidate_probabilities": {"logistic_stacker": 0.21, "regularized_gated_fusion": 0.3},
            "model_disagreement": False,
            "near_threshold": True,
            "quality_bps": 6000,
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    if not body["available"]:
        assert body["explanation"] is None
        assert body["reason"]
