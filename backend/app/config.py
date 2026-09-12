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
    # Optional override for the real model's on-chain model_hash; empty
    # falls back to inference.REAL_MODEL_HASH (a fixed, computed constant).
    mst_real_model_hash: str = ""
    ml_device: str = "cpu"

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

