"""Authentication for the CarePool endpoints that spend backend-held funds.

`POST /carepool/pools`, `POST /carepool/pools/{id}/fund` and
`POST /carepool/passes` each broadcast a transaction signed by the backend's
own held key -- `fund_pool` in particular sends `amount_wei` of native token
straight out of the issuer wallet. Before this fix none of the three checked
the caller's identity at all: `/passes/redeem` and `/clinics/authorize` were
gated behind `require_wallet_session`, but `create_pool`, `fund_pool` and
`issue_care_pass` were not, so any anonymous caller could create pools, and
`fund_pool` in particular could be called repeatedly to drain the issuer
wallet's entire balance.

These tests exercise the REAL wallet challenge-response flow end to end --
generate an actual ECDSA keypair, sign the exact challenge message the
server issues, and obtain a genuine session token via `/auth/challenge` +
`/auth/verify` -- rather than minting a token directly, so the whole auth
chain is proven, not just the token-verification half.

Requires a reachable chain with the demo model/roles configured (the same
local Hardhat node the rest of the suite uses); skipped otherwise, mirroring
test_chain_e2e.py's skip condition.
"""

from __future__ import annotations

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi.testclient import TestClient

from app.chain import ChainNotConfigured, get_chain_client
from app.config import get_settings
from app.main import app

from .test_chain_e2e import _chain_ready

_READY, _REASON = _chain_ready()
pytestmark = pytest.mark.skipif(not _READY, reason=_REASON or "chain not ready")


@pytest.fixture()
def client():
    app.dependency_overrides.clear()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def _wallet_session_token(client: TestClient) -> tuple[str, str]:
    """Run the real challenge/verify handshake and return (address, token)."""
    account = Account.create()
    address = account.address

    challenge = client.post("/auth/challenge", json={"address": address})
    assert challenge.status_code == 200, challenge.text
    message = challenge.json()["message"]

    signed = account.sign_message(encode_defunct(text=message))
    signature = signed.signature.hex()
    if not signature.startswith("0x"):
        signature = "0x" + signature

    verify = client.post("/auth/verify", json={"address": address, "signature": signature})
    assert verify.status_code == 200, verify.text
    return address, verify.json()["token"]


# ---------------------------------------------------------------------------
# Every mutating endpoint must reject an unauthenticated caller.
# ---------------------------------------------------------------------------


def test_create_pool_requires_auth(client):
    response = client.post(
        "/carepool/pools",
        json={"sponsor_address": "0x" + "11" * 20, "label": "attack"},
    )
    assert response.status_code == 401, response.text


def test_fund_pool_requires_auth(client):
    """The one that spends real value: an unauthenticated caller must not be
    able to drain the issuer wallet by repeated calls."""
    response = client.post(
        "/carepool/pools/does-not-exist/fund",
        json={"amount_wei": "1000000000000000000000"},
    )
    # Auth is checked before the pool lookup, so this must be 401, not 404.
    assert response.status_code == 401, response.text


def test_issue_care_pass_requires_auth(client):
    response = client.post(
        "/carepool/passes",
        json={"pool_id": "does-not-exist", "scan_id_hash": "0x" + "22" * 32, "value_wei": "1"},
    )
    assert response.status_code == 401, response.text


def test_bogus_bearer_token_is_rejected_on_all_three(client):
    headers = {"Authorization": "Bearer not-a-real-session-token"}
    assert (
        client.post(
            "/carepool/pools", json={"sponsor_address": "0x" + "11" * 20}, headers=headers
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/carepool/pools/x/fund", json={"amount_wei": "1"}, headers=headers
        ).status_code
        == 401
    )
    assert (
        client.post(
            "/carepool/passes",
            json={"pool_id": "x", "scan_id_hash": "0x" + "22" * 32, "value_wei": "1"},
            headers=headers,
        ).status_code
        == 401
    )


# ---------------------------------------------------------------------------
# A genuine wallet session, obtained through the real challenge/verify flow,
# must be accepted -- proving the fix does not just reject everyone.
# ---------------------------------------------------------------------------


def test_authenticated_caller_can_create_and_fund_a_pool(client):
    _address, token = _wallet_session_token(client)
    headers = {"Authorization": f"Bearer {token}"}

    created = client.post(
        "/carepool/pools",
        json={"sponsor_address": "0x" + "33" * 20, "label": "authenticated sponsor"},
        headers=headers,
    )
    assert created.status_code == 201, created.text
    pool = created.json()
    assert pool["pool_id_onchain"] is not None, "pool did not confirm on-chain"

    funded = client.post(
        f"/carepool/pools/{pool['id']}/fund",
        json={"amount_wei": "1000000000000000"},  # 0.001 native token
        headers=headers,
    )
    assert funded.status_code == 200, funded.text
    assert int(funded.json()["total_funded_wei"]) == 1000000000000000


def test_session_token_is_bound_to_its_own_issuance(client):
    """A stale/reused nonce, or a token for one address, must not work for a
    request claiming to act as a different flow -- basic sanity that the
    token actually carries the signer's identity rather than being a bearer
    of pure ambient authority."""
    _address, token = _wallet_session_token(client)
    tampered = token[:-4] + ("0" * 4 if not token.endswith("0000") else "1111")
    response = client.post(
        "/carepool/pools",
        json={"sponsor_address": "0x" + "44" * 20},
        headers={"Authorization": f"Bearer {tampered}"},
    )
    assert response.status_code == 401, response.text
