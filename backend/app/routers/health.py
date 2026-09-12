from fastapi import APIRouter

from ..chain import ChainNotConfigured, get_chain_client
from ..config import get_settings
from ..schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    settings = get_settings()
    live_chain_id: int | None = None
    match: bool | None = None
    status = "ok"

    try:
        chain = get_chain_client()
        live_chain_id = chain.check_chain_id()
        match = live_chain_id == settings.mst_chain_id
        if not match:
            status = "chain_id_mismatch"
    except ChainNotConfigured as err:
        status = f"chain_not_configured: {err}"
    except Exception as err:  # noqa: BLE001 — surface any RPC failure as unhealthy, not a 500
        status = f"rpc_unreachable: {err}"

    return HealthResponse(
        status=status,
        network=settings.mst_network,
        rpc_url=settings.mst_rpc_url,
        expected_chain_id=settings.mst_chain_id,
        live_chain_id=live_chain_id,
        chain_id_match=match,
        registry_address=settings.mst_anemia_registry_address,
        care_pool_address=settings.mst_care_pool_address,
    )
