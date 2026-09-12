"""Input-plausibility and in-distribution gating for the AnemiaScan V3.1 bundle.

WHY THIS MODULE EXISTS
----------------------
The bundle's own README states: "Input must be a segmented palpebral/conjunctiva
ROI. A separate ROI localization stage is required for arbitrary smartphone eye
photographs." Before this module existed, no such stage and no distribution check
ran at all, so any image whatsoever was scored and — because the operating
threshold is tuned for 90% sensitivity (0.2076) — almost anything off-target read
as elevated risk. Measured on the real predictor, a flat grey square returned
`higher_risk` at p=0.984 and uniform noise at p=0.998.

Every threshold here is derived from the bundle's OWN training moments
(`train_only_scalers.npz` -> feature_mean/feature_std, computed over the 648
training ROIs, and the stacker's StandardScaler moments over the same 648
samples). Nothing is hand-waved: a feature's z-score is measured against the
distribution the model was actually fitted on.

WHAT THE TRAINING MOMENTS TELL US ABOUT THE EXPECTED INPUT
----------------------------------------------------------
feature_mean/std imply the training ROIs were MASKED segmentations on a black
background, not rectangular crops:

  * R_p25 == G_p25 == B_p25 == 0.0355 (9.1/255) with identical std 0.1850, while
    gray_p90 == 0.5311 (135/255). A bimodal black-ground-plus-tissue histogram is
    the only thing that produces identical near-zero quartiles across all three
    channels alongside a bright upper decile.
  * Chroma is extremely tight: LAB a_mean 0.5269 +- 0.0114 (134.4 +- 2.9 in
    OpenCV's 0-255 LAB) and b_mean 0.5163 +- 0.0121. Tissue colour, narrowly
    clustered.
  * Real texture is present: Laplacian variance 1650 +- 1360, Sobel mean
    26.2/255 +- 17.4, Shannon entropy 2.14 bits +- 0.79.

CALIBRATION EVIDENCE (all measured, see tests/test_gate.py)
-----------------------------------------------------------
A procedurally-built masked conjunctiva ROI that matches those moments scores
sum(z^2) = 30.3 (RMS z 0.974) against an expectation of exactly 32.0 -- i.e. it
sits where an in-distribution sample should. Every degenerate input sits far
outside, and the flat fills are *structurally* zero on all four texture
statistics:

  input                    sum z^2   gray_std  entropy   sobel     lap_var
  masked ROI (in-dist)        30.3     0.1980   0.5352   0.05251      79.2
  near-black (13,13,13)      111.7     0.0000   0.0000   0.00000       0.0
  flat grey 128              154.0     0.0000   0.0000   0.00000       0.0
  flat skin-pink             225.5     0.0000   0.0000   0.00000       0.0
  flat (180,90,90)           331.5     0.0000   0.0000   0.00000       0.0
  uniform random noise       829.4     0.1944   0.9543   0.85050   48962.1
  flat green                3180.4     0.0000   0.0000   0.00000       0.0
  flat blue                 3456.4     0.0000   0.0000   0.00000       0.0

A constant-colour image has zero variance, zero gradient and zero entropy as a
matter of arithmetic, and a photograph cannot. That is why DEGENERACY_FLOORS is
the primary catch and carries a ~10x margin on both sides rather than being
tuned to a percentile. The chi-square style OOD budget is deliberately a loose
backstop (220 vs an in-distribution 30.3), because the 32 features are strongly
correlated -- six of them are near-duplicate luminance measures -- so the true
null distribution of sum(z^2) has a far heavier tail than chi2_32 and a tight
threshold would reject legitimate captures.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

# ---------------------------------------------------------------------------
# Feature index map for the 32-vector produced by predictor.engineered_features.
# Order is fixed by that function and must not be reordered independently.
# ---------------------------------------------------------------------------
FEATURE_NAMES: tuple[str, ...] = (
    "rgb_r_mean", "rgb_r_std", "rgb_r_p25", "rgb_r_p75",
    "rgb_g_mean", "rgb_g_std", "rgb_g_p25", "rgb_g_p75",
    "rgb_b_mean", "rgb_b_std", "rgb_b_p25", "rgb_b_p75",
    "hsv_h_mean", "hsv_h_std", "hsv_s_mean", "hsv_s_std",
    "hsv_v_mean", "hsv_v_std",
    "lab_l_mean", "lab_l_std", "lab_a_mean", "lab_a_std",
    "lab_b_mean", "lab_b_std",
    "gray_mean", "gray_std", "gray_p10", "gray_p90",
    "laplacian_var_norm", "sobel_mean_norm", "gray_entropy", "saturated_fraction",
)
_IDX = {name: i for i, name in enumerate(FEATURE_NAMES)}

I_LAB_A_MEAN = _IDX["lab_a_mean"]
I_LAB_B_MEAN = _IDX["lab_b_mean"]
I_GRAY_STD = _IDX["gray_std"]
I_ENTROPY = _IDX["gray_entropy"]
I_SOBEL = _IDX["sobel_mean_norm"]
I_SAT_FRACTION = _IDX["saturated_fraction"]

# ---------------------------------------------------------------------------
# Thresholds. Each carries its justification inline; see the module docstring
# for the measured table these were set against.
# ---------------------------------------------------------------------------

# Structural floors. A constant-colour image is exactly 0.0 on all four; the
# in-distribution fixture is 0.198 / 0.535 / 0.0525 / 79.2. Each floor sits
# about an order of magnitude below the in-distribution value and infinitely
# above the degenerate one, so this test cannot plausibly misfire either way.
DEGENERACY_FLOORS: dict[str, float] = {
    "gray_std": 0.02,          # in-dist 0.198
    "gray_entropy": 0.05,      # in-dist 0.535 (feature is entropy_bits / 8)
    "sobel_mean_norm": 0.005,  # in-dist 0.0525
}
# Raw (unnormalised) Laplacian variance floor. Training mean is 1650; the
# in-distribution fixture is 79.2; a flat fill is 0.0. This also gives the
# blur gate the audit found missing -- blur_variance was computed but never
# compared against anything.
LAPLACIAN_VARIANCE_FLOOR = 8.0

# Tissue-chroma plausibility. Training a_mean/b_mean std is only 0.0114/0.0121,
# so |z| <= 8 still admits LAB a in roughly [111, 158] -- a wide band for tissue
# under varied lighting -- while flat blue (+24.9 / -36.1) and flat green
# (-31.7 / +25.7) are far outside it.
MAX_ABS_CHROMA_Z = 8.0

# Excess high-frequency energy: synthetic noise, heavy compression artefacts or
# a dense pattern. In-distribution sobel/entropy z are -0.74 / +2.71; uniform
# noise is +10.93 / +6.94.
MAX_SOBEL_Z = 6.0
MAX_ENTROPY_Z = 5.0
MAX_SATURATED_FRACTION_Z = 10.0  # in-dist +1.07, flat blue/green +31.1, noise +15.6

# Loose global backstop. In-distribution 30.3 (expectation 32.0); lowest
# degenerate input 111.7. Set high because the 32 features are strongly
# correlated, so the null tail is much heavier than chi2_32 would suggest.
MAX_DISTRIBUTION_BUDGET = 220.0

# Base-encoder range, measured against the stacker StandardScaler's own moments
# (fitted on the same 648 training samples): eff mean -1.6463 sd 33.1718,
# conv mean 1.1382 sd 8.3309. Uniform noise drives eff_logit to -3997.17, a
# z of -120.4, which is how a garbage image reaches predict_proba == 1.0
# exactly: that one dimension contributes +14.6 to the decision function.
MAX_ABS_LOGIT_Z = 6.0
# Legitimate embeddings are O(1-5) in magnitude (measured absmax 1.31 for
# EfficientNet and 4.67 for ConvNeXt on a real-shaped input); uniform noise
# blows the EfficientNet embedding up to 4673.87.
MAX_EMBEDDING_ABSMAX = 50.0


RECAPTURE_MESSAGES: dict[str, str] = {
    "roi_too_small": "Move a little closer — the exposed inner eyelid is too small in frame.",
    "extremely_dark": "Too dark. Find brighter, even light and try again.",
    "extremely_bright": "Too bright. Move out of direct light or glare and try again.",
    "severely_clipped": "The frame is blown out. Reduce glare and try again.",
    "out_of_focus": "The frame is out of focus or has no visible detail. Hold steady and try again.",
    "degenerate_input": "That image has no visible tissue detail. Photograph the inner surface of your lower eyelid.",
    "implausible_chroma": "That does not look like eyelid tissue. Gently pull down the lower lid and photograph the inner rim.",
    "excess_high_frequency": "That image is too noisy to read. Use better light and hold the camera steady.",
    "out_of_distribution": "That does not look like a conjunctiva close-up. Follow the on-screen guide and try again.",
    "encoder_out_of_range": "That image is outside the range this model can read. Photograph the inner lower eyelid in even light.",
    "probability_saturated": "The model could not produce a reliable reading for that image. Please retake the scan.",
    "no_roi_detected": "No exposed inner eyelid was found in that photo. Pull the lower lid down and fill the guide.",
    "roi_coverage_low": "Too little eyelid tissue is visible. Move closer and fill the guide.",
}


@dataclass
class GateReport:
    """Outcome of every distribution check, for the response and the audit log."""

    accepted: bool
    failures: list[str] = field(default_factory=list)
    distribution_budget: float = 0.0
    rms_z: float = 0.0
    max_abs_z: float = 0.0
    worst_features: list[dict] = field(default_factory=list)
    chroma_z: dict[str, float] = field(default_factory=dict)
    texture: dict[str, float] = field(default_factory=dict)
    logit_z: dict[str, float] = field(default_factory=dict)

    def as_dict(self) -> dict:
        return {
            "accepted": self.accepted,
            "failures": list(self.failures),
            "distribution_budget": round(self.distribution_budget, 4),
            "distribution_budget_limit": MAX_DISTRIBUTION_BUDGET,
            "rms_z": round(self.rms_z, 4),
            "max_abs_z": round(self.max_abs_z, 4),
            "worst_features": self.worst_features,
            "chroma_z": {k: round(v, 4) for k, v in self.chroma_z.items()},
            "texture": {k: round(v, 6) for k, v in self.texture.items()},
            "logit_z": {k: round(v, 4) for k, v in self.logit_z.items()},
        }

    def message(self) -> str:
        for failure in self.failures:
            if failure in RECAPTURE_MESSAGES:
                return RECAPTURE_MESSAGES[failure]
        return "That image could not be read as a conjunctiva close-up. Please retake the scan."


def _worst(z: np.ndarray, count: int = 6) -> list[dict]:
    order = np.argsort(-np.abs(z))[:count]
    return [{"feature": FEATURE_NAMES[i], "z": round(float(z[i]), 4)} for i in order]


def check_features(
    features_raw: np.ndarray,
    features_scaled: np.ndarray,
    *,
    laplacian_variance: float,
) -> GateReport:
    """Pre-network gate: is this image plausibly a segmented conjunctiva ROI?

    `features_raw` is the 32-vector from predictor.engineered_features;
    `features_scaled` is the same vector standardised by the bundle's
    train-only scalers, i.e. a per-feature z-score against the training set.
    `laplacian_variance` is the raw (unclipped) value from quality_report.
    """
    z = np.asarray(features_scaled, dtype=np.float64)
    raw = np.asarray(features_raw, dtype=np.float64)
    failures: list[str] = []

    # 1. Structural degeneracy -- a constant or near-constant image.
    degenerate = [
        name
        for name, floor in DEGENERACY_FLOORS.items()
        if float(raw[_IDX[name]]) < floor
    ]
    if float(laplacian_variance) < LAPLACIAN_VARIANCE_FLOOR:
        degenerate.append("laplacian_variance")
    if degenerate:
        # Zero gradient/variance/entropy means there is no tissue detail at all.
        failures.append("degenerate_input")

    # 2. Tissue chroma.
    chroma_z = {
        "lab_a_mean": float(z[I_LAB_A_MEAN]),
        "lab_b_mean": float(z[I_LAB_B_MEAN]),
    }
    if any(abs(v) > MAX_ABS_CHROMA_Z for v in chroma_z.values()):
        failures.append("implausible_chroma")

    # 3. Excess high-frequency energy (noise / pattern / artefact).
    if (
        float(z[I_SOBEL]) > MAX_SOBEL_Z
        or float(z[I_ENTROPY]) > MAX_ENTROPY_Z
        or float(z[I_SAT_FRACTION]) > MAX_SATURATED_FRACTION_Z
    ):
        failures.append("excess_high_frequency")

    # 4. Global distance from the training distribution.
    budget = float((z**2).sum())
    if budget > MAX_DISTRIBUTION_BUDGET:
        failures.append("out_of_distribution")

    return GateReport(
        accepted=not failures,
        failures=failures,
        distribution_budget=budget,
        rms_z=float(np.sqrt((z**2).mean())),
        max_abs_z=float(np.abs(z).max()),
        worst_features=_worst(z),
        chroma_z=chroma_z,
        texture={
            "gray_std": float(raw[I_GRAY_STD]),
            "gray_entropy": float(raw[I_ENTROPY]),
            "sobel_mean_norm": float(raw[I_SOBEL]),
            "laplacian_variance": float(laplacian_variance),
        },
        logit_z={},
    )


def check_encoders(
    report: GateReport,
    *,
    efficientnet_logit: float,
    convnext_logit: float,
    efficientnet_absmax: float,
    convnext_absmax: float,
    logit_mean: np.ndarray,
    logit_scale: np.ndarray,
) -> GateReport:
    """Post-encoder gate: did the base networks stay in their fitted range?

    `logit_mean`/`logit_scale` are the first two entries of the stacker's own
    StandardScaler mean_/scale_, i.e. the mean and sd of the two base logits
    over the 648 training samples. A logit tens of sigmas away means the
    encoder has left the manifold it was fitted on, and the stacker's linear
    combination of it is meaningless -- this is the check that catches an
    input like uniform noise, whose EfficientNet logit is -3997 (z = -120).
    """
    eff_z = (float(efficientnet_logit) - float(logit_mean[0])) / float(logit_scale[0])
    conv_z = (float(convnext_logit) - float(logit_mean[1])) / float(logit_scale[1])
    report.logit_z = {
        "efficientnet": eff_z,
        "convnext": conv_z,
        "efficientnet_embedding_absmax": float(efficientnet_absmax),
        "convnext_embedding_absmax": float(convnext_absmax),
    }
    if abs(eff_z) > MAX_ABS_LOGIT_Z or abs(conv_z) > MAX_ABS_LOGIT_Z:
        report.failures.append("encoder_out_of_range")
    elif (
        float(efficientnet_absmax) > MAX_EMBEDDING_ABSMAX
        or float(convnext_absmax) > MAX_EMBEDDING_ABSMAX
    ):
        report.failures.append("encoder_out_of_range")
    report.accepted = not report.failures
    return report


def quality_score_bps(
    *,
    brightness: float,
    laplacian_variance: float,
    clipped_fraction: float,
    roi_coverage: float,
    distribution_budget: float,
) -> int:
    """A continuous 0-10000 capture-quality score.

    Replaces the hardcoded 10000 the audit found on every accepted capture,
    which made the UI's "Confidence in this capture" read 100/100 always and
    permanently recorded a constant under `qualityBps` in the on-chain
    commitment. Each term is 0..1 and the result is their weighted product-sum;
    all four inputs are measured, none is synthesised.
    """
    # Brightness: best near the training mean gray (42/255 for a masked ROI is
    # low because of the black ground, so score the tissue-bearing range
    # generously and fall off towards the hard quality-gate limits.
    if brightness <= 12 or brightness >= 245:
        light = 0.0
    else:
        light = 1.0 - min(1.0, abs(brightness - 110.0) / 130.0)

    # Focus: saturates at the training Laplacian-variance mean of ~1650.
    focus = float(np.clip(laplacian_variance / 1650.0, 0.0, 1.0))

    # Clipping: 0 clipped pixels is perfect, the 0.80 gate limit is zero.
    clipping = float(np.clip(1.0 - (clipped_fraction / 0.80), 0.0, 1.0))

    # Framing: how much of the frame the located ROI actually fills.
    framing = float(np.clip(roi_coverage / 0.45, 0.0, 1.0))

    # Typicality: how close the ROI sits to the training distribution.
    typicality = float(
        np.clip(1.0 - (distribution_budget / MAX_DISTRIBUTION_BUDGET), 0.0, 1.0)
    )

    score = (
        0.22 * light
        + 0.26 * focus
        + 0.14 * clipping
        + 0.16 * framing
        + 0.22 * typicality
    )
    return int(round(float(np.clip(score, 0.0, 1.0)) * 10000))
