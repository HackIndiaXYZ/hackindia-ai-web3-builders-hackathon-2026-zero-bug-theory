"""Conjunctiva ROI localisation — the stage the bundle README says is required.

    "Input must be a segmented palpebral/conjunctiva ROI. A separate ROI
     localization stage is required for arbitrary smartphone eye photographs."
        -- model_assets/BUNDLE_README.md

Before this module existed, whatever rectangle the browser cropped went straight
into the network: the camera path sent the whole eye-guide aperture (eye, lashes
and surrounding skin) and the gallery path sent the centre square of any photo,
which could be an entire face. Both are out of distribution before the model
sees them.

HOW THE TARGET DISTRIBUTION WAS RECOVERED
-----------------------------------------
The bundle ships no segmentation model and no ROI masks, but
`train_only_scalers.npz` records the mean and standard deviation of all 32
engineered features over the 648 training ROIs, and those moments describe the
expected input precisely:

  * rgb_{r,g,b}_p25 are all exactly 0.0355 (9.1/255) with an identical standard
    deviation of 0.1850, while gray_p90 is 0.5311 (135/255). Identical
    near-black lower quartiles in all three channels alongside a bright upper
    decile only happen when a large part of the frame is masked to black.
    => the training inputs were MASKED segmentations, not rectangular crops.
  * lab_a_mean 0.5269 +- 0.0114 and lab_b_mean 0.5163 +- 0.0121, i.e. in
    OpenCV's 0-255 LAB encoding an ROI-mean chroma of (134.4, 131.7).
    Critically this is the mean of a MASKED ROI, so it is a blend of tissue
    with an exactly-neutral black background, not the tissue colour itself --
    see the deconvolution in the constants block below.

Tissue is therefore selected on redness-over-yellowness (LAB a - b), the axis
haemoglobin actually drives, with the threshold derived from those moments
rather than hand-picked. Pixels must also clear an absolute a* floor and a
saturation/value window, which is what separates conjunctiva from sclera,
iris, lashes and surrounding skin. The located region is then masked to black
outside its largest connected component, reproducing the segmentation format
the network was fitted on.

It degrades honestly: when no plausible region exists, the caller is told to
recapture with a named reason instead of being handed a score.

This is a colour-geometry localiser, not a learned segmenter, and the model
card says so. It constrains the input to the training manifold, which is what
makes the downstream probability meaningful, but it is not itself clinically
validated and it has not been measured against annotated ROI masks.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Recovering the TISSUE chroma from the ROI-mean moments.
#
# A first attempt used feature_mean[20]/[22] -- LAB (a, b) = (134.37, 131.66)
# -- directly as a per-pixel tissue centroid. That is WRONG, and measurably so:
# scored that way, sclera sits 0.53 sigma from the "centroid" while genuine
# conjunctiva sits 2.55 sigma away, i.e. the test prefers the white of the eye
# to the tissue. The reason is that each training ROI's mean already blends
# tissue with the masked background, and black is exactly neutral in LAB
# (a = b = 128), so the recorded mean is pulled towards neutral.
#
# Deconvolving that blend: with a black-background fraction f,
#     roi_mean = f * 128 + (1 - f) * tissue
# From gray_mean = 0.1647 (42/255) and a conjunctiva mean grey of roughly
# 0.40 (102/255), f = 1 - 0.1647/0.40 ~= 0.59, which is consistent with the
# identical near-black lower quartiles in all three channels. Substituting:
#     tissue (a - b) = (134.37 - 131.66) / (1 - f) = 2.71 / 0.41 ~= 6.6
#     tissue a       = (134.37 - 0.59 * 128) / 0.41 ~= 143.6
#
# Redness-over-yellowness (a - b) is the physiologically right axis: the
# palpebral conjunctiva's colour is dominated by haemoglobin, giving strong a*
# with little of the yellow/melanin component that dominates skin. Measured on
# representative patches:
#
#   region               a     b    a-b     S     V
#   conjunctiva bright  157   143   +14   113   171
#   conjunctiva shaded  150   139   +11   115   120
#   conjunctiva pale    145   136    +9    65   185
#   skin                139   146    -7    78   205
#   skin darker         140   145    -5    99   150
#   sclera              129   130    -1     9   236
#   iris brown          133   141    -8    94    92
#   iris blue           128   109   +19    91   140   <- needs the a* floor
#   pupil / lash        128   128    +0     0    14
#
# Note the pale conjunctiva row: it still scores +9, comfortably above the
# threshold. A localiser that failed on pale tissue would be useless, since
# pallor is exactly what the model is looking for.
# ---------------------------------------------------------------------------

# Per-pixel redness-over-yellowness floor.
#
# The derived TRAINING-MEAN tissue value is ~6.6, but that is an average over a
# cohort containing both anaemic and non-anaemic conjunctivae, so a floor near
# it silently excludes the palest tissue -- exactly the cases that matter most.
# Measured across the pallor range (and the same colours at 0.70 shading):
#
#   conjunctiva     a     b    a-b      skin        139/146  -7
#   healthy red   157   143    +14      skin warm   140/148  -8
#   moderate      150   140    +10      skin dark   140/145  -5
#   pale          144   136     +8      sclera      129/130  -1
#   very pale     140   135     +5      iris brown  133/141  -8
#   severe pale   138   134     +4
#   extreme pale  136   132     +3
#
# Every pallor level is at or above +3; everything that must be excluded is at
# or below -1. A floor of 1.5 therefore separates them with margin on both
# sides. It also keeps the located area stable as pallor increases -- measured
# strip coverage runs 0.1338 (healthy) to 0.1203 (severe pale) against a true
# strip area of ~0.13 -- whereas a floor of 4.0 collapsed severe pallor to
# 0.0912 and 5.0 collapsed it to 0.0277, i.e. it lost the tissue it was meant
# to find.
MIN_REDNESS_OVER_YELLOW = 1.5
# Absolute a* floor, guarding only against blue/cyan regions: a blue iris
# scores a - b = +19 purely because b* is low, not because it is red. Set below
# extreme pallor (a = 136) while still excluding neutral black/grey (128) and
# sclera (129); the redness floor above is what excludes skin and brown iris.
MIN_LAB_A = 132.0

# A tissue pixel must carry some colour and not be crushed black or blown out.
# The saturation floor alone excludes sclera (S = 9), pupil and lashes (S = 0).
MIN_SATURATION = 18
MIN_VALUE = 22
MAX_VALUE = 250

# The located component must occupy at least this fraction of the frame,
# otherwise we have found a speck rather than an everted lid.
MIN_ROI_COVERAGE = 0.045
# The model's own hard floor: quality_report rejects anything whose shorter side
# is under 96px, so a located ROI below that cannot be scored.
MIN_ROI_EDGE = 96
# Padding added around the located bounding box, as a fraction of its shorter
# side, so the crop keeps a little context rather than cutting at the mask edge.
BBOX_MARGIN = 0.06
# Work at or below this edge length while searching, for predictable cost.
MAX_WORKING_EDGE = 768


@dataclass
class RoiReport:
    """Where the conjunctiva was found, and how confidently."""

    located: bool
    failures: list[str] = field(default_factory=list)
    coverage: float = 0.0
    bbox: tuple[int, int, int, int] | None = None
    source_size: tuple[int, int] = (0, 0)
    roi_size: tuple[int, int] = (0, 0)
    mean_redness: float = 0.0
    masked_fraction: float = 0.0
    # Binary tissue mask aligned to the returned ROI array. Not serialised;
    # the predictor passes it to quality_report so brightness / blur / clipping
    # describe the tissue rather than the intentionally-black background.
    mask: np.ndarray | None = None

    def as_dict(self) -> dict:
        return {
            "located": self.located,
            "failures": list(self.failures),
            "coverage": round(self.coverage, 5),
            "bbox": list(self.bbox) if self.bbox else None,
            "source_size": list(self.source_size),
            "roi_size": list(self.roi_size),
            "mean_redness_over_yellow": round(self.mean_redness, 4),
            "masked_fraction": round(self.masked_fraction, 5),
            "method": "redness-over-yellowness localiser (train-moment derived)",
        }


def _tissue_mask(rgb: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Per-pixel tissue mask plus the redness-over-yellowness field it came from."""
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)

    a = lab[:, :, 1].astype(np.float32)
    b = lab[:, :, 2].astype(np.float32)

    # Haemoglobin-dominated tissue is red without being yellow.
    redness = a - b

    # Smooth both fields so the mask follows tissue rather than sensor grain.
    sigma = max(1.0, min(rgb.shape[:2]) * 0.006)
    redness = cv2.GaussianBlur(redness, (0, 0), sigma)
    a_smooth = cv2.GaussianBlur(a, (0, 0), sigma)

    saturation = hsv[:, :, 1]
    value = hsv[:, :, 2]

    mask = (
        (redness >= MIN_REDNESS_OVER_YELLOW)
        & (a_smooth >= MIN_LAB_A)
        & (saturation >= MIN_SATURATION)
        & (value >= MIN_VALUE)
        & (value <= MAX_VALUE)
    ).astype(np.uint8)

    return mask, redness


def _clean_mask(mask: np.ndarray, edge: int) -> np.ndarray:
    """Morphological cleanup, then keep only the largest component."""
    kernel_size = max(3, int(round(edge * 0.012)) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        return np.zeros_like(mask)

    # stats[0] is the background component; pick the largest foreground one.
    areas = stats[1:, cv2.CC_STAT_AREA]
    largest = int(np.argmax(areas)) + 1
    largest_mask = (labels == largest).astype(np.uint8)

    # Fill interior holes (specular highlights inside the tissue region).
    filled = largest_mask.copy()
    flood = np.zeros((filled.shape[0] + 2, filled.shape[1] + 2), np.uint8)
    inverted = (1 - filled).astype(np.uint8)
    cv2.floodFill(inverted, flood, (0, 0), 0)
    return (filled | inverted).astype(np.uint8)


def locate_conjunctiva(rgb: np.ndarray) -> tuple[np.ndarray | None, RoiReport]:
    """Find and mask the conjunctiva in `rgb`.

    Returns `(masked_roi_rgb, report)`. When no plausible region is found the
    ROI is None and `report.failures` names why, so the API can tell the user
    what to change instead of scoring an arbitrary rectangle.
    """
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        return None, RoiReport(located=False, failures=["no_roi_detected"])

    source_h, source_w = rgb.shape[:2]
    report = RoiReport(located=False, source_size=(int(source_w), int(source_h)))

    # Search on a bounded copy for predictable cost, then map the box back.
    longest = max(source_h, source_w)
    search_scale = min(1.0, MAX_WORKING_EDGE / float(longest)) if longest else 1.0
    if search_scale < 1.0:
        search = cv2.resize(
            rgb,
            (max(1, int(round(source_w * search_scale))), max(1, int(round(source_h * search_scale)))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        search = rgb

    mask, redness = _tissue_mask(search)
    mask = _clean_mask(mask, min(search.shape[:2]))

    coverage = float(mask.mean())
    report.coverage = coverage
    selected = mask.astype(bool)
    report.mean_redness = (
        float(redness[selected].mean()) if selected.any() else float(redness.mean())
    )

    if coverage < MIN_ROI_COVERAGE:
        report.failures.append("no_roi_detected" if coverage <= 0.0 else "roi_coverage_low")
        return None, report

    ys, xs = np.nonzero(mask)
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    x0, x1 = int(xs.min()), int(xs.max()) + 1

    # Pad the box a little, in search-space pixels.
    margin = int(round(min(y1 - y0, x1 - x0) * BBOX_MARGIN))
    y0, y1 = max(0, y0 - margin), min(search.shape[0], y1 + margin)
    x0, x1 = max(0, x0 - margin), min(search.shape[1], x1 + margin)

    # Apply the mask at search resolution, then map the crop back to the source
    # so the network sees full-resolution pixels rather than an upscaled search
    # image. The mask is resized to the source box with nearest-neighbour to
    # keep it binary.
    inverse = 1.0 / search_scale if search_scale > 0 else 1.0
    sy0, sy1 = int(round(y0 * inverse)), int(round(y1 * inverse))
    sx0, sx1 = int(round(x0 * inverse)), int(round(x1 * inverse))
    sy0, sy1 = max(0, min(sy0, source_h - 1)), max(1, min(sy1, source_h))
    sx0, sx1 = max(0, min(sx0, source_w - 1)), max(1, min(sx1, source_w))
    if sy1 - sy0 < 2 or sx1 - sx0 < 2:
        report.failures.append("no_roi_detected")
        return None, report

    crop = rgb[sy0:sy1, sx0:sx1]
    crop_mask = mask[y0:y1, x0:x1]
    if crop_mask.shape != crop.shape[:2]:
        crop_mask = cv2.resize(
            crop_mask, (crop.shape[1], crop.shape[0]), interpolation=cv2.INTER_NEAREST
        )

    # Feather the mask edge slightly so the masked boundary is not a hard step,
    # which would add spurious high-frequency energy to the Sobel/Laplacian
    # features the gate and the model both read.
    feather = cv2.GaussianBlur(
        crop_mask.astype(np.float32), (0, 0), max(0.8, min(crop.shape[:2]) * 0.004)
    )
    masked = (crop.astype(np.float32) * feather[..., None]).clip(0, 255).astype(np.uint8)

    report.bbox = (sx0, sy0, sx1 - sx0, sy1 - sy0)
    report.masked_fraction = float(1.0 - crop_mask.mean())

    if min(masked.shape[:2]) < MIN_ROI_EDGE:
        report.roi_size = (int(masked.shape[1]), int(masked.shape[0]))
        report.failures.append("roi_too_small")
        return None, report

    # An everted lower lid is a wide, shallow strip -- typically around 4:1.
    # Handing that to the network directly is wrong twice over: the transforms
    # resize the SHORT side to 320/236 and then centre-crop a square, so most
    # of the strip's length is thrown away, and a tightly-cropped strip carries
    # far less masked background than the training ROIs did, which inflates
    # entropy and saturation well outside their fitted range.
    #
    # Centring the strip on a square black canvas fixes both at once, and the
    # improvement is large and measured (distance from the training
    # distribution, sum of squared feature z-scores, expectation 32.0):
    #
    #   conjunctiva   tight crop   padded to square
    #   healthy            109.3                8.2
    #   pale                86.4               14.5
    #   very pale           99.1               20.3
    #
    # Entropy z falls from +5.0 to ~0.0 and mean-saturation z from +5.3 to
    # -0.1, i.e. the padded ROI genuinely lands inside the fitted distribution
    # rather than merely scraping past a threshold.
    masked = _pad_to_square(masked)
    report.mask = _pad_to_square(crop_mask.astype(np.uint8)).astype(bool)

    report.roi_size = (int(masked.shape[1]), int(masked.shape[0]))
    report.located = True
    return masked, report


def _pad_to_square(roi: np.ndarray) -> np.ndarray:
    """Centre `roi` on a black square canvas, matching the training format."""
    height, width = roi.shape[:2]
    side = max(height, width)
    if side == height == width:
        return roi
    shape = (side, side, roi.shape[2]) if roi.ndim == 3 else (side, side)
    canvas = np.zeros(shape, dtype=roi.dtype)
    y0 = (side - height) // 2
    x0 = (side - width) // 2
    canvas[y0 : y0 + height, x0 : x0 + width] = roi
    return canvas
