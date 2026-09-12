"""Screening intake + tamper verification.

The patient flow stays walletless -- screenings are anchored by the backend's
own ATTESTER_ROLE key, not by an end-user wallet -- but the endpoint is no
longer open. It requires a verified Firebase ID token (app/firebase_auth.py),
because previously Firebase gated only the UI and anyone could POST an image
straight to this service. The verified uid authorises the call and is
deliberately NOT persisted with the screening, preserving the privacy boundary
in docs/DEPLOYMENT.md.

The canonical path for this operation is POST /inference/predict (see
routers/inference.py); POST /registry/screenings is kept as an alias so
existing clients keep working.
"""

import logging
import os
import time

from eth_utils import keccak
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool
from web3 import Web3

from ..chain import ChainNotConfigured, get_chain_client
from ..commitment import build_screening_commitment
from ..config import get_settings
from ..db import get_db
from ..firebase_auth import require_user
from ..inference import REAL_MODEL_WARNING, get_inference_provider
from ..models import AuditEvent, ChainTransaction, ScanSession
from ..schemas import (
    DEMO_MODE_NOTICE,
    HASH32,
    ScreeningResponse,
    ScreeningVerifyRequest,
    ScreeningVerifyResponse,
)
from ..uploads import read_image_upload

logger = logging.getLogger("anemiascan.registry")
router = APIRouter(prefix="/registry", tags=["registry"])


def _explorer_url(settings, address_or_tx: str, kind: str = "tx") -> str:
    return f"{settings.mst_explorer_url}/{kind}/{address_or_tx}"


def _random_hash32() -> str:
    return "0x" + keccak(os.urandom(32)).hex()


async def run_screening(
    *,
    image: UploadFile,
    consent_hash: str,
    captured_at: int | None,
    db: Session,
) -> ScreeningResponse:
    """Score one capture, commit it, and (when configured) anchor it on-chain.

    Shared by POST /inference/predict and the POST /registry/screenings alias.
    """
    settings = get_settings()
    if settings.inference_provider == "mock" and not settings.mst_mock_model_hash:
        raise HTTPException(
            503,
            "MST_MOCK_MODEL_HASH is not configured. Run `npm run grant-roles:testnet` in contracts/ "
            "and copy the printed hash into backend/.env.",
        )

    image_bytes, _ = await read_image_upload(
        image,
        max_bytes=settings.max_upload_bytes,
        allowed_types=settings.allowed_image_type_list,
    )

    try:
        provider = get_inference_provider(settings)
    except (ValueError, FileNotFoundError) as err:
        raise HTTPException(503, str(err)) from err

    try:
        outcome = await run_in_threadpool(provider.run, image_bytes=image_bytes)
    except RuntimeError as err:
        raise HTTPException(503, str(err)) from err

    if outcome.recapture_required:
        # Hand back WHY, not just "inconclusive". The app shows `message` and
        # can branch on the stable `reasons` codes.
        raise HTTPException(
            422,
            detail={
                "decision": "recapture_required",
                "reasons": outcome.recapture_reasons
                or list(outcome.quality.get("failures", [])),
                "message": outcome.message or outcome.warning,
                "quality": outcome.quality,
                "roi": outcome.roi,
                "gate": outcome.gate,
            },
        )

    result = outcome.result
    captured_at = captured_at or int(time.time())
    scan_id_hash = _random_hash32()
    salt = _random_hash32()

    try:
        commitment = build_screening_commitment(
            scan_id_hash=scan_id_hash,
            image_digest=outcome.image_digest,
            model_hash=result.model_hash,
            risk_code=result.risk_code,
            recommendation_code=result.recommendation_code,
            probability_bps=result.probability_bps,
            quality_bps=result.quality_bps,
            consent_hash=consent_hash,
            captured_at=captured_at,
            salt=salt,
        )
    except ValueError as err:
        # Any malformed hex field is the caller's problem, not a 500.
        raise HTTPException(422, f"invalid commitment field: {err}") from err

    scan_session = ScanSession(
        scan_id_hash=scan_id_hash,
        image_digest=outcome.image_digest,
        model_hash=result.model_hash,
        risk_code=result.risk_code,
        recommendation_code=result.recommendation_code,
        probability_bps=result.probability_bps,
        quality_bps=result.quality_bps,
        consent_hash=consent_hash,
        captured_at=captured_at,
        salt=salt,
        commitment=commitment,
        is_synthetic=result.is_synthetic,
        registered_on_chain=False,
    )
    db.add(scan_session)
    db.flush()  # assigns scan_session.id without committing yet

    tx_status = None
    tx_hash = None

    try:
        chain = get_chain_client()

        # AnemiaRegistry.registerScreening reverts with ModelNotFound unless the
        # model hash was registered via registerModel and is still active. No
        # script registered the REAL model hash, so the first genuine screening
        # would have broadcast a transaction that reverted and burned the gas.
        # Check first, and fail with something the operator can act on.
        if settings.require_registered_model:
            try:
                model = chain.get_model(result.model_hash)
            except Exception as err:  # noqa: BLE001 - an RPC failure means "unknown"
                logger.warning("could not read model registration: %s", err)
                model = None
            if model is not None:
                if not model.get("registeredAt", 0):
                    raise HTTPException(
                        503,
                        f"Model {result.model_hash} is not registered on AnemiaRegistry, so this "
                        "screening cannot be anchored. Run `npm run register-model:local` "
                        "(or register-model:testnet) in contracts/.",
                    )
                if not model.get("active", True):
                    raise HTTPException(
                        503,
                        f"Model {result.model_hash} is registered but inactive on AnemiaRegistry.",
                    )

        tx = ChainTransaction(
            purpose="register_screening",
            network=settings.mst_network,
            from_address=chain.address_for("attester"),
            status="CREATED",
            entity_type="scan_session",
            entity_id=scan_session.id,
        )
        db.add(tx)
        db.flush()
        scan_session.chain_tx_id = tx.id

        tx_hash = chain.register_screening(
            scan_id_hash, commitment, result.model_hash, captured_at
        )
        tx.tx_hash = tx_hash
        tx.status = "BROADCAST"
        db.commit()

        try:
            receipt = chain.wait_for_receipt(tx_hash, timeout=60)
            if receipt["status"] == 1:
                tx.status = "CONFIRMED"
                tx.block_number = receipt["blockNumber"]
                scan_session.registered_on_chain = True
            else:
                tx.status = "FAILED"
                tx.error_message = "transaction reverted on-chain"
        except Exception as err:  # noqa: BLE001 - reconciliation picks this up later
            logger.warning("registerScreening receipt not yet available: %s", err)

        tx_status = tx.status

        db.add(
            AuditEvent(
                event_type="screening_registered",
                actor=chain.address_for("attester"),
                entity_type="scan_session",
                entity_id=scan_session.id,
                detail={
                    "scan_id_hash": scan_id_hash,
                    "commitment": commitment,
                    "tx_hash": tx_hash,
                },
            )
        )
        db.commit()
    except ChainNotConfigured as err:
        logger.warning("chain not configured, commitment computed but not anchored: %s", err)
        db.commit()

    return ScreeningResponse(
        scan_session_id=scan_session.id,
        scan_id_hash=scan_id_hash,
        commitment=commitment,
        model_hash=result.model_hash,
        risk_code=result.risk_code,
        recommendation_code=result.recommendation_code,
        probability_bps=result.probability_bps,
        quality_bps=result.quality_bps,
        is_synthetic=result.is_synthetic,
        demo_notice=outcome.warning,
        model_output=result.detail or None,
        quality=outcome.quality,
        roi=outcome.roi,
        gate=outcome.gate,
        registered_on_chain=scan_session.registered_on_chain,
        chain_tx_hash=tx_hash,
        chain_tx_status=tx_status,
        explorer_url=_explorer_url(settings, tx_hash) if tx_hash else None,
    )


@router.post("/screenings", response_model=ScreeningResponse, status_code=201)
async def create_screening(
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
    """Deprecated alias for POST /inference/predict."""
    return await run_screening(
        image=image, consent_hash=consent_hash, captured_at=captured_at, db=db
    )


@router.get("/screenings/{scan_id_hash}", response_model=ScreeningResponse)
def get_screening(scan_id_hash: str, db: Session = Depends(get_db)) -> ScreeningResponse:
    settings = get_settings()
    scan_session = db.query(ScanSession).filter(ScanSession.scan_id_hash == scan_id_hash).first()
    if scan_session is None:
        raise HTTPException(404, "screening not found")

    tx = scan_session.chain_tx
    return ScreeningResponse(
        scan_session_id=scan_session.id,
        scan_id_hash=scan_session.scan_id_hash,
        commitment=scan_session.commitment,
        model_hash=scan_session.model_hash,
        risk_code=scan_session.risk_code,
        recommendation_code=scan_session.recommendation_code,
        probability_bps=scan_session.probability_bps,
        quality_bps=scan_session.quality_bps,
        is_synthetic=scan_session.is_synthetic,
        demo_notice=DEMO_MODE_NOTICE if scan_session.is_synthetic else REAL_MODEL_WARNING,
        registered_on_chain=scan_session.registered_on_chain,
        chain_tx_hash=tx.tx_hash if tx else None,
        chain_tx_status=tx.status if tx else None,
        explorer_url=_explorer_url(settings, tx.tx_hash) if tx and tx.tx_hash else None,
    )


@router.post("/verify", response_model=ScreeningVerifyResponse)
def verify_screening(body: ScreeningVerifyRequest) -> ScreeningVerifyResponse:
    """Powers the tamper-evidence demo: recompute the commitment from
    whatever fields the caller provides (e.g. a locally-edited result) and
    show that it no longer matches either the originally claimed commitment
    or AnemiaRegistry's on-chain record.
    """
    try:
        recomputed = build_screening_commitment(
            scan_id_hash=body.scan_id_hash,
            image_digest=body.image_digest,
            model_hash=body.model_hash,
            risk_code=body.risk_code,
            recommendation_code=body.recommendation_code,
            probability_bps=body.probability_bps,
            quality_bps=body.quality_bps,
            consent_hash=body.consent_hash,
            captured_at=body.captured_at,
            salt=body.salt,
        )
        matches_claimed = Web3.to_bytes(hexstr=recomputed) == Web3.to_bytes(
            hexstr=body.claimed_commitment
        )
    except ValueError as err:
        raise HTTPException(422, f"invalid field: {err}") from err

    on_chain_registered = False
    on_chain_revoked = None
    matches_on_chain = False
    try:
        chain = get_chain_client()
        screening = chain.get_screening(body.scan_id_hash)
        on_chain_registered = screening["registeredAt"] != 0
        on_chain_revoked = screening["revoked"]
        if on_chain_registered:
            on_chain_commitment = screening["commitment"]
            if not on_chain_commitment.startswith("0x"):
                on_chain_commitment = "0x" + on_chain_commitment
            matches_on_chain = (
                Web3.to_bytes(hexstr=on_chain_commitment) == Web3.to_bytes(hexstr=recomputed) and not on_chain_revoked
            )
    except ChainNotConfigured:
        pass

    return ScreeningVerifyResponse(
        recomputed_commitment=recomputed,
        matches_claimed_commitment=matches_claimed,
        matches_on_chain=matches_on_chain,
        on_chain_registered=on_chain_registered,
        on_chain_revoked=on_chain_revoked,
    )
