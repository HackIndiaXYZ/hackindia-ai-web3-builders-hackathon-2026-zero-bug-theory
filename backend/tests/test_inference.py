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

from .fixtures import eye_scene, to_jpeg


def _jpeg_bytes(size, color):
    buffer = io.BytesIO()
    Image.new("RGB", size, color=color).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture(scope="module")
def valid_roi_bytes():
    # A synthetic eye scene with an everted lower lid, not a flat colour patch.
    #
    # This fixture used to be `Image.new("RGB", (300, 300), (180, 90, 90))` --
    # a single flat colour. That cleared the old brightness/size quality gate
    # and the test asserted only `risk_code in (0, 1, 2)`, so it passed while
    # the service was happily scoring featureless images as elevated risk. A
    # flat patch is now correctly REFUSED (degenerate_input +
    # implausible_chroma + out_of_distribution), so the accept path has to be
    # exercised with something that actually contains conjunctiva.
    return to_jpeg(eye_scene(seed=3))


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
    assert 0 <= result.probability_bps <= 10000
    assert result.is_synthetic is False
    assert outcome.image_digest.startswith("0x")
    assert len(outcome.image_digest) == 66


def test_real_provider_rejects_bad_capture(bad_roi_bytes):
    provider = RealInferenceProvider(model_hash="0x" + "ab" * 32, device="cpu")
    outcome = provider.run(image_bytes=bad_roi_bytes)

    assert outcome.recapture_required is True
    assert outcome.result is None
    assert outcome.quality["failures"]


def test_real_provider_refuses_a_flat_colour_patch():
    """The old "valid ROI" fixture: a flat patch must never be scored."""
    provider = RealInferenceProvider(model_hash="0x" + "ab" * 32, device="cpu")
    outcome = provider.run(image_bytes=_jpeg_bytes((300, 300), color=(180, 90, 90)))

    assert outcome.recapture_required is True
    assert outcome.result is None


def test_mock_provider_still_works(valid_roi_bytes):
    provider = MockInferenceProvider(model_hash="0x" + "cd" * 32)
    outcome = provider.run(image_bytes=valid_roi_bytes)

    assert outcome.recapture_required is False
    assert outcome.result is not None
    assert outcome.result.is_synthetic is True
    assert outcome.image_digest.startswith("0x")
