"""Wallet challenge-response auth for sponsor/clinic BridgeKey wallets.
Not used by the walletless patient flow (see app/security.py docstring).
"""

from datetime import datetime, timedelta, timezone

from eth_utils import to_checksum_address
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import WalletAuthNonce
from ..schemas import ChallengeRequest, ChallengeResponse, VerifyRequest, VerifyResponse
from ..security import build_challenge_message, generate_nonce, issue_session_token, recover_signer

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/challenge", response_model=ChallengeResponse)
def challenge(body: ChallengeRequest, db: Session = Depends(get_db)) -> ChallengeResponse:
    try:
        address = to_checksum_address(body.address)
    except ValueError as err:
        raise HTTPException(422, "invalid address") from err

    settings = get_settings()
    nonce = generate_nonce()
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=settings.wallet_auth_nonce_ttl_seconds)

    db.add(WalletAuthNonce(address=address, nonce=nonce, issued_at=now, expires_at=expires_at))
    db.commit()

    message = build_challenge_message(address, nonce, int(now.timestamp()))
    return ChallengeResponse(address=address, nonce=nonce, message=message, expires_at=expires_at)


@router.post("/verify", response_model=VerifyResponse)
def verify(body: VerifyRequest, db: Session = Depends(get_db)) -> VerifyResponse:
    try:
        address = to_checksum_address(body.address)
    except ValueError as err:
        raise HTTPException(422, "invalid address") from err

    row = (
        db.query(WalletAuthNonce)
        .filter(WalletAuthNonce.address == address, WalletAuthNonce.used.is_(False))
        .order_by(WalletAuthNonce.issued_at.desc())
        .first()
    )
    if row is None:
        raise HTTPException(400, "no pending challenge for this address — call /auth/challenge first")

    now = datetime.now(timezone.utc)
    expires_at = row.expires_at if row.expires_at.tzinfo else row.expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now:
        raise HTTPException(400, "challenge expired — call /auth/challenge again")

    message = build_challenge_message(address, row.nonce, int(row.issued_at.replace(tzinfo=timezone.utc).timestamp()))

    try:
        recovered = to_checksum_address(recover_signer(message, body.signature))
    except Exception as err:  # noqa: BLE001 — any recovery failure is a bad signature
        raise HTTPException(401, "signature verification failed") from err

    if recovered != address:
        raise HTTPException(401, "signature does not match claimed address")

    row.used = True
    db.commit()

    settings = get_settings()
    token = issue_session_token(address, role="wallet")
    return VerifyResponse(
        token=token, address=address, role="wallet", expires_in_seconds=settings.session_ttl_seconds
    )
