"""Inference-provider interface + a deterministic mock implementation.

AnemiaScan's real model is not trained yet. Every result this module
produces is synthetic and carries `is_synthetic=True` end to end — the API
layer (routers/registry.py) refuses to let a synthetic result through
without the DEMO MODE disclosure, and nothing here ever sees a raw eye
image: only a client-computed `image_digest` plus coarse quality signals the
existing capture flow already derives (see src/screens/scan-screen.tsx's own
brightness sampling — this module does not import that code, it just
targets the same shape of input, so a future capture flow can feed either).

Swapping in a real model later means writing one more class satisfying
InferenceProvider and pointing app/config.py at it — nothing else in the
backend needs to change.

Risk codes:      0 = Low, 1 = Moderate, 2 = Elevated
Recommendation:  0 = self-monitor, 1 = clinician follow-up, 2 = urgent follow-up
"""

import hashlib
from dataclasses import dataclass
from typing import Protocol

RISK_LOW, RISK_MODERATE, RISK_ELEVATED = 0, 1, 2
RECOMMEND_SELF_MONITOR, RECOMMEND_FOLLOW_UP, RECOMMEND_URGENT = 0, 1, 2


@dataclass(frozen=True)
class InferenceResult:
    risk_code: int
    recommendation_code: int
    confidence_bps: int  # 0-10000
    quality_bps: int  # 0-10000
    model_hash: str
    is_synthetic: bool


class InferenceProvider(Protocol):
    def run(self, *, image_digest: str, brightness: float, quality_hint: float | None = None) -> InferenceResult: ...


class MockInferenceProvider:
    """DEMO MODE — AI model integration pending. Deterministic function of
    the image digest (so re-scanning the same capture reproduces the same
    result) and the reported brightness (so an obviously bad capture reads
    as low quality/low confidence, matching InconclusiveScreen's existing
    "too dark" gate in the frontend).
    """

    def __init__(self, model_hash: str):
        if not model_hash:
            raise ValueError("MockInferenceProvider requires a registered mock model_hash")
        self.model_hash = model_hash

    def run(self, *, image_digest: str, brightness: float, quality_hint: float | None = None) -> InferenceResult:
        digest_bytes = hashlib.sha256(image_digest.encode("utf-8")).digest()
        # Deterministic pseudo-randomness derived from the digest, in [0, 1).
        entropy = int.from_bytes(digest_bytes[:4], "big") / 0xFFFFFFFF

        brightness_ok = 60 <= brightness <= 235
        quality = quality_hint if quality_hint is not None else (1.0 if brightness_ok else 0.35)
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

        return InferenceResult(
            risk_code=risk_code,
            recommendation_code=recommendation_code,
            confidence_bps=max(0, min(10000, confidence_bps)),
            quality_bps=quality_bps,
            model_hash=self.model_hash,
            is_synthetic=True,
        )
