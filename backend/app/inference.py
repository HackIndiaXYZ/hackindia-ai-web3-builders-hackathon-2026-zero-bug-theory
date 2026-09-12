"""Inference-provider interface: the real AnemiaScan V4 bundle, plus a
deterministic mock kept around for CI/offline dev.

`RealInferenceProvider` (app/ml/predictor.py) runs the actual trained model
against the uploaded image. The raw image bytes transit this backend
process in memory for the duration of one request — decoded, fed through
the model, then discarded — but are never written to disk or the database;
only the derived `image_digest` (a sha256 of the bytes) and the coded
result (risk/recommendation/confidence/quality) are persisted. See
routers/registry.py for exactly where that boundary is enforced.

`MockInferenceProvider` stays available behind `INFERENCE_PROVIDER=mock`
for environments without the ~500 MB of model assets (e.g. CI): it's a
deterministic function of the image digest (so re-scanning the same
capture reproduces the same result) and the image's own brightness.

Risk codes:      0 = Low, 1 = Moderate, 2 = Elevated
Recommendation:  0 = self-monitor, 1 = clinician follow-up, 2 = urgent follow-up
"""

import hashlib
import io
from dataclasses import dataclass
from typing import Protocol

import numpy as np
from PIL import Image

from .schemas import DEMO_MODE_NOTICE

RISK_LOW, RISK_MODERATE, RISK_ELEVATED = 0, 1, 2
RECOMMEND_SELF_MONITOR, RECOMMEND_FOLLOW_UP, RECOMMEND_URGENT = 0, 1, 2

REAL_MODEL_WARNING = (
    "Research screening result only. Confirm using a CBC/hemoglobin test and "
    "professional evaluation."
)


@dataclass(frozen=True)
class InferenceResult:
    risk_code: int
    recommendation_code: int
    confidence_bps: int  # 0-10000
    quality_bps: int  # 0-10000
    model_hash: str
    is_synthetic: bool


@dataclass(frozen=True)
class InferenceOutcome:
    """What a provider hands back to the router for one screening attempt."""

    recapture_required: bool
    result: InferenceResult | None
    image_digest: str  # 0x-prefixed sha256 hex of the raw image bytes
    quality: dict
    warning: str


class InferenceProvider(Protocol):
    def run(self, *, image_bytes: bytes) -> InferenceOutcome: ...


def _image_digest(image_bytes: bytes) -> str:
    return "0x" + hashlib.sha256(image_bytes).hexdigest()


class MockInferenceProvider:
    """DEMO MODE — no model weights required. Deterministic function of the
    image digest (so re-scanning the same capture reproduces the same
    result) and the image's own brightness (so an obviously bad capture
    reads as low quality/low confidence).
    """

    def __init__(self, model_hash: str):
        if not model_hash:
            raise ValueError("MockInferenceProvider requires a registered mock model_hash")
        self.model_hash = model_hash

    def run(self, *, image_bytes: bytes) -> InferenceOutcome:
        digest = _image_digest(image_bytes)
        digest_bytes = hashlib.sha256(digest.encode("utf-8")).digest()
        # Deterministic pseudo-randomness derived from the digest, in [0, 1).
        entropy = int.from_bytes(digest_bytes[:4], "big") / 0xFFFFFFFF

        try:
            with Image.open(io.BytesIO(image_bytes)) as img:
                brightness = float(np.asarray(img.convert("L"), dtype="float32").mean())
        except Exception:  # noqa: BLE001 — an undecodable upload just reads as low quality
            brightness = 0.0

        brightness_ok = 60 <= brightness <= 235
        quality = 1.0 if brightness_ok else 0.35
        quality_bps = max(0, min(10000, round(quality * 10000)))

        if not brightness_ok:
            risk_code = RISK_MODERATE
            recommendation_code = RECOMMEND_FOLLOW_UP
            confidence_bps = 3000
        elif entropy < 0.55:
            risk_code = RISK_LOW
            recommendation_code = RECOMMEND_SELF_MONITOR
            confidence_bps = round(6000 + entropy * 4000)
        elif entropy < 0.85:
            risk_code = RISK_MODERATE
            recommendation_code = RECOMMEND_FOLLOW_UP
            confidence_bps = round(5500 + entropy * 3000)
        else:
            risk_code = RISK_ELEVATED
            recommendation_code = RECOMMEND_URGENT
            confidence_bps = round(7000 + entropy * 3000)

        result = InferenceResult(
            risk_code=risk_code,
            recommendation_code=recommendation_code,
            confidence_bps=max(0, min(10000, confidence_bps)),
            quality_bps=quality_bps,
            model_hash=self.model_hash,
            is_synthetic=True,
        )
        return InferenceOutcome(
            recapture_required=False,
            result=result,
            image_digest=digest,
            quality={"accepted": True, "brightness": brightness},
            warning=DEMO_MODE_NOTICE,
        )


_DECISION_TO_CODES = {
    "lower_risk": (RISK_LOW, RECOMMEND_SELF_MONITOR),
    "uncertain": (RISK_MODERATE, RECOMMEND_FOLLOW_UP),
    "higher_risk": (RISK_ELEVATED, RECOMMEND_URGENT),
}


class RealInferenceProvider:
    """Runs the trained AnemiaScan V4 calibrated bundle (app/ml/predictor.py)."""

    def __init__(self, model_hash: str = "", device: str = "auto"):
        self.model_hash = model_hash
        self.device = device

    def run(self, *, image_bytes: bytes) -> InferenceOutcome:
        from .ml.predictor import get_predictor

        try:
            predictor = get_predictor(self.device)
            prediction = predictor.predict_bytes(image_bytes)
        except Exception as err:  # noqa: BLE001 — surfaced as a clean 503, never a raw 500
            raise RuntimeError(f"AnemiaScan model unavailable: {err}") from err

        digest = _image_digest(image_bytes)

        if prediction["decision"] == "recapture_required":
            return InferenceOutcome(
                recapture_required=True,
                result=None,
                image_digest=digest,
                quality=prediction["quality"],
                warning=prediction["warning"],
            )

        risk_code, recommendation_code = _DECISION_TO_CODES[prediction["decision"]]
        confidence_bps = max(0, min(10000, round(prediction["screening_probability"] * 10000)))
        result = InferenceResult(
            risk_code=risk_code,
            recommendation_code=recommendation_code,
            confidence_bps=confidence_bps,
            # The bundle only exposes a binary accept/reject quality gate, not a
            # continuous score — every accepted capture already cleared that gate.
            quality_bps=10000,
            model_hash=self.model_hash or predictor.model_hash,
            is_synthetic=False,
        )
        return InferenceOutcome(
            recapture_required=False,
            result=result,
            image_digest=digest,
            quality=prediction["quality"],
            warning=prediction["warning"],
        )


def get_inference_provider(settings) -> "MockInferenceProvider | RealInferenceProvider":
    if settings.inference_provider == "mock":
        if not settings.mst_mock_model_hash:
            raise ValueError("MST_MOCK_MODEL_HASH is not configured")
        return MockInferenceProvider(model_hash=settings.mst_mock_model_hash)
    return RealInferenceProvider(model_hash=settings.mst_real_model_hash, device=settings.ml_device)
