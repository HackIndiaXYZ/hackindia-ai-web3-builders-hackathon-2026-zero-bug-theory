"""Inference-provider interface: the real AnemiaScan V3.1 bundle, plus a
deterministic mock kept around for CI/offline dev.

`RealInferenceProvider` (app/ml/predictor.py) runs the actual trained model
against the uploaded image. The raw image bytes transit this backend
process in memory for the duration of one request — decoded, fed through
the model, then discarded — but are never written to disk or the database;
only the derived `image_digest` (a sha256 of the bytes) and the coded
result (risk/recommendation/confidence/quality) are persisted. See
routers/registry.py for exactly where that boundary is enforced.

`MockInferenceProvider` stays available behind `INFERENCE_PROVIDER=mock`
for environments without the ~150MB of model weights (e.g. CI): it's a
deterministic function of the image digest (so re-scanning the same
capture reproduces the same result) and the image's own brightness.

Risk codes:      0 = Low, 1 = Moderate, 2 = Elevated
Recommendation:  0 = self-monitor, 1 = clinician follow-up, 2 = urgent follow-up
"""

import hashlib
import io
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np
from eth_utils import keccak
from PIL import Image

from .schemas import DEMO_MODE_NOTICE

RISK_LOW, RISK_MODERATE, RISK_ELEVATED = 0, 1, 2
RECOMMEND_SELF_MONITOR, RECOMMEND_FOLLOW_UP, RECOMMEND_URGENT = 0, 1, 2

# The real bundle's on-chain identity is derived from the WEIGHTS, not from a
# text tag. See app/ml/manifest.py: every runtime asset is sha256'd and the
# model hash is keccak256 of the canonical manifest, so swapping or corrupting
# a checkpoint changes the hash and breaks the link to any commitment anchored
# under the old one.
#
# The previous value was keccak256("ANEMIASCAN_V3_1_CALIBRATED_LOGISTIC_STACKER"),
# a constant independent of the bytes on disk, which provided no tamper
# evidence for the model at all. It is kept here only so an operator who
# registered it on-chain can recognise it.
LEGACY_REAL_MODEL_TAG = "ANEMIASCAN_V3_1_CALIBRATED_LOGISTIC_STACKER"
LEGACY_REAL_MODEL_HASH = "0x" + keccak(text=LEGACY_REAL_MODEL_TAG).hex()


def real_model_hash() -> str:
    """keccak256 of the installed bundle's asset manifest."""
    from .ml.manifest import get_model_hash

    return get_model_hash()

REAL_MODEL_WARNING = (
    "Research screening result only; obtain a CBC/hemoglobin test and "
    "professional evaluation for diagnosis."
)


@dataclass(frozen=True)
class InferenceResult:
    risk_code: int
    recommendation_code: int
    # The calibrated screening PROBABILITY in basis points. This is the number
    # the model actually produces; it is not a "confidence". It keeps the
    # `probability_bps` name end to end (API, DB and the on-chain commitment
    # field) so nothing downstream can mistake it for a certainty measure.
    probability_bps: int  # 0-10000
    quality_bps: int  # 0-10000, a measured capture-quality score
    model_hash: str
    is_synthetic: bool
    # Everything the UI needs to show what the model did. Empty for the mock.
    detail: dict = field(default_factory=dict)


@dataclass(frozen=True)
class InferenceOutcome:
    """What a provider hands back to the router for one screening attempt."""

    recapture_required: bool
    result: InferenceResult | None
    image_digest: str  # 0x-prefixed sha256 hex of the raw image bytes
    quality: dict
    warning: str
    # Named, machine-readable reasons a capture was refused (e.g.
    # "no_roi_detected", "degenerate_input"), plus the sentence to show the
    # user. Previously the router discarded these and the app showed a
    # generic "inconclusive" screen with no way to fix the problem.
    recapture_reasons: list[str] = field(default_factory=list)
    message: str = ""
    roi: dict | None = None
    gate: dict | None = None


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
            probability_bps=max(0, min(10000, confidence_bps)),
            quality_bps=quality_bps,
            model_hash=self.model_hash,
            is_synthetic=True,
            detail={"model_version": "mock-v0", "risk_category": "Synthetic"},
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
    """Runs the trained AnemiaScan V3.1 calibrated bundle (app/ml/predictor.py),
    including the conjunctiva ROI localiser and the in-distribution gates."""

    def __init__(self, model_hash: str, device: str = "cpu"):
        self.model_hash = model_hash
        self.device = device

    def run(self, *, image_bytes: bytes) -> InferenceOutcome:
        from .ml.predictor import get_predictor

        try:
            predictor = get_predictor(self.device)
            prediction = predictor.predict_bytes(image_bytes)
        except Exception as err:  # noqa: BLE001 - surfaced as a clean 503, never a raw 500
            raise RuntimeError(f"AnemiaScan model unavailable: {err}") from err

        digest = _image_digest(image_bytes)

        if prediction["decision"] == "recapture_required":
            return InferenceOutcome(
                recapture_required=True,
                result=None,
                image_digest=digest,
                quality=prediction["quality"],
                warning=prediction["warning"],
                recapture_reasons=list(prediction.get("recapture_reasons") or []),
                message=prediction.get("message", ""),
                roi=prediction.get("roi"),
                gate=prediction.get("gate"),
            )

        risk_code, recommendation_code = _DECISION_TO_CODES[prediction["decision"]]
        probability_bps = max(
            0, min(10000, round(prediction["screening_probability"] * 10000))
        )
        result = InferenceResult(
            risk_code=risk_code,
            recommendation_code=recommendation_code,
            probability_bps=probability_bps,
            # A measured score now, not the hardcoded 10000 that made the UI
            # report "100/100 confidence" for every accepted capture and wrote
            # a constant into the on-chain commitment.
            quality_bps=int(prediction["quality_bps"]),
            model_hash=self.model_hash,
            is_synthetic=False,
            detail={
                "decision": prediction["decision"],
                "risk_category": prediction["risk_category"],
                "screening_probability": prediction["screening_probability"],
                "probability_bps": probability_bps,
                "selected_model": prediction["selected_model"],
                "operating_threshold": prediction["operating_threshold"],
                "uncertainty_margin": prediction["uncertainty_margin"],
                "candidate_probabilities": prediction["candidate_probabilities"],
                "candidate_thresholds": prediction["candidate_thresholds"],
                "model_disagreement": prediction["model_disagreement"],
                "near_threshold": prediction["near_threshold"],
                "fusion_gate_weights": prediction["fusion_gate_weights"],
                "model_version": prediction["model_version"],
            },
        )
        return InferenceOutcome(
            recapture_required=False,
            result=result,
            image_digest=digest,
            quality=prediction["quality"],
            warning=prediction["warning"],
            roi=prediction.get("roi"),
            gate=prediction.get("gate"),
        )


def get_inference_provider(settings) -> "MockInferenceProvider | RealInferenceProvider":
    if settings.inference_provider == "mock":
        if not settings.mst_mock_model_hash:
            raise ValueError("MST_MOCK_MODEL_HASH is not configured")
        return MockInferenceProvider(model_hash=settings.mst_mock_model_hash)
    model_hash = settings.mst_real_model_hash or real_model_hash()
    return RealInferenceProvider(model_hash=model_hash, device=settings.ml_device)
