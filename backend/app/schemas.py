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


HASH32 = r"^0x[0-9a-fA-F]{64}$"


class QualityReport(BaseModel):
    """Measured capture quality. `blur_variance` is now actually gated on."""

    accepted: bool
    brightness: float
    blur_variance: float | None = None
    clipped_fraction: float | None = None
    failures: list[str] = Field(default_factory=list)


class RoiReport(BaseModel):
    """Where the conjunctiva ROI localiser found tissue, and how it was masked."""

    located: bool
    coverage: float
    masked_fraction: float
    mean_redness_over_yellow: float
    method: str
    bbox: list[int] | None = None
    source_size: list[int] = Field(default_factory=list)
    roi_size: list[int] = Field(default_factory=list)
    failures: list[str] = Field(default_factory=list)


class GateReport(BaseModel):
    """How far the located ROI sits from the model's training distribution."""

    accepted: bool
    failures: list[str] = Field(default_factory=list)
    distribution_budget: float
    distribution_budget_limit: float
    rms_z: float
    max_abs_z: float
    worst_features: list[dict] = Field(default_factory=list)
    chroma_z: dict[str, float] = Field(default_factory=dict)
    texture: dict[str, float] = Field(default_factory=dict)
    logit_z: dict[str, float] = Field(default_factory=dict)


class ModelOutput(BaseModel):
    """Everything the model produced.

    The spec requires the client to receive the calibrated probability, the
    category, both candidate probabilities, the operating threshold, the
    disagreement flag and the fusion weights. Previously the response carried
    none of them: the probability was smuggled through a field called
    `confidence_bps` and everything else was dropped, so the UI could not show
    what the model actually did and the four-way `uncertain` outcome collapsed
    into "Moderate Risk" on screen.
    """

    decision: str = Field(..., description="lower_risk | higher_risk | uncertain")
    risk_category: str
    screening_probability: float = Field(..., ge=0.0, le=1.0)
    probability_bps: int = Field(..., ge=0, le=10000)
    selected_model: str
    operating_threshold: float
    uncertainty_margin: float
    candidate_probabilities: dict[str, float]
    candidate_thresholds: dict[str, float]
    model_disagreement: bool
    near_threshold: bool
    fusion_gate_weights: dict[str, float]
    model_version: str


class RecaptureDetail(BaseModel):
    """Body of the 422 returned when a capture is refused.

    `reasons` are stable machine-readable codes (no_roi_detected,
    degenerate_input, implausible_chroma, excess_high_frequency,
    out_of_distribution, encoder_out_of_range, probability_saturated,
    roi_too_small, roi_coverage_low, extremely_dark, extremely_bright,
    severely_clipped) and `message` is the sentence to show the user. The app
    used to discard both and show a generic "inconclusive" screen, leaving the
    user with no idea what to change.
    """

    decision: str = "recapture_required"
    reasons: list[str] = Field(default_factory=list)
    message: str
    quality: QualityReport | None = None
    roi: RoiReport | None = None
    gate: GateReport | None = None
    model_version: str | None = None


class ScreeningResponse(BaseModel):
    scan_session_id: str
    scan_id_hash: str
    commitment: str
    model_hash: str
    risk_code: int
    recommendation_code: int
    # The calibrated screening probability in basis points. Named for what it
    # is; this is the value recorded on-chain as `probabilityBps`.
    probability_bps: int
    # A measured capture-quality score, not the constant 10000 that used to be
    # written here for every accepted capture.
    quality_bps: int
    is_synthetic: bool
    demo_notice: str = DEMO_MODE_NOTICE
    model_output: ModelOutput | None = None
    quality: QualityReport | None = None
    roi: RoiReport | None = None
    gate: GateReport | None = None
    registered_on_chain: bool
    chain_tx_hash: str | None
    chain_tx_status: str | None
    explorer_url: str | None


class ScreeningVerifyRequest(BaseModel):
    """Recomputes the commitment from the given fields and checks it both
    against the caller's claimed commitment and against what AnemiaRegistry
    actually has on file — this is the tamper-evidence check.
    """

    # Every hash field is pattern-constrained so malformed hex is rejected as a
    # 422 by Pydantic. Without these, a value like "0x1234" reached
    # commitment._to_bytes32's bare bytes.fromhex and raised an unhandled
    # ValueError, which FastAPI turned into a 500 with a plain-text
    # "Internal Server Error" body the frontend could not even parse.
    scan_id_hash: str = Field(..., pattern=HASH32)
    image_digest: str = Field(..., pattern=HASH32)
    model_hash: str = Field(..., pattern=HASH32)
    risk_code: int = Field(..., ge=0, le=255)
    recommendation_code: int = Field(..., ge=0, le=255)
    probability_bps: int = Field(..., ge=0, le=65535)
    quality_bps: int = Field(..., ge=0, le=65535)
    consent_hash: str = Field(..., pattern=HASH32)
    captured_at: int = Field(..., ge=0, le=2**64 - 1)
    salt: str = Field(..., pattern=HASH32)
    claimed_commitment: str = Field(..., pattern=HASH32)


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

