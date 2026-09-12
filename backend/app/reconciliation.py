"""DB <-> chain reconciliation.

A blockchain write and a database transaction are not atomic together, so
every write here goes through the same state machine:

    CREATED -> BROADCAST -> CONFIRMED
                          -> FAILED

Routers try to confirm synchronously (short wait_for_receipt) so a demo
click resolves quickly, but if the process crashes or times out between
CREATED and CONFIRMED, this worker is what recovers state on the next run —
it never re-submits a transaction, it only reads chain state and reconciles
rows that are already broadcast, or gives up on ones that visibly never
made it out.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from .chain import MstChainClient
from .models import AuditEvent, CarePassRecord, CarePoolRecord, ChainTransaction, ScanSession

logger = logging.getLogger("anemiascan.reconciliation")

STALE_AFTER = timedelta(minutes=10)


def _mark_entity_confirmed(db: Session, tx: ChainTransaction) -> None:
    if tx.entity_type == "scan_session" and tx.entity_id:
        row = db.get(ScanSession, tx.entity_id)
        if row:
            row.registered_on_chain = True
    elif tx.entity_type == "care_pool" and tx.entity_id:
        row = db.get(CarePoolRecord, tx.entity_id)
        if row:
            row.active = True
    elif tx.entity_type == "care_pass" and tx.entity_id:
        row = db.get(CarePassRecord, tx.entity_id)
        if row and row.status == "pending_chain":
            row.status = "issued"


def _mark_entity_failed(db: Session, tx: ChainTransaction) -> None:
    if tx.entity_type == "care_pass" and tx.entity_id:
        row = db.get(CarePassRecord, tx.entity_id)
        if row and row.status == "pending_chain":
            row.status = "failed"


def reconcile_pending(db: Session, chain: MstChainClient) -> dict:
    now = datetime.now(timezone.utc)
    pending = (
        db.query(ChainTransaction)
        .filter(ChainTransaction.status.in_(["CREATED", "BROADCAST"]))
        .all()
    )

    confirmed = failed = still_pending = 0

    for tx in pending:
        if tx.status == "CREATED":
            if _aware(tx.created_at) < now - STALE_AFTER:
                tx.status = "FAILED"
                tx.error_message = "stale: never broadcast"
                _mark_entity_failed(db, tx)
                failed += 1
            else:
                still_pending += 1
            continue

        # BROADCAST
        if not tx.tx_hash:
            tx.status = "FAILED"
            tx.error_message = "BROADCAST with no tx_hash (inconsistent state)"
            _mark_entity_failed(db, tx)
            failed += 1
            continue

        receipt = chain.try_get_receipt(tx.tx_hash)
        if receipt is None:
            if _aware(tx.updated_at) < now - STALE_AFTER:
                tx.status = "FAILED"
                tx.error_message = "timed out waiting for confirmation"
                _mark_entity_failed(db, tx)
                failed += 1
            else:
                still_pending += 1
            continue

        tx.block_number = receipt["blockNumber"]
        if receipt["status"] == 1:
            tx.status = "CONFIRMED"
            _mark_entity_confirmed(db, tx)
            confirmed += 1
        else:
            tx.status = "FAILED"
            tx.error_message = "transaction reverted on-chain"
            _mark_entity_failed(db, tx)
            failed += 1

        db.add(
            AuditEvent(
                event_type="chain_tx_reconciled",
                actor="system",
                entity_type="chain_transaction",
                entity_id=tx.id,
                detail={"tx_hash": tx.tx_hash, "status": tx.status},
            )
        )

    db.commit()
    result = {"confirmed": confirmed, "failed": failed, "still_pending": still_pending, "checked": len(pending)}
    if confirmed or failed:
        logger.info("reconciliation: %s", result)
    return result


def _aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
