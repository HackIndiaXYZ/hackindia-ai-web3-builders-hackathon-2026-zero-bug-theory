"""Pydantic request/response schemas.

Note what is deliberately absent: no field anywhere in this file carries a
raw image, a patient name/phone/email, a raw risk label outside the coded
enums, or a raw lab value. See the privacy boundary table in
docs/DEPLOYMENT.md — these schemas are the enforcement point for it at the
API layer (Postgres/SQLite constraints and the Solidity ABI enforce it
again, independently, at the other two layers).
"""

from datetime import datetime

from pydantic import BaseModel, Field

DEMO_MODE_NOTICE = (
    "DEMO MODE — AI model integration pending. This result is synthetic and must not be "
    "interpreted medically."
)


# -- auth --------------------------------------------------------------


class ChallengeRequest(BaseModel):
    address: str = Field(..., min_length=42, max_length=42)


class ChallengeResponse(BaseModel):
    address: str
    nonce: str
    message: str
    expires_at: datetime


class VerifyRequest(BaseModel):
    address: str
    signature: str


class VerifyResponse(BaseModel):
    token: str
    address: str
    role: str
    expires_in_seconds: int


# -- registry / screenings ----------------------------------------------
#
# POST /registry/screenings takes multipart/form-data (an `image` file plus
# `consent_hash`/`captured_at` form fields), not a JSON body, since it must
# carry the raw captured image for real inference — see
# routers/registry.py:create_screening for the actual FastAPI signature.
# There is deliberately no request schema class here for that reason.


class ScreeningResponse(BaseModel):
    scan_session_id: str
    scan_id_hash: str
    commitment: str
    model_hash: str
    risk_code: int
    recommendation_code: int
    confidence_bps: int
    quality_bps: int
    is_synthetic: bool
    demo_notice: str = DEMO_MODE_NOTICE
    registered_on_chain: bool
    chain_tx_hash: str | None
    chain_tx_status: str | None
    explorer_url: str | None


class ScreeningVerifyRequest(BaseModel):
    """Recomputes the commitment from the given fields and checks it both
    against the caller's claimed commitment and against what AnemiaRegistry
    actually has on file — this is the tamper-evidence check.
    """

    scan_id_hash: str
    image_digest: str
    model_hash: str
    risk_code: int
    recommendation_code: int
    confidence_bps: int
    quality_bps: int
    consent_hash: str
    captured_at: int
    salt: str
    claimed_commitment: str


class ScreeningVerifyResponse(BaseModel):
    recomputed_commitment: str
    matches_claimed_commitment: bool
    matches_on_chain: bool
    on_chain_registered: bool
    on_chain_revoked: bool | None = None


# -- care pool / care pass ------------------------------------------------


class PoolCreateRequest(BaseModel):
    sponsor_address: str = Field(..., min_length=42, max_length=42)
    label: str = Field("", max_length=200)


class PoolFundRequest(BaseModel):
    amount_wei: str = Field(..., description="decimal string — native MSTC amount in wei")


class PoolResponse(BaseModel):
    id: str
    pool_id_onchain: int | None
    sponsor_address: str
    label: str
    active: bool
    total_funded_wei: str
    chain_tx_hash: str | None
    chain_tx_status: str | None


class CarePassIssueRequest(BaseModel):
    pool_id: str = Field(..., description="AnemiaScan pool id (care_pools.id), not the on-chain pool id")
    scan_id_hash: str
    value_wei: str


class CarePassIssueResponse(BaseModel):
    care_pass_id: str
    token: str = Field(..., description="ANEMIASCAN-CAREPASS|1|<token> — show this once; it redeems the pass")
    pass_hash: str
    value_wei: str
    chain_tx_hash: str | None
    chain_tx_status: str | None


class CarePassRedeemRequest(BaseModel):
    token: str


class CarePassResponse(BaseModel):
    id: str
    pass_id_onchain: int | None
    pool_id: str
    scan_session_id: str
    pass_hash: str
    value_wei: str
    status: str
    clinic_address: str | None
    chain_tx_hash: str | None
    chain_tx_status: str | None


class ClinicAuthorizeRequest(BaseModel):
    clinic_address: str = Field(..., min_length=42, max_length=42)


# -- health / audit --------------------------------------------------------


class HealthResponse(BaseModel):
    status: str
    network: str
    rpc_url: str
    expected_chain_id: int
    live_chain_id: int | None
    chain_id_match: bool | None
    registry_address: str
    care_pool_address: str


# -- public blockchain read model ------------------------------------------
#
# These endpoints deliberately expose chain *state*, not backend signing
# powers. Browser wallets perform sponsor/clinic writes directly; the API is
# the trusted source for the deployed contract configuration and a convenient
# source for read-only confirmation.


class BlockchainConfigResponse(BaseModel):
    status: str
    network: str
    chain_id: int
    live_chain_id: int | None
    explorer_url: str
    registry_address: str
    care_pool_address: str


class OnChainPoolResponse(BaseModel):
    pool_id: int
    sponsor_address: str
    total_funded_wei: str
    total_reserved_wei: str
    total_redeemed_wei: str
    available_wei: str
    active: bool


class ClinicAuthorizationResponse(BaseModel):
    clinic_address: str
    authorized: bool


class ChainTransactionStatusResponse(BaseModel):
    transaction_hash: str
    status: str
    block_number: int | None


class AuditEventResponse(BaseModel):
    id: str
    event_type: str
    actor: str
    entity_type: str
    entity_id: str
    detail: dict
    created_at: datetime
