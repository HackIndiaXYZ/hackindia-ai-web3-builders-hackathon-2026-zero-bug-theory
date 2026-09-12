"""MST chain adapter.

Reads mst-sdk-python's actual, verified API (Client/Provider/Signer — see
docs/DEPLOYMENT.md for what was inspected and how) rather than inventing
methods. The SDK itself only documents deploy/sendNative/sendToken/generic
sendTransaction — no ABI-aware contract-call helper — so custom contract
calls here go through `client.provider.web3` (a plain web3.py `Web3`
instance the SDK exposes directly) to build calldata, and
`client.signer.send_transaction(tx)` to sign and broadcast it. This is
exactly the "documented SDK operation unavailable -> adapter behind
web3.py" fallback, not a fabricated SDK method.

Hackathon-demo simplification, documented in backend/.env.example: every
write here is signed by a backend-held key (one per role, or all falling
back to the attester key), not a client-signed BridgeKey transaction. A
production build would move createPool/fundPool (sponsor) and
redeemCarePass (clinic) to client-side BridgeKey signing and keep only
registerScreening/issueCarePass (attester/issuer — genuinely backend
responsibilities) here.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from eth_utils import to_checksum_address
from mst_blockchain_sdk import Client
from web3 import Web3

from .config import Settings, get_settings

Role = Literal["attester", "issuer", "clinic"]

_REPO_ROOT = Path(__file__).resolve().parents[2]
_ARTIFACTS_DIR = _REPO_ROOT / "contracts" / "artifacts" / "contracts"


class ChainNotConfigured(RuntimeError):
    pass


def _load_abi(contract_name: str) -> list[dict[str, Any]]:
    path = _ARTIFACTS_DIR / f"{contract_name}.sol" / f"{contract_name}.json"
    if not path.exists():
        raise ChainNotConfigured(
            f"{path} not found. Run `npm run compile` in contracts/ first — the backend reads the "
            "ABI straight from Hardhat's build artifact so it can never drift out of sync with the "
            "deployed contract."
        )
    artifact = json.loads(path.read_text())
    return artifact["abi"]


class MstChainClient:
    """One instance per process (see get_chain_client). Read calls need no
    private key; write calls need the relevant MST_*_PRIVATE_KEY set.
    """

    def __init__(self, settings: Settings):
        self.settings = settings
        self._ro_web3 = Web3(Web3.HTTPProvider(settings.mst_rpc_url))
        self._signer_clients: dict[Role, Client] = {}

        self._registry_abi = _load_abi("AnemiaRegistry")
        self._care_pool_abi = _load_abi("CarePool")

    # -- read-only web3 / contract handles ---------------------------------

    @property
    def web3(self) -> Web3:
        return self._ro_web3

    @property
    def registry(self):
        if not self.settings.mst_anemia_registry_address:
            raise ChainNotConfigured("MST_ANEMIA_REGISTRY_ADDRESS is not set in backend/.env")
        return self._ro_web3.eth.contract(
            address=to_checksum_address(self.settings.mst_anemia_registry_address), abi=self._registry_abi
        )

    @property
    def care_pool(self):
        if not self.settings.mst_care_pool_address:
            raise ChainNotConfigured("MST_CARE_POOL_ADDRESS is not set in backend/.env")
        return self._ro_web3.eth.contract(
            address=to_checksum_address(self.settings.mst_care_pool_address), abi=self._care_pool_abi
        )

    def check_chain_id(self) -> int:
        """Live preflight — never trust a hardcoded chain ID. Call this at
        startup and refuse to serve chain-writing endpoints if it doesn't
        match settings.mst_chain_id.
        """
        return self._ro_web3.eth.chain_id

    # -- signing ---------------------------------------------------------

    def _signer_client(self, role: Role) -> Client:
        if role not in self._signer_clients:
            key_by_role = {
                "attester": self.settings.mst_attester_private_key,
                "issuer": self.settings.mst_issuer_private_key or self.settings.mst_attester_private_key,
                "clinic": self.settings.mst_clinic_private_key or self.settings.mst_attester_private_key,
            }
            pk = key_by_role[role]
            if not pk:
                raise ChainNotConfigured(
                    f"No private key configured for role={role!r}. Set MST_{role.upper()}_PRIVATE_KEY "
                    "(or MST_ATTESTER_PRIVATE_KEY as a fallback) in backend/.env."
                )
            self._signer_clients[role] = Client(self.settings.mst_network, pk)
        return self._signer_clients[role]

    def address_for(self, role: Role) -> str:
        return self._signer_client(role).signer.get_address()

    def _send_transaction(self, client: Client, tx: dict) -> str:
        """Sign and broadcast `tx` with `client`'s signer.

        Deliberately does NOT call `client.signer.send_transaction(tx)` —
        as installed (mst-sdk-python 1.0.1, pinned to web3>=6.15.0), that
        method calls `signed.raw_transaction`, an attribute eth-account only
        added in 0.13+. web3==6.20.4 (the SDK's own dependency) requires
        `eth-account<0.13`, which only has `rawTransaction`. So
        `Client(...).signer.send_transaction` raises AttributeError on
        every call under the SDK's own declared, installable dependency
        set — confirmed by installing exactly what `pip install
        mst-sdk-python` resolves to and reproducing the crash (see
        docs/DEPLOYMENT.md). This is the "documented SDK operation
        unavailable" fallback the build spec calls for: reuse the SDK's
        Signer for account/address management (the part that works) and
        do the actual sign-and-broadcast ourselves via `eth_account` +
        `provider.web3`, tolerant of either attribute name so it keeps
        working if a future SDK release fixes this upstream.
        """
        signer = client.signer
        tx.setdefault("from", signer.get_address())
        tx.setdefault("nonce", client.provider.web3.eth.get_transaction_count(signer.get_address()))
        tx.setdefault("chainId", client.provider.web3.eth.chain_id)
        if "gasPrice" not in tx and "maxFeePerGas" not in tx:
            tx["gasPrice"] = client.provider.web3.eth.gas_price

        signed = signer.account.sign_transaction(tx)
        raw = getattr(signed, "raw_transaction", None) or getattr(signed, "rawTransaction", None)
        if raw is None:
            raise RuntimeError("eth_account SignedTransaction exposes neither raw_transaction nor rawTransaction")
        tx_hash = client.provider.web3.eth.send_raw_transaction(raw)
        tx_hash_hex = tx_hash.hex()
        return tx_hash_hex if tx_hash_hex.startswith("0x") else "0x" + tx_hash_hex

    def _send(self, role: Role, contract, fn_name: str, args: list, value_wei: int = 0) -> str:
        client = self._signer_client(role)
        # Rebind `contract` onto the SAME web3 instance we're about to sign
        # and broadcast through (client.provider.web3), not the read-only
        # `self._ro_web3` it may have come from. web3.py's build_transaction
        # auto-fills chainId (and can auto-fill gas) from whichever web3
        # instance the contract object is bound to — if that ever differs
        # from the broadcasting endpoint, the tx is signed for the wrong
        # chain and every write reverts at the mempool with a chain-id
        # mismatch. Confirmed the hard way in local integration testing
        # (settings.mst_rpc_url pointed at a local node while the SDK's
        # network-name resolution pointed at the real testnet) — see
        # docs/DEPLOYMENT.md.
        write_contract = client.provider.web3.eth.contract(address=contract.address, abi=contract.abi)
        fn = getattr(write_contract.functions, fn_name)(*args)
        tx = fn.build_transaction({"from": client.signer.get_address(), "value": value_wei})
        return self._send_transaction(client, tx)

    def wait_for_receipt(self, tx_hash: str, timeout: int = 60):
        return self._ro_web3.eth.wait_for_transaction_receipt(tx_hash, timeout=timeout)

    def try_get_receipt(self, tx_hash: str):
        """Non-blocking receipt lookup for the reconciliation worker."""
        try:
            return self._ro_web3.eth.get_transaction_receipt(tx_hash)
        except Exception:  # noqa: BLE001 — "not mined yet" and RPC hiccups both land here
            return None

    # -- AnemiaRegistry: reads --------------------------------------------

    def verify_screening(self, scan_id_hash: str, commitment: str) -> bool:
        return self.registry.functions.verifyScreening(scan_id_hash, commitment).call()

    def get_screening(self, scan_id_hash: str) -> dict:
        s = self.registry.functions.getScreening(scan_id_hash).call()
        return {
            "commitment": s[0].hex() if isinstance(s[0], bytes) else s[0],
            "modelHash": s[1].hex() if isinstance(s[1], bytes) else s[1],
            "attester": s[2],
            "capturedAt": s[3],
            "registeredAt": s[4],
            "revoked": s[5],
        }

    def get_model(self, model_hash: str) -> dict:
        m = self.registry.functions.getModel(model_hash).call()
        return {"modelHash": m[0].hex() if isinstance(m[0], bytes) else m[0], "uri": m[1], "active": m[2], "registeredAt": m[3]}

    # -- AnemiaRegistry: writes --------------------------------------------

    def register_model(self, model_hash: str, uri: str, role: Role = "attester") -> str:
        return self._send(role, self.registry, "registerModel", [model_hash, uri])

    def register_screening(self, scan_id_hash: str, commitment: str, model_hash: str, captured_at: int) -> str:
        return self._send(
            "attester", self.registry, "registerScreening", [scan_id_hash, commitment, model_hash, captured_at]
        )

    def revoke_screening(self, scan_id_hash: str) -> str:
        return self._send("attester", self.registry, "revokeScreening", [scan_id_hash])

    # -- CarePool: reads ---------------------------------------------------

    def get_pool(self, pool_id: int) -> dict:
        p = self.care_pool.functions.getPool(pool_id).call()
        return {"sponsor": p[0], "totalFunded": p[1], "totalReserved": p[2], "totalRedeemed": p[3], "active": p[4]}

    def get_pass(self, pass_id: int) -> dict:
        p = self.care_pool.functions.getPass(pass_id).call()
        return {
            "poolId": p[0],
            "scanIdHash": p[1].hex() if isinstance(p[1], bytes) else p[1],
            "passHash": p[2].hex() if isinstance(p[2], bytes) else p[2],
            "value": p[3],
            "clinic": p[4],
            "status": p[5],
            "issuedAt": p[6],
            "settledAt": p[7],
        }

    def pass_id_by_hash(self, pass_hash: str) -> int:
        return self.care_pool.functions.passIdByHash(pass_hash).call()

    # -- CarePool: writes (demo-mode backend-signed; see module docstring) --

    def create_pool(self, role: Role = "issuer") -> str:
        return self._send(role, self.care_pool, "createPool", [])

    def fund_pool(self, pool_id: int, value_wei: int, role: Role = "issuer") -> str:
        return self._send(role, self.care_pool, "fundPool", [pool_id], value_wei=value_wei)

    def issue_care_pass(self, pool_id: int, scan_id_hash: str, commitment: str, pass_hash: str, value_wei: int) -> str:
        return self._send(
            "issuer", self.care_pool, "issueCarePass", [pool_id, scan_id_hash, commitment, pass_hash, value_wei]
        )

    def redeem_care_pass(self, secret: str) -> str:
        return self._send("clinic", self.care_pool, "redeemCarePass", [secret])

    def authorize_clinic(self, clinic_address: str, role: Role = "attester") -> str:
        return self._send(role, self.care_pool, "authorizeClinic", [to_checksum_address(clinic_address)])


@lru_cache
def get_chain_client() -> MstChainClient:
    return MstChainClient(get_settings())
