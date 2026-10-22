"""Public, non-persisting AnemiaScan V4 analysis endpoint."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..ml.predictor import (
    MODEL_VERSION,
    InvalidImageError,
    ModelUnavailableError,
    get_predictor,
)
from fastapi import Depends
from sqlalchemy.orm import Session
from ..db import get_db
from ..models import ScanSession
from ..commitment import build_screening_commitment
from ..routers.registry import _random_hash32
from ..inference import _DECISION_TO_CODES

router = APIRouter(prefix="/api/anemia", tags=["anemia-v4"])
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}


class QualityResponse(BaseModel):
    accepted: bool
    brightness: float = Field(ge=0, le=255)
    blurVariance: float = Field(ge=0)
    clippedFraction: float = Field(ge=0, le=1)
    failures: list[str]


class ConfusionMatrixResponse(BaseModel):
    tn: int = Field(ge=0)
    fp: int = Field(ge=0)
    fn: int = Field(ge=0)
    tp: int = Field(ge=0)


class BenchmarkResponse(BaseModel):
    label: Literal["Internal development benchmark"]
    samples: int = Field(gt=0)
    accuracy: float = Field(ge=0, le=1)
    sensitivity: float = Field(ge=0, le=1)
    specificity: float = Field(ge=0, le=1)
    auroc: float = Field(ge=0, le=1)
    f1: float = Field(ge=0, le=1)
    confusionMatrix: ConfusionMatrixResponse


class AnalyzeResponse(BaseModel):
    modelVersion: Literal["anemiascan-v4-eff-conv-vit"]
    modelHash: str
    decision: Literal["higher_risk", "lower_risk", "uncertain", "recapture_required"]
    screeningProbability: float | None = Field(default=None, ge=0, le=1)
    operatingThreshold: float = Field(gt=0, lt=1)
    uncertain: bool
    quality: QualityResponse
    benchmark: BenchmarkResponse
    warning: str
    scanHash: str

async def _read_limited(upload: UploadFile, maximum: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(min(1024 * 1024, maximum + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > maximum:
            raise HTTPException(413, f"Image exceeds the {maximum}-byte upload limit.")
        chunks.append(chunk)
    if total == 0:
        raise HTTPException(422, "The uploaded image is empty.")
    return b"".join(chunks)


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_anemia(
    image: UploadFile = File(...),
    db: Session = Depends(get_db)
) -> AnalyzeResponse:
    import hashlib
    import time
    import uuid
    settings = get_settings()
    if image.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(422, "Upload a PNG or JPEG conjunctiva ROI image.")
    try:
        image_bytes = await _read_limited(image, settings.ml_max_upload_bytes)
        predictor = await run_in_threadpool(get_predictor, settings.ml_device)
        prediction = await run_in_threadpool(predictor.predict_bytes, image_bytes)
        quality = prediction["quality"]
        benchmark = predictor.internal_benchmark()
        
        if prediction["decision"] == "recapture_required":
            scan_hash = "not-applicable"
        else:
            risk_code, recommendation_code = _DECISION_TO_CODES[prediction["decision"]]
            confidence_bps = max(0, min(10000, round(prediction["screening_probability"] * 10000)))
            quality_bps = 10000
            scan_id_hash = _random_hash32()
            salt = _random_hash32()
            image_digest = "0x" + hashlib.sha256(image_bytes).hexdigest()
            captured_at = int(time.time())
            dummy_consent = "0x" + "00" * 32
            
            commitment = build_screening_commitment(
                scan_id_hash=scan_id_hash,
                image_digest=image_digest,
                model_hash=predictor.model_hash,
                risk_code=risk_code,
                recommendation_code=recommendation_code,
                confidence_bps=confidence_bps,
                quality_bps=quality_bps,
                consent_hash=dummy_consent,
                captured_at=captured_at,
                salt=salt,
            )
            
            scan_session = ScanSession(
                scan_id_hash=scan_id_hash,
                image_digest=image_digest,
                model_hash=predictor.model_hash,
                risk_code=risk_code,
                recommendation_code=recommendation_code,
                confidence_bps=confidence_bps,
                quality_bps=quality_bps,
                consent_hash=dummy_consent,
                captured_at=captured_at,
                salt=salt,
                commitment=commitment,
                is_synthetic=False,
                registered_on_chain=False,
            )
            db.add(scan_session)
            db.commit()
            
            scan_hash = scan_id_hash

        
        return AnalyzeResponse(
            modelVersion=MODEL_VERSION,
            modelHash=predictor.model_hash,
            decision=prediction["decision"],
            screeningProbability=prediction["screening_probability"],
            operatingThreshold=prediction["operating_threshold"],
            uncertain=prediction["uncertain"],
            quality=QualityResponse(
                accepted=quality["accepted"],
                brightness=quality["brightness"],
                blurVariance=quality["blur_variance"],
                clippedFraction=quality["clipped_fraction"],
                failures=quality["failures"],
            ),
            benchmark=BenchmarkResponse(
                label=benchmark["label"],
                samples=benchmark["samples"],
                accuracy=benchmark["accuracy"],
                sensitivity=benchmark["sensitivity"],
                specificity=benchmark["specificity"],
                auroc=benchmark["auroc"],
                f1=benchmark["f1"],
                confusionMatrix=ConfusionMatrixResponse(**benchmark["confusion_matrix"]),
            ),
            warning=prediction["warning"],
            scanHash=scan_hash,
        )
    except HTTPException:
        raise
    except InvalidImageError as error:
        raise HTTPException(422, str(error)) from error
    except (ModelUnavailableError, RuntimeError, OSError, ValueError) as error:
        raise HTTPException(503, f"AnemiaScan V4 model unavailable: {error}") from error
    finally:
        await image.close()
