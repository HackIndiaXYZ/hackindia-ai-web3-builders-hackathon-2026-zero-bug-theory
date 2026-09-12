"""Read-only API bridge for the browser blockchain workspace.

The frontend uses this router to discover the deployed MST contracts and to
confirm public chain state. It intentionally contains no transaction-sending
endpoints: sponsors fund with their own wallet and clinics redeem with their
own wallet, so the backend cannot become a custodian or a confused deputy.
"""

from eth_utils import to_checksum_address
from fastapi import APIRouter, HTTPException, Path

from ..chain import ChainNotConfigured, get_chain_client
from ..config import get_settings
from ..schemas import (
    BlockchainConfigResponse,
    ChainTransactionStatusResponse,
    ClinicAuthorizationResponse,
    OnChainPoolResponse,
)

router = APIRouter(prefix="/blockchain", tags=["blockchain"])


@router.get("/config", response_model=BlockchainConfigResponse)
def blockchain_config() -> BlockchainConfigResponse:
    settings = get_settings()
    live_chain_id: int | None = None
    status = "ready"
    try:
        live_chain_id = get_chain_client().check_chain_id()
        if live_chain_id != settings.mst_chain_id:
            status = "chain_id_mismatch"
    except ChainNotConfigured as err:
        status = f"not_configured: {err}"
    except Exception:  # noqa: BLE001 - expose a stable, non-sensitive state to the UI
        status = "rpc_unreachable"

    return BlockchainConfigResponse(
        status=status,
        network=settings.mst_network,
        chain_id=settings.mst_chain_id,
        live_chain_id=live_chain_id,
        explorer_url=settings.mst_explorer_url,
        registry_address=settings.mst_anemia_registry_address,
        care_pool_address=settings.mst_care_pool_address,
    )


@router.get("/pools/{pool_id}", response_model=OnChainPoolResponse)
def read_pool(pool_id: int = Path(..., ge=1)) -> OnChainPoolResponse:
    try:
        pool = get_chain_client().get_pool(pool_id)
    except ChainNotConfigured:
        raise
    except Exception as err:  # invalid/nonexistent pools are contract errors, not server faults
        raise HTTPException(404, "pool not found on MST") from err

    total_funded = int(pool["totalFunded"])
    total_reserved = int(pool["totalReserved"])
    total_redeemed = int(pool["totalRedeemed"])
    return OnChainPoolResponse(
        pool_id=pool_id,
        sponsor_address=pool["sponsor"],
        total_funded_wei=str(total_funded),
        total_reserved_wei=str(total_reserved),
        total_redeemed_wei=str(total_redeemed),
        available_wei=str(total_funded - total_reserved - total_redeemed),
        active=pool["active"],
    )


@router.get("/clinics/{clinic_address}", response_model=ClinicAuthorizationResponse)
def read_clinic_authorization(clinic_address: str) -> ClinicAuthorizationResponse:
    try:
        address = to_checksum_address(clinic_address)
    except ValueError as err:
        raise HTTPException(422, "invalid clinic address") from err
    return ClinicAuthorizationResponse(
        clinic_address=address,
        authorized=get_chain_client().is_clinic_authorized(address),
    )


@router.get("/transactions/{transaction_hash}", response_model=ChainTransactionStatusResponse)
def read_transaction(transaction_hash: str) -> ChainTransactionStatusResponse:
    if not transaction_hash.startswith("0x") or len(transaction_hash) != 66:
        raise HTTPException(422, "invalid transaction hash")
    receipt = get_chain_client().try_get_receipt(transaction_hash)
    if receipt is None:
        return ChainTransactionStatusResponse(
            transaction_hash=transaction_hash,
            status="pending",
            block_number=None,
        )
    return ChainTransactionStatusResponse(
        transaction_hash=transaction_hash,
        status="confirmed" if receipt["status"] == 1 else "reverted",
        block_number=int(receipt["blockNumber"]),
    )

