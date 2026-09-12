"""ORM models.

Hybrid data model, matching docs/DEPLOYMENT.md:

    PostgreSQL/SQLite -> private operational data (drafts, sessions, nonces, audit log)
    MST               -> independently verifiable proofs, programme accounting and state

Nothing here stores a raw eye image, patient identity, or raw lab value —
only digests/hashes of those, mirroring exactly what's allowed on-chain (see
the privacy boundary table in docs/DEPLOYMENT.md).
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ModelVersion(Base):
    """Mirrors AnemiaRegistry.ModelVersion. One row per registerModel() call."""

    __tablename__ = "model_versions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    model_hash: Mapped[str] = mapped_column(String(66), unique=True, index=True, nullable=False)
    uri: Mapped[str] = mapped_column(Text, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_mock: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    registered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    chain_tx_id: Mapped[str | None] = mapped_column(ForeignKey("chain_transactions.id"), nullable=True)

    chain_tx: Mapped["ChainTransaction | None"] = relationship(foreign_keys=[chain_tx_id])


class ScanSession(Base):
    """One screening. `commitment` is the ANEMIASCAN_SCREENING_COMMITMENT_V1
    hash that either matches AnemiaRegistry (registered_on_chain=True) or is
    still pending broadcast/confirmation via chain_tx.
    """

    __tablename__ = "scan_sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    scan_id_hash: Mapped[str] = mapped_column(String(66), unique=True, index=True, nullable=False)
    image_digest: Mapped[str] = mapped_column(String(66), nullable=False)
    model_hash: Mapped[str] = mapped_column(String(66), nullable=False)
    risk_code: Mapped[int] = mapped_column(Integer, nullable=False)
    recommendation_code: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    quality_bps: Mapped[int] = mapped_column(Integer, nullable=False)
    consent_hash: Mapped[str] = mapped_column(String(66), nullable=False)
    captured_at: Mapped[int] = mapped_column(Integer, nullable=False)  # unix seconds, matches uint64 on-chain
    salt: Mapped[str] = mapped_column(String(66), nullable=False)
    commitment: Mapped[str] = mapped_column(String(66), unique=True, index=True, nullable=False)

    is_synthetic: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    registered_on_chain: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)

    chain_tx_id: Mapped[str | None] = mapped_column(ForeignKey("chain_transactions.id"), nullable=True)
    chain_tx: Mapped["ChainTransaction | None"] = relationship(foreign_keys=[chain_tx_id])


class CarePoolRecord(Base):
    """Off-chain mirror of a CarePool.Pool. `pool_id_onchain` is null until
    the create-pool transaction confirms; reconciliation fills it in from
    the PoolCreated event.
    """

    __tablename__ = "care_pools"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    pool_id_onchain: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    sponsor_address: Mapped[str] = mapped_column(String(42), index=True, nullable=False)
    label: Mapped[str] = mapped_column(String(200), default="", nullable=False)
    # False until the createPool transaction confirms on-chain (see reconciliation.py).
    active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    total_funded_wei: Mapped[str] = mapped_column(String(78), default="0", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)

    chain_tx_id: Mapped[str | None] = mapped_column(ForeignKey("chain_transactions.id"), nullable=True)
    chain_tx: Mapped["ChainTransaction | None"] = relationship(foreign_keys=[chain_tx_id])


class CarePassRecord(Base):
    """Off-chain mirror of a CarePool.CarePass, plus the redemption secret.

    `secret_hex` is operationally sensitive — whoever holds it (or the
    ANEMIASCAN-CAREPASS|1|<token> built from it) can redeem the pass. Treat
    it like a bearer credential, not like public data.
    """

    __tablename__ = "care_passes"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    pass_id_onchain: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    pool_id: Mapped[str] = mapped_column(ForeignKey("care_pools.id"), nullable=False)
    scan_session_id: Mapped[str] = mapped_column(ForeignKey("scan_sessions.id"), nullable=False)

    secret_hex: Mapped[str] = mapped_column(String(66), unique=True, nullable=False)
    pass_hash: Mapped[str] = mapped_column(String(66), unique=True, index=True, nullable=False)
    value_wei: Mapped[str] = mapped_column(String(78), nullable=False)

    # pending_chain -> issued -> redeemed | cancelled ; or pending_chain -> failed
    status: Mapped[str] = mapped_column(String(16), default="pending_chain", nullable=False)
    clinic_address: Mapped[str | None] = mapped_column(String(42), nullable=True)

    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    chain_tx_id: Mapped[str | None] = mapped_column(ForeignKey("chain_transactions.id"), nullable=True)
    chain_tx: Mapped["ChainTransaction | None"] = relationship(foreign_keys=[chain_tx_id])

    pool: Mapped["CarePoolRecord"] = relationship()
    scan_session: Mapped["ScanSession"] = relationship()


class ChainTransaction(Base):
    """Tracks one MST write from intent to settlement, independent of
    whichever DB row it's for — the reconciliation worker only needs this
    table to recover from a crash/timeout between broadcast and confirmation.

    status: CREATED -> BROADCAST -> CONFIRMED | FAILED
    """

    __tablename__ = "chain_transactions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    purpose: Mapped[str] = mapped_column(String(64), nullable=False)
    network: Mapped[str] = mapped_column(String(32), nullable=False)
    from_address: Mapped[str] = mapped_column(String(42), nullable=False)
    tx_hash: Mapped[str | None] = mapped_column(String(66), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="CREATED", index=True, nullable=False)
    block_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Generic pointer so the reconciliation worker can flip the right row's
    # confirmed-state flag without purpose-specific branching. Not a real FK
    # (entity_type picks the table) — deliberately loose for this table only.
    entity_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(66), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now, nullable=False)


class WalletAuthNonce(Base):
    """Challenge-response wallet auth for sponsor/clinic BridgeKey wallets.
    Not used by the (walletless) patient flow.
    """

    __tablename__ = "wallet_auth_nonces"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    address: Mapped[str] = mapped_column(String(42), index=True, nullable=False)
    nonce: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class AuditEvent(Base):
    """Append-only audit trail for the /audit dashboard, independent of
    (and a superset of) what's discoverable purely from on-chain events —
    covers off-chain-only actions too (e.g. a nonce being issued).
    """

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    event_type: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    actor: Mapped[str] = mapped_column(String(64), default="system", nullable=False)
    entity_type: Mapped[str] = mapped_column(String(32), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(66), index=True, nullable=False)
    detail: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True, nullable=False)
