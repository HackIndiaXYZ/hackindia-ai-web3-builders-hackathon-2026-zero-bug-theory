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

    mst_attester_private_key: str = ""
    mst_issuer_private_key: str = ""
    mst_clinic_private_key: str = ""

    wallet_auth_nonce_ttl_seconds: int = 300
    # HMAC secret for session tokens issued after wallet-signature verification.
    # Override in backend/.env for anything beyond local hackathon demo use.
    session_secret: str = "dev-insecure-change-me"
    session_ttl_seconds: int = 3600

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
