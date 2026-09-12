"""Smoke tests for the real + mock inference providers.

These don't assert anything about medical accuracy (this is a screening
prototype, not validated for that here) — just that the full pipeline
(decode -> quality gate -> two CNN encoders -> stacker -> calibration ->
decision) runs end to end without exploding, and that a plainly bad capture
is correctly routed to `recapture_required` instead of a fabricated result.

Skipped entirely if torch isn't installed (e.g. INFERENCE_PROVIDER=mock-only
CI environments) so this file never breaks an otherwise-passing `pytest` run.
"""

import io

import pytest

pytest.importorskip("torch")

from PIL import Image

from app.inference import MockInferenceProvider, RealInferenceProvider


def _jpeg_bytes(size, color):
    buffer = io.BytesIO()
    Image.new("RGB", size, color=color).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture(scope="module")
def valid_roi_bytes():
    # Not photorealistic, just decodable, adequately lit, and large enough
    # to clear quality_report()'s recapture gate (min side >= 96, brightness
    # in (12, 245), not >80% clipped).
    return _jpeg_bytes((300, 300), color=(180, 90, 90))


@pytest.fixture(scope="module")
def bad_roi_bytes():
    return _jpeg_bytes((10, 10), color=(2, 2, 2))  # too small AND too dark


def test_real_provider_accepts_valid_roi(valid_roi_bytes):
    provider = RealInferenceProvider(model_hash="0x" + "ab" * 32, device="cpu")
    outcome = provider.run(image_bytes=valid_roi_bytes)

    assert outcome.recapture_required is False
    result = outcome.result
    assert result is not None
    assert result.risk_code in (0, 1, 2)
    assert result.recommendation_code in (0, 1, 2)
    assert 0 <= result.confidence_bps <= 10000
    assert result.is_synthetic is False
    assert outcome.image_digest.startswith("0x")
    assert len(outcome.image_digest) == 66


def test_real_provider_rejects_bad_capture(bad_roi_bytes):
    provider = RealInferenceProvider(model_hash="0x" + "ab" * 32, device="cpu")
    outcome = provider.run(image_bytes=bad_roi_bytes)

    assert outcome.recapture_required is True
    assert outcome.result is None
    assert outcome.quality["failures"]


def test_mock_provider_still_works(valid_roi_bytes):
    provider = MockInferenceProvider(model_hash="0x" + "cd" * 32)
    outcome = provider.run(image_bytes=valid_roi_bytes)

    assert outcome.recapture_required is False
    assert outcome.result is not None
    assert outcome.result.is_synthetic is True
    assert outcome.image_digest.startswith("0x")
