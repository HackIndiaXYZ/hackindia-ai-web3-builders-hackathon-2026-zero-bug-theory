"""Sponsor pools and CarePass issuance/redemption.

Hackathon-demo simplification (see app/chain.py's module docstring): every
on-chain write below is signed by a backend-held key, not by the sponsor's
or clinic's own BridgeKey wallet. The wallet-session check on
`/passes/redeem` and `/clinics/authorize` verifies a human controls *a*
wallet (via /auth/challenge + /auth/verify), which is a reasonable operator
gate for a demo, but it is not the same guarantee as the on-chain
CLINIC_ROLE check CarePool.sol itself performs against the backend's single
configured clinic key. A production build would replace the backend
signing calls in this file with client-signed BridgeKey transactions for
createPool/fundPool/redeemCarePass and keep only issueCarePass (a genuine
backend/issuer responsibility) here.
"""

import logging
from datetime import datetime, timezone

from eth_utils import to_checksum_address
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.orm import Session

from .. import carepass
from ..chain import ChainNotConfigured, get_chain_client
from ..config import get_settings
from ..db import get_db
from ..models import AuditEvent, CarePassRecord, CarePoolRecord, ChainTransaction, ScanSession
from ..schemas import (
    CarePassIssueRequest,
    CarePassIssueResponse,
    CarePassRedeemRequest,
    CarePassResponse,
    ClinicAuthorizeRequest,
    PoolCreateRequest,
    PoolFundRequest,
    PoolResponse,
)
from ..security import InvalidSessionToken, verify_session_token

logger = logging.getLogger("anemiascan.carepool")
router = APIRouter(prefix="/carepool", tags=["carepool"])


def require_wallet_session(authorization: str | None = Header(None)) -> str:
    """Minimal operator gate — see module docstring for what this does and
    does not guarantee.
    """
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer session token — call /auth/challenge then /auth/verify first")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = verify_session_token(token)
    except InvalidSessionToken as err:
        raise HTTPException(401, f"invalid session: {err}") from err
    return payload["addr"]


def _pool_to_response(pool: CarePoolRecord) -> PoolResponse:
    tx = pool.chain_tx
    return PoolResponse(
        id=pool.id,
        pool_id_onchain=pool.pool_id_onchain,
        sponsor_address=pool.sponsor_address,
        label=pool.label,
        active=pool.active,
        total_funded_wei=pool.total_funded_wei,
        chain_tx_hash=tx.tx_hash if tx else None,
        chain_tx_status=tx.status if tx else None,
    )


def _pass_to_response(pass_row: CarePassRecord) -> CarePassResponse:
    tx = pass_row.chain_tx
    return CarePassResponse(
        id=pass_row.id,
        pass_id_onchain=pass_row.pass_id_onchain,
        pool_id=pass_row.pool_id,
        scan_session_id=pass_row.scan_session_id,
        pass_hash=pass_row.pass_hash,
        value_wei=pass_row.value_wei,
        status=pass_row.status,
        clinic_address=pass_row.clinic_address,
        chain_tx_hash=tx.tx_hash if tx else None,
        chain_tx_status=tx.status if tx else None,
    )


def _decode_event_arg(contract, event_name: str, receipt, arg_name: str):
    event = getattr(contract.events, event_name)()
    logs = event.process_receipt(receipt)
    if not logs:
        return None
    return logs[0]["args"][arg_name]


@router.post("/pools", response_model=PoolResponse, status_code=201)
def create_pool(body: PoolCreateRequest, db: Session = Depends(get_db)) -> PoolResponse:
    try:
        sponsor_address = to_checksum_address(body.sponsor_address)
    except ValueError as err:
        raise HTTPException(422, "invalid sponsor_address") from err

    settings = get_settings()
    pool = CarePoolRecord(sponsor_address=sponsor_address, label=body.label, active=False)
    db.add(pool)
    db.flush()

    try:
        chain = get_chain_client()
        tx = ChainTransaction(
            purpose="create_pool",
            network=settings.mst_network,
            from_address=chain.address_for("issuer"),
            status="CREATED",
            entity_type="care_pool",
            entity_id=pool.id,
        )
        db.add(tx)
        db.flush()
        pool.chain_tx_id = tx.id

        tx_hash = chain.create_pool()
        tx.tx_hash = tx_hash
        tx.status = "BROADCAST"
        db.commit()

        receipt = chain.wait_for_receipt(tx_hash, timeout=60)
        if receipt["status"] == 1:
            tx.status = "CONFIRMED"
            tx.block_number = receipt["blockNumber"]
            pool.active = True
            pool.pool_id_onchain = _decode_event_arg(chain.care_pool, "PoolCreated", receipt, "poolId")
        else:
            tx.status = "FAILED"
            tx.error_message = "transaction reverted on-chain"
        db.add(
            AuditEvent(
                event_type="pool_created",
                actor=chain.address_for("issuer"),
                entity_type="care_pool",
                entity_id=pool.id,
                detail={"sponsor_address": sponsor_address, "tx_hash": tx_hash, "pool_id_onchain": pool.pool_id_onchain},
            )
        )
        db.commit()
    except ChainNotConfigured as err:
        logger.warning("chain not configured, pool recorded off-chain only: %s", err)
        db.commit()

    return _pool_to_response(pool)


@router.get("/pools/{pool_db_id}", response_model=PoolResponse)
def get_pool(pool_db_id: str, db: Session = Depends(get_db)) -> PoolResponse:
    pool = db.get(CarePoolRecord, pool_db_id)
    if pool is None:
        raise HTTPException(404, "pool not found")
    return _pool_to_response(pool)


@router.post("/pools/{pool_db_id}/fund", response_model=PoolResponse)
def fund_pool(pool_db_id: str, body: PoolFundRequest, db: Session = Depends(get_db)) -> PoolResponse:
    pool = db.get(CarePoolRecord, pool_db_id)
    if pool is None:
        raise HTTPException(404, "pool not found")
    if pool.pool_id_onchain is None:
        raise HTTPException(409, "pool has not confirmed on-chain yet — retry once createPool is CONFIRMED")

    try:
        amount_wei = int(body.amount_wei)
        if amount_wei <= 0:
            raise ValueError
    except ValueError as err:
        raise HTTPException(422, "amount_wei must be a positive decimal integer string") from err

    settings = get_settings()
    chain = get_chain_client()
    tx = ChainTransaction(
        purpose="fund_pool",
        network=settings.mst_network,
        from_address=chain.address_for("issuer"),
        status="CREATED",
        entity_type="care_pool",
        entity_id=pool.id,
    )
    db.add(tx)
    db.flush()

    tx_hash = chain.fund_pool(pool.pool_id_onchain, amount_wei)
    tx.tx_hash = tx_hash
    tx.status = "BROADCAST"
    db.commit()

    receipt = chain.wait_for_receipt(tx_hash, timeout=60)
    if receipt["status"] == 1:
        tx.status = "CONFIRMED"
        tx.block_number = receipt["blockNumber"]
        pool.total_funded_wei = str(int(pool.total_funded_wei) + amount_wei)
    else:
        tx.status = "FAILED"
        tx.error_message = "transaction reverted on-chain"
    db.commit()

    return _pool_to_response(pool)


@router.post("/passes", response_model=CarePassIssueResponse, status_code=201)
def issue_care_pass(body: CarePassIssueRequest, db: Session = Depends(get_db)) -> CarePassIssueResponse:
    pool = db.get(CarePoolRecord, body.pool_id)
    if pool is None or pool.pool_id_onchain is None:
        raise HTTPException(404, "pool not found or not confirmed on-chain")

    scan_session = db.query(ScanSession).filter(ScanSession.scan_id_hash == body.scan_id_hash).first()
    if scan_session is None:
        raise HTTPException(404, "screening not found")
    if not scan_session.registered_on_chain or scan_session.revoked:
        raise HTTPException(
            409, "screening is not a currently-verified on-chain commitment — cannot issue a CarePass against it"
        )

    try:
        value_wei = int(body.value_wei)
        if value_wei <= 0:
            raise ValueError
    except ValueError as err:
        raise HTTPException(422, "value_wei must be a positive decimal integer string") from err

    secret = carepass.generate_secret()
    pass_hash = carepass.pass_hash_of(secret)

    pass_row = CarePassRecord(
        pool_id=pool.id,
        scan_session_id=scan_session.id,
        secret_hex=secret,
        pass_hash=pass_hash,
        value_wei=str(value_wei),
        status="pending_chain",
    )
    db.add(pass_row)
    db.flush()

    settings = get_settings()
    chain = get_chain_client()
    tx = ChainTransaction(
        purpose="issue_care_pass",
        network=settings.mst_network,
        from_address=chain.address_for("issuer"),
        status="CREATED",
        entity_type="care_pass",
        entity_id=pass_row.id,
    )
    db.add(tx)
    db.flush()
    pass_row.chain_tx_id = tx.id

    tx_hash = chain.issue_care_pass(pool.pool_id_onchain, body.scan_id_hash, scan_session.commitment, pass_hash, value_wei)
    tx.tx_hash = tx_hash
    tx.status = "BROADCAST"
    db.commit()

    receipt = chain.wait_for_receipt(tx_hash, timeout=60)
    if receipt["status"] == 1:
        tx.status = "CONFIRMED"
        tx.block_number = receipt["blockNumber"]
        pass_row.pass_id_onchain = _decode_event_arg(chain.care_pool, "CarePassIssued", receipt, "passId")
        pass_row.status = "issued"
    else:
        tx.status = "FAILED"
        tx.error_message = "transaction reverted on-chain"
        pass_row.status = "failed"

    db.add(
        AuditEvent(
            event_type="care_pass_issued",
            actor=chain.address_for("issuer"),
            entity_type="care_pass",
            entity_id=pass_row.id,
            detail={"pool_id_onchain": pool.pool_id_onchain, "pass_hash": pass_hash, "tx_hash": tx_hash},
        )
    )
    db.commit()

    if pass_row.status != "issued":
        raise HTTPException(502, f"issueCarePass transaction failed on-chain: {tx.error_message}")

    return CarePassIssueResponse(
        care_pass_id=pass_row.id,
        token=carepass.encode_token(secret),
        pass_hash=pass_hash,
        value_wei=str(value_wei),
        chain_tx_hash=tx_hash,
        chain_tx_status=tx.status,
    )


@router.get("/passes/{pass_db_id}", response_model=CarePassResponse)
def get_pass(pass_db_id: str, db: Session = Depends(get_db)) -> CarePassResponse:
    pass_row = db.get(CarePassRecord, pass_db_id)
    if pass_row is None:
        raise HTTPException(404, "care pass not found")
    return _pass_to_response(pass_row)


@router.post("/passes/redeem", response_model=CarePassResponse)
def redeem_care_pass(
    body: CarePassRedeemRequest, db: Session = Depends(get_db), operator: str = Depends(require_wallet_session)
) -> CarePassResponse:
    try:
        secret = carepass.decode_token(body.token)
    except ValueError as err:
        raise HTTPException(422, str(err)) from err

    pass_hash = carepass.pass_hash_of(secret)
    pass_row = db.query(CarePassRecord).filter(CarePassRecord.pass_hash == pass_hash).first()
    if pass_row is None:
        raise HTTPException(404, "no CarePass matches this token")
    if pass_row.status != "issued":
        raise HTTPException(409, f"CarePass is not redeemable (status={pass_row.status})")

    settings = get_settings()
    chain = get_chain_client()
    tx = ChainTransaction(
        purpose="redeem_care_pass",
        network=settings.mst_network,
        from_address=chain.address_for("clinic"),
        status="CREATED",
        entity_type="care_pass",
        entity_id=pass_row.id,
    )
    db.add(tx)
    db.flush()

    tx_hash = chain.redeem_care_pass(secret)
    tx.tx_hash = tx_hash
    tx.status = "BROADCAST"
    db.commit()

    receipt = chain.wait_for_receipt(tx_hash, timeout=60)
    if receipt["status"] == 1:
        tx.status = "CONFIRMED"
        tx.block_number = receipt["blockNumber"]
        pass_row.status = "redeemed"
        pass_row.clinic_address = chain.address_for("clinic")
        pass_row.settled_at = datetime.now(timezone.utc)
    else:
        tx.status = "FAILED"
        tx.error_message = "transaction reverted on-chain"

    db.add(
        AuditEvent(
            event_type="care_pass_redeemed",
            actor=operator,
            entity_type="care_pass",
            entity_id=pass_row.id,
            detail={"tx_hash": tx_hash, "status": pass_row.status},
        )
    )
    db.commit()

    if pass_row.status != "redeemed":
        raise HTTPException(502, f"redeemCarePass transaction failed on-chain: {tx.error_message}")

    return _pass_to_response(pass_row)


@router.post("/clinics/authorize")
def authorize_clinic(
    body: ClinicAuthorizeRequest, db: Session = Depends(get_db), operator: str = Depends(require_wallet_session)
) -> dict:
    try:
        clinic_address = to_checksum_address(body.clinic_address)
    except ValueError as err:
        raise HTTPException(422, "invalid clinic_address") from err

    chain = get_chain_client()
    tx_hash = chain.authorize_clinic(clinic_address)
    receipt = chain.wait_for_receipt(tx_hash, timeout=60)

    db.add(
        AuditEvent(
            event_type="clinic_authorized",
            actor=operator,
            entity_type="clinic",
            entity_id=clinic_address,
            detail={"tx_hash": tx_hash, "confirmed": receipt["status"] == 1},
        )
    )
    db.commit()

    return {"clinic_address": clinic_address, "tx_hash": tx_hash, "confirmed": receipt["status"] == 1}
