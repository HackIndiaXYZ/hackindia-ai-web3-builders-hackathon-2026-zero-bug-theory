from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..chain import get_chain_client
from ..db import get_db
from ..models import AuditEvent
from ..reconciliation import reconcile_pending
from ..schemas import AuditEventResponse

router = APIRouter(tags=["audit"])


@router.get("/audit/events", response_model=list[AuditEventResponse])
def list_audit_events(
    limit: int = Query(50, ge=1, le=500), entity_type: str | None = None, db: Session = Depends(get_db)
) -> list[AuditEvent]:
    q = db.query(AuditEvent).order_by(AuditEvent.created_at.desc())
    if entity_type:
        q = q.filter(AuditEvent.entity_type == entity_type)
    return q.limit(limit).all()


@router.post("/admin/reconcile")
def run_reconciliation(db: Session = Depends(get_db)) -> dict:
    """Manual trigger for the DB<->chain reconciliation pass (also runs on
    a background timer — see app/main.py). Safe to call any time; it only
    reads chain state, never re-submits a transaction.
    """
    return reconcile_pending(db, get_chain_client())
