"""Canonical inference surface.

The spec documents `POST /inference/predict`; the code only ever exposed
`POST /registry/screenings`. Both now work — this module owns the documented
path, and the registry route is kept as an alias so nothing that already
integrates against it breaks.

`GET /inference/model` exposes the running model's identity (version, the
weights-derived hash, the operating threshold and the asset manifest) so a
client or an auditor can confirm which model produced a given result without
having to trust the service's word for it.

`POST /inference/explain` is the optional Gemini layer. It explains an
already-computed result and can never alter one.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import gemini
from ..config import get_settings
from ..db import get_db
from ..firebase_auth import require_user
from ..schemas import HASH32, ScreeningResponse
from .registry import run_screening

logger = logging.getLogger("anemiascan.inference")
router = APIRouter(prefix="/inference", tags=["inference"])


@router.post("/predict", response_model=ScreeningResponse, status_code=201)
async def predict(
    image: UploadFile = File(..., description="Captured eye / conjunctiva photo"),
    consent_hash: str = Form(
        ...,
        pattern=HASH32,
        description="0x-prefixed 32-byte hash of the off-chain consent record",
    ),
    captured_at: int | None = Form(
        None, description="unix seconds; defaults to server time if omitted"
    ),
    db: Session = Depends(get_db),
    user: dict = Depends(require_user),
) -> ScreeningResponse:
    """Locate the conjunctiva, gate it, score it, commit it, anchor it.

    Returns 422 with `{decision, reasons, message, quality, roi, gate}` when the
    capture is refused — an off-target photo is never given a risk score.
    """
    return await run_screening(
        image=image, consent_hash=consent_hash, captured_at=captured_at, db=db
    )


class ModelInfoResponse(BaseModel):
    provider: str
    model_version: str | None = None
    model_hash: str
    operating_threshold: float | None = None
    uncertainty_margin: float | None = None
    selected_candidate: str | None = None
    target_sensitivity: float | None = None
    assets: list[dict] = Field(default_factory=list)
    explainer_available: bool = False
    notice: str


@router.get("/model", response_model=ModelInfoResponse)
def model_info() -> ModelInfoResponse:
    settings = get_settings()
    notice = (
        "Research screening prototype. Not a medical device, not clinically "
        "validated, and not cleared by any regulator. Only a haemoglobin blood "
        "test can confirm or rule out anaemia."
    )

    if settings.inference_provider == "mock":
        return ModelInfoResponse(
            provider="mock",
            model_version="mock-v0",
            model_hash=settings.mst_mock_model_hash or "",
            explainer_available=gemini.is_configured(),
            notice="DEMO MODE — synthetic results. " + notice,
        )

    try:
        from ..ml.manifest import build_manifest, model_hash_for
        from ..ml.predictor import MODEL_VERSION, get_predictor

        manifest = build_manifest()
        predictor = get_predictor(settings.ml_device)
        thresholds = predictor.thresholds
        return ModelInfoResponse(
            provider="real",
            model_version=MODEL_VERSION,
            model_hash=settings.mst_real_model_hash or model_hash_for(manifest),
            operating_threshold=float(thresholds["selected_threshold"]),
            uncertainty_margin=float(thresholds["uncertainty_margin"]),
            selected_candidate=str(predictor.runtime["selected_candidate"]),
            target_sensitivity=float(thresholds.get("target_sensitivity", 0.0)) or None,
            assets=manifest["files"],
            explainer_available=gemini.is_configured(),
            notice=notice,
        )
    except FileNotFoundError as err:
        raise HTTPException(503, str(err)) from err
    except Exception as err:  # noqa: BLE001
        raise HTTPException(503, f"Model unavailable: {err}") from err


class ExplainRequest(BaseModel):
    """The already-computed result to describe. Nothing here is re-derived."""

    decision: str
    risk_category: str
    screening_probability: float = Field(..., ge=0.0, le=1.0)
    operating_threshold: float
    uncertainty_margin: float
    candidate_probabilities: dict[str, float]
    model_disagreement: bool
    near_threshold: bool
    quality_bps: int = Field(..., ge=0, le=10000)
    roi: dict | None = None


class ExplainResponse(BaseModel):
    available: bool
    explanation: str | None = None
    model: str | None = None
    reason: str | None = None
    notice: str = (
        "Generated explanation of an already-computed screening result. It "
        "cannot change the result, and it is not medical advice."
    )


@router.post("/explain", response_model=ExplainResponse)
async def explain(
    body: ExplainRequest,
    user: dict = Depends(require_user),
) -> ExplainResponse:
    settings = get_settings()
    if not gemini.is_configured():
        # Honest unavailability. We never fabricate an explanation locally.
        return ExplainResponse(
            available=False,
            reason="The explainer is not configured on this server (GEMINI_API_KEY is unset).",
        )

    try:
        text = await run_in_threadpool(gemini.explain, body.model_dump())
    except gemini.ExplainerUnavailable as err:
        logger.warning("gemini explainer unavailable: %s", err)
        return ExplainResponse(available=False, reason=str(err))

    return ExplainResponse(available=True, explanation=text, model=settings.gemini_model)
