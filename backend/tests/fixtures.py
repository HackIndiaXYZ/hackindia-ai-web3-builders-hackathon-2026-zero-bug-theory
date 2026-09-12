"""Procedurally-generated image fixtures for the inference tests.

These are NOT stand-ins for clinical data and no result derived from them is
ever shown to a user. They exist to exercise two things a repository with no
committed images otherwise cannot test at all:

  * the REJECT path -- flat fills, noise, gradients, bare skin and bare sclera
    must never be scored. These are the exact inputs that used to come back as
    "higher risk" with p >= 0.98.
  * the ACCEPT path -- a synthetic eye scene whose conjunctiva colour is swept
    across the pallor range must be located, masked and scored, including the
    palest cases. A gate that rejected pale tissue would defeat the purpose of
    the model, so that case is asserted explicitly.

`eye_scene` is built from measured LAB/HSV values for each anatomical region
(see app/ml/roi.py's constants block for the table), so the localiser is being
asked to solve the same colour-geometry problem a real photograph poses:
separate haemoglobin-red tissue from yellow-ish skin, near-neutral sclera,
brown iris, and black lashes/pupil.
"""

from __future__ import annotations

import io

import cv2
import numpy as np
from PIL import Image

# Conjunctiva colours spanning the pallor range, with their measured
# redness-over-yellowness (LAB a - b). Healthy tissue is strongly red; severe
# pallor is only mildly so. Skin sits at -7, sclera at -1, iris at -8.
CONJUNCTIVA_BY_PALLOR: dict[str, tuple[int, int, int]] = {
    "healthy": (171, 99, 95),      # a-b = +14
    "moderate": (178, 120, 115),   # a-b = +10
    "pale": (196, 152, 148),       # a-b =  +8
    "very_pale": (208, 172, 168),  # a-b =  +5
    "severe_pale": (215, 185, 182),  # a-b = +4
}


def to_jpeg(rgb: np.ndarray, quality: int = 92) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(rgb).save(buffer, format="JPEG", quality=quality)
    return buffer.getvalue()


def flat(colour: tuple[int, int, int], size: int = 256) -> np.ndarray:
    """A constant-colour square: zero variance, zero gradient, zero entropy."""
    return np.full((size, size, 3), colour, np.uint8)


def uniform_noise(size: int = 256, seed: int = 12345) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, (size, size, 3), dtype=np.uint8)


def grey_gradient(size: int = 256) -> np.ndarray:
    ramp = np.tile(np.linspace(0, 255, size, dtype=np.uint8), (size, 1))
    return ramp[..., None].repeat(3, axis=2)


def checkerboard(size: int = 256) -> np.ndarray:
    board = (np.indices((size, size)).sum(0) % 2 * 255).astype(np.uint8)
    return board[..., None].repeat(3, axis=2)


def textured_patch(colour: tuple[int, int, int], size: int = 256, seed: int = 4) -> np.ndarray:
    """A single-material patch with realistic grain -- e.g. bare skin or sclera.

    Textured (so it clears the degeneracy floors) but anatomically wrong, so it
    must still be refused: there is no conjunctiva in it.
    """
    rng = np.random.default_rng(seed)
    patch = np.full((size, size, 3), colour, np.int16)
    patch = patch + rng.normal(0, 5, (size, size, 3)).astype(np.int16)
    return np.clip(patch, 0, 255).astype(np.uint8)


def masked_conjunctiva_roi(size: int = 360, seed: int = 7) -> np.ndarray:
    """An already-segmented ROI: vascular tissue on a masked black ground.

    Built to match the training moments recovered in app/ml/roi.py, and
    measured at sum(z^2) ~= 30 against an in-distribution expectation of 32.
    Used to test the gate independently of the localiser.
    """
    rng = np.random.default_rng(seed)
    height = width = size
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    centre_y, centre_x = height * 0.5, width * 0.5

    radius_y, radius_x = height * 0.26, width * 0.86
    ellipse = (
        ((yy - centre_y) / radius_y) ** 2 + ((xx - centre_x) / radius_x) ** 2
    ) <= 1.0
    mask = cv2.GaussianBlur(ellipse.astype(np.float32), (0, 0), size * 0.012)

    base = np.zeros((height, width, 3), np.float32)
    shade = 0.62 + 0.55 * (1.0 - (yy / height))
    base[..., 0] = 168 * shade
    base[..., 1] = 96 * shade
    base[..., 2] = 92 * shade

    vessels = np.zeros((height, width), np.float32)
    for _ in range(26):
        x0, y0 = rng.uniform(0, width), rng.uniform(height * 0.3, height * 0.7)
        angle = rng.uniform(0, np.pi)
        length = rng.uniform(size * 0.10, size * 0.42)
        cv2.line(
            vessels,
            (int(x0), int(y0)),
            (int(x0 + np.cos(angle) * length), int(y0 + np.sin(angle) * length)),
            float(rng.uniform(0.35, 0.85)),
            int(max(1, rng.integers(1, 3))),
        )
    vessels = cv2.GaussianBlur(vessels, (0, 0), 1.1)
    base[..., 0] -= vessels * 34
    base[..., 1] -= vessels * 52
    base[..., 2] -= vessels * 48

    base += rng.normal(0, 4.2, (height, width, 3)).astype(np.float32)
    return np.clip(base * mask[..., None], 0, 255).astype(np.uint8)


def eye_scene(
    size: int = 640,
    seed: int = 3,
    conjunctiva: tuple[int, int, int] = CONJUNCTIVA_BY_PALLOR["healthy"],
    lid_height: float = 0.17,
) -> np.ndarray:
    """A full lower-lid-everted eye: skin, sclera, iris, pupil, lashes, tissue.

    This is what a real capture looks like to the localiser -- the conjunctiva
    occupies only about 13% of the frame and everything else must be rejected.
    """
    rng = np.random.default_rng(seed)
    height = width = size
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    image = np.zeros((height, width, 3), np.float32)

    # Surrounding skin: warm, i.e. markedly yellower than tissue (b* > a*).
    image[..., 0], image[..., 1], image[..., 2] = 205, 165, 142
    image += rng.normal(0, 3.0, (height, width, 3)).astype(np.float32)

    centre_y, centre_x = height * 0.46, width * 0.5
    radius_y, radius_x = height * 0.22, width * 0.40
    opening = (
        ((yy - centre_y) / radius_y) ** 2 + ((xx - centre_x) / radius_x) ** 2
    ) <= 1.0

    # Sclera: bright and near-neutral in chroma, so saturation excludes it.
    sclera = np.zeros_like(image)
    sclera[..., 0], sclera[..., 1], sclera[..., 2] = 236, 232, 228
    episcleral = np.zeros((height, width), np.float32)
    for _ in range(14):
        x0 = rng.uniform(0, width)
        y0 = rng.uniform(centre_y - radius_y, centre_y + radius_y)
        angle, length = rng.uniform(0, np.pi), rng.uniform(30, 90)
        cv2.line(
            episcleral,
            (int(x0), int(y0)),
            (int(x0 + np.cos(angle) * length), int(y0 + np.sin(angle) * length)),
            float(rng.uniform(0.2, 0.5)),
            1,
        )
    episcleral = cv2.GaussianBlur(episcleral, (0, 0), 1.3)
    sclera[..., 1] -= episcleral * 40
    sclera[..., 2] -= episcleral * 38
    image = np.where(opening[..., None], sclera, image)

    iris = ((yy - centre_y) ** 2 + (xx - centre_x) ** 2) <= (height * 0.115) ** 2
    iris_rgb = np.zeros_like(image)
    iris_rgb[..., 0], iris_rgb[..., 1], iris_rgb[..., 2] = 92, 74, 58
    iris_rgb += rng.normal(0, 9.0, (height, width, 3)).astype(np.float32)
    image = np.where((iris & opening)[..., None], iris_rgb, image)

    pupil = ((yy - centre_y) ** 2 + (xx - centre_x) ** 2) <= (height * 0.048) ** 2
    image = np.where((pupil & opening)[..., None], np.full_like(image, 14.0), image)
    catchlight = (
        (yy - (centre_y - height * 0.05)) ** 2 + (xx - (centre_x - width * 0.05)) ** 2
    ) <= (height * 0.016) ** 2
    image = np.where(catchlight[..., None], np.full_like(image, 250.0), image)

    # The everted lower lid: a shallow arc of vascular tissue.
    band_centre = centre_y + radius_y * 0.92
    band = (
        np.abs(yy - (band_centre + 0.00018 * (xx - centre_x) ** 2))
        <= (height * lid_height * 0.5)
    ) & (np.abs(xx - centre_x) <= radius_x * 0.94)

    tissue = np.zeros_like(image)
    shade = 0.70 + 0.48 * (
        1.0
        - np.clip(
            (yy - (band_centre - height * lid_height * 0.5)) / (height * lid_height),
            0,
            1,
        )
    )
    tissue[..., 0] = conjunctiva[0] * shade
    tissue[..., 1] = conjunctiva[1] * shade
    tissue[..., 2] = conjunctiva[2] * shade

    vessels = np.zeros((height, width), np.float32)
    for _ in range(34):
        x0 = rng.uniform(centre_x - radius_x, centre_x + radius_x)
        y0 = rng.uniform(
            band_centre - height * lid_height * 0.5,
            band_centre + height * lid_height * 0.5,
        )
        angle, length = rng.uniform(-0.5, 0.5), rng.uniform(20, 80)
        cv2.line(
            vessels,
            (int(x0), int(y0)),
            (int(x0 + np.cos(angle) * length), int(y0 + np.sin(angle) * length)),
            float(rng.uniform(0.3, 0.8)),
            int(max(1, rng.integers(1, 3))),
        )
    vessels = cv2.GaussianBlur(vessels, (0, 0), 1.1)
    tissue[..., 0] -= vessels * 33
    tissue[..., 1] -= vessels * 50
    tissue[..., 2] -= vessels * 46
    tissue += rng.normal(0, 4.0, (height, width, 3)).astype(np.float32)

    band_soft = cv2.GaussianBlur(band.astype(np.float32), (0, 0), size * 0.006)
    image = image * (1 - band_soft[..., None]) + tissue * band_soft[..., None]

    # Lashes along the upper margin: dark and neutral.
    lashes = np.zeros((height, width), np.float32)
    for _ in range(70):
        x0 = rng.uniform(centre_x - radius_x, centre_x + radius_x)
        y0 = centre_y - radius_y * rng.uniform(0.80, 1.02)
        length, angle = rng.uniform(12, 34), rng.uniform(-1.9, -1.25)
        cv2.line(
            lashes,
            (int(x0), int(y0)),
            (int(x0 + np.cos(angle) * length), int(y0 + np.sin(angle) * length)),
            1.0,
            1,
        )
    lashes = cv2.GaussianBlur(lashes, (0, 0), 0.8)
    image = image * (1 - lashes[..., None] * 0.92)

    return np.clip(image, 0, 255).astype(np.uint8)
