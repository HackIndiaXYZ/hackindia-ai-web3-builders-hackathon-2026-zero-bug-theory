"""Regression tests for the ROI localiser and the in-distribution gate.

These encode the single most important safety property of the service: an
image that is not a conjunctiva close-up must never receive a risk score.

Before the localiser and gate existed, measured on the real bundle:

    flat grey square      -> higher_risk, p = 0.9840
    flat blue square      -> higher_risk, p = 0.9975
    uniform random noise  -> higher_risk, p = 0.9975
    near-black square     -> higher_risk, p = 0.9852
    79% clipped to black  -> higher_risk, p = 0.9975

With a sensitivity-tuned operating threshold of 0.2076, essentially any
off-target photograph read as elevated risk. Every one of those inputs is
asserted below to return `recapture_required` with no probability at all.

The tests also assert the opposite failure mode, which is just as serious:
the gate must NOT reject genuine captures, including the palest conjunctivae,
since pallor is exactly what the model exists to detect.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.ml import gate as gating
from app.ml.predictor import MODEL_ASSETS_DIR, engineered_features, get_predictor
from app.ml.roi import locate_conjunctiva

from .fixtures import (
    CONJUNCTIVA_BY_PALLOR,
    checkerboard,
    eye_scene,
    flat,
    grey_gradient,
    masked_conjunctiva_roi,
    textured_patch,
    to_jpeg,
    uniform_noise,
)


@pytest.fixture(scope="module")
def predictor():
    return get_predictor("cpu")


@pytest.fixture(scope="module")
def scalers():
    data = np.load(MODEL_ASSETS_DIR / "train_only_scalers.npz")
    return data["feature_mean"], data["feature_std"]


# ---------------------------------------------------------------------------
# The reject path: off-target images must never be scored.
# ---------------------------------------------------------------------------

OFF_TARGET = [
    ("flat_grey", flat((128, 128, 128))),
    ("flat_white", flat((255, 255, 255))),
    ("flat_black", flat((0, 0, 0))),
    ("near_black", flat((13, 13, 13))),
    ("flat_blue", flat((0, 0, 255))),
    ("flat_green", flat((0, 255, 0))),
    ("flat_red", flat((255, 0, 0))),
    ("flat_skin_pink", flat((200, 150, 150))),
    ("flat_dull_red", flat((180, 90, 90))),
    ("uniform_noise", uniform_noise()),
    ("grey_gradient", grey_gradient()),
    ("checkerboard", checkerboard()),
    ("bare_skin", textured_patch((205, 165, 142))),
    ("bare_sclera", textured_patch((236, 232, 228))),
    ("brown_iris", textured_patch((92, 74, 58))),
]


@pytest.mark.parametrize("name,image", OFF_TARGET, ids=[n for n, _ in OFF_TARGET])
def test_off_target_images_are_never_scored(predictor, name, image):
    result = predictor.predict_bytes(to_jpeg(image))

    assert result["decision"] == "recapture_required", (
        f"{name} was scored as {result['decision']} with "
        f"p={result.get('screening_probability')} -- an off-target image must "
        f"never receive a risk score"
    )
    assert result["screening_probability"] is None
    assert result["recapture_reasons"], f"{name} was refused without a reason"
    # The user must be told what to change.
    assert result["message"]


def test_clipped_to_black_is_refused(predictor):
    """The audit's '79 percent clipped to black' case."""
    image = flat((200, 150, 150))
    image[: int(image.shape[0] * 0.79), :, :] = 0
    result = predictor.predict_bytes(to_jpeg(image))
    assert result["decision"] == "recapture_required"
    assert result["screening_probability"] is None


def test_refusal_carries_no_probability_anywhere(predictor):
    """A refusal must not leak a number the UI could render as a score."""
    result = predictor.predict_bytes(to_jpeg(flat((128, 128, 128))))
    assert result["screening_probability"] is None
    assert "candidate_probabilities" not in result
    assert "risk_category" not in result


# ---------------------------------------------------------------------------
# The accept path: genuine captures must be located and scored.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("pallor", list(CONJUNCTIVA_BY_PALLOR))
@pytest.mark.parametrize("seed", [3, 5])
def test_eye_scenes_across_the_pallor_range_are_scored(predictor, pallor, seed):
    """Every pallor level must be scored -- especially the pale ones.

    A gate that refused pale conjunctivae would defeat the model's purpose,
    and an earlier iteration of this gate did exactly that (it rejected the
    two palest variants via `severely_clipped`, because the square padding
    applied to the located strip was being counted as blown-out pixels).
    """
    image = eye_scene(seed=seed, conjunctiva=CONJUNCTIVA_BY_PALLOR[pallor])
    result = predictor.predict_bytes(to_jpeg(image))

    assert result["decision"] in {"lower_risk", "higher_risk", "uncertain"}, (
        f"{pallor} eye scene was refused: {result.get('recapture_reasons')} "
        f"({result.get('message')})"
    )
    probability = result["screening_probability"]
    assert 0.0 < probability < 1.0
    # Must not be pinned to either calibration bound.
    assert not (0.00390 - 1e-5 <= probability <= 0.00390 + 1e-5)
    assert not (0.99750 - 1e-5 <= probability <= 0.99750 + 1e-5)


def test_probability_increases_with_pallor(predictor):
    """Sanity check on direction: paler tissue must not read as lower risk.

    Averaged over seeds so a single scene's noise cannot flip the ordering.
    """
    means = {}
    for pallor, colour in CONJUNCTIVA_BY_PALLOR.items():
        values = [
            predictor.predict_bytes(
                to_jpeg(eye_scene(seed=seed, conjunctiva=colour))
            )["screening_probability"]
            for seed in (3, 5, 9)
        ]
        assert all(v is not None for v in values), f"{pallor} was refused"
        means[pallor] = float(np.mean(values))

    assert means["healthy"] < means["pale"], means
    assert means["moderate"] < means["severe_pale"], means


def test_localiser_finds_a_wide_strip_not_the_whole_frame(predictor):
    """The conjunctiva is ~13% of an eye photo; the localiser must isolate it."""
    scene = eye_scene(seed=3)
    roi, report = locate_conjunctiva(scene)

    assert roi is not None and report.located
    # It found the lid strip, not the entire scene.
    assert 0.05 < report.coverage < 0.30, report.as_dict()
    # Tissue is genuinely red-over-yellow, near the value derived from the
    # training moments (~6.6).
    assert report.mean_redness > 3.0, report.as_dict()
    # Background really is masked out.
    assert report.masked_fraction > 0.10, report.as_dict()
    # And the result is square, matching the training format.
    assert roi.shape[0] == roi.shape[1]


def test_localisation_moves_the_input_towards_the_training_distribution(scalers):
    """Localising + masking must reduce distance from the fitted distribution.

    sum(z^2) has an expectation of exactly 32 on in-distribution data, because
    the features are standardised by the training set's own moments.
    """
    mean, std = scalers
    scene = eye_scene(seed=3)
    roi, report = locate_conjunctiva(scene)
    assert roi is not None

    def budget(image):
        z = (engineered_features(image) - mean) / std
        return float((z**2).sum())

    scene_budget = budget(scene)
    roi_budget = budget(roi)

    assert roi_budget < scene_budget / 2.0, (
        f"localisation barely helped: whole scene {scene_budget:.1f} -> "
        f"ROI {roi_budget:.1f}"
    )
    assert roi_budget < gating.MAX_DISTRIBUTION_BUDGET


def test_pre_segmented_roi_is_in_distribution(predictor, scalers):
    """The fixture built from the training moments must land near sum(z^2)=32."""
    mean, std = scalers
    roi = masked_conjunctiva_roi(seed=7)
    z = (engineered_features(roi) - mean) / std
    assert 5.0 < float((z**2).sum()) < 60.0

    result = predictor.predict_bytes(to_jpeg(roi), localise=False)
    assert result["decision"] in {"lower_risk", "higher_risk", "uncertain"}
    assert result["screening_probability"] is not None


# ---------------------------------------------------------------------------
# Gate internals.
# ---------------------------------------------------------------------------


def test_degeneracy_floors_catch_a_constant_image(scalers):
    mean, std = scalers
    raw = engineered_features(flat((128, 128, 128)))
    report = gating.check_features(raw, (raw - mean) / std, laplacian_variance=0.0)

    assert not report.accepted
    assert "degenerate_input" in report.failures
    # A constant image is exactly zero on all three texture statistics.
    assert report.texture["gray_std"] == pytest.approx(0.0, abs=1e-9)
    assert report.texture["sobel_mean_norm"] == pytest.approx(0.0, abs=1e-9)


def test_encoder_range_gate_catches_a_blown_up_logit(scalers):
    """Uniform noise drove the EfficientNet logit to -3997 (z = -120)."""
    mean, std = scalers
    raw = engineered_features(masked_conjunctiva_roi(seed=7))
    report = gating.check_features(raw, (raw - mean) / std, laplacian_variance=500.0)
    assert report.accepted

    report = gating.check_encoders(
        report,
        efficientnet_logit=-3997.17,
        convnext_logit=2.79,
        efficientnet_absmax=4673.87,
        convnext_absmax=3.1,
        logit_mean=np.array([-1.6462829798, 1.1382199644]),
        logit_scale=np.array([33.1718284696, 8.3308576281]),
    )
    assert not report.accepted
    assert "encoder_out_of_range" in report.failures
    assert report.logit_z["efficientnet"] < -100


def test_quality_score_varies_and_is_not_hardcoded():
    """quality_bps used to be a constant 10000 on every accepted capture."""
    good = gating.quality_score_bps(
        brightness=110.0,
        laplacian_variance=1650.0,
        clipped_fraction=0.0,
        roi_coverage=0.45,
        distribution_budget=20.0,
    )
    poor = gating.quality_score_bps(
        brightness=30.0,
        laplacian_variance=30.0,
        clipped_fraction=0.5,
        roi_coverage=0.05,
        distribution_budget=200.0,
    )
    assert 0 <= poor < good <= 10000
    assert good != 10000 or poor != 10000
    assert good - poor > 2000


def test_every_gate_failure_has_a_user_facing_message():
    """A refusal the UI cannot explain is a dead end for the user."""
    for failure in gating.RECAPTURE_MESSAGES:
        assert gating.RECAPTURE_MESSAGES[failure].strip()

    report = gating.GateReport(accepted=False, failures=["out_of_distribution"])
    assert report.message() == gating.RECAPTURE_MESSAGES["out_of_distribution"]


def test_predictor_is_deterministic(predictor):
    image = to_jpeg(eye_scene(seed=3))
    first = predictor.predict_bytes(image)
    second = predictor.predict_bytes(image)
    assert first["screening_probability"] == second["screening_probability"]
    assert first["decision"] == second["decision"]
    assert first["quality_bps"] == second["quality_bps"]
