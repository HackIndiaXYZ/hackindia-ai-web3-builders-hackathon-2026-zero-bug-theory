"""Environment-driven settings. See .env.example for every variable."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite:///./anemiascan.db"

    mst_network: str = "testnet"
    mst_rpc_url: str = "https://testnetrpc.mstblockchain.com"
    mst_chain_id: int = 91562037
    mst_explorer_url: str = "https://testnet.mstscan.com"

    mst_anemia_registry_address: str = ""
    mst_care_pool_address: str = ""
    mst_mock_model_hash: str = ""

    # "real" runs the AnemiaScan V3.1 calibrated bundle (app/ml/); "mock" uses
    # the deterministic synthetic provider and needs no model weights.
    inference_provider: str = "real"
    # Optional override for the real model's on-chain model_hash. Empty falls
    # back to inference.real_model_hash(), which is keccak256 of the installed
    # bundle's sha256 manifest (app/ml/manifest.py) — i.e. derived from the
    # weights, not from a fixed text tag.
    mst_real_model_hash: str = ""
    ml_device: str = "cpu"
    # Refuse to anchor a screening whose model hash is not registered/active on
    # AnemiaRegistry, rather than broadcasting a transaction that reverts with
    # ModelNotFound and charging gas for it.
    require_registered_model: bool = True

    # --- uploads -----------------------------------------------------------
    # Neither FastAPI nor Starlette caps a FILE part (the 1MB max_part_size
    # applies only to non-file fields), so a 28MB upload was accepted.
    max_upload_bytes: int = 12 * 1024 * 1024
    allowed_image_types: str = "image/jpeg,image/png,image/webp,image/heic,image/heif"

    @property
    def allowed_image_type_list(self) -> list[str]:
        return [t.strip().lower() for t in self.allowed_image_types.split(",") if t.strip()]

    # --- auth (Firebase ID tokens) -----------------------------------------
    # Must match the frontend's VITE_FIREBASE_PROJECT_ID; it is the `aud` claim
    # every accepted ID token has to carry.
    # Verification is unconditional: there is deliberately no "disable auth"
    # switch, because a screening endpoint that can be opened by an env var is
    # one bad deploy away from being open. Tests substitute the dependency via
    # FastAPI's dependency_overrides instead, which cannot leak to production.
    firebase_project_id: str = ""

    # --- Gemini explainer (optional) ---------------------------------------
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_timeout_seconds: float = 20.0

    mst_attester_private_key: str = ""
    mst_issuer_private_key: str = ""
    mst_clinic_private_key: str = ""

    wallet_auth_nonce_ttl_seconds: int = 300
    # HMAC secret for session tokens issued after wallet-signature verification.
    # Override in backend/.env for anything beyond local hackathon demo use.
    session_secret: str = "dev-insecure-change-me"
    session_ttl_seconds: int = 3600

    # Vite is configured to use port 3000 in this repository. Keep 5173 for
    # developers using Vite's default, but allow the shipped local UI to read
    # public proof/configuration endpoints from this API too.
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
