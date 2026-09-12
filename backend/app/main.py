"""AnemiaScan Proof-of-Care backend.

Run with: uvicorn app.main:app --reload --port 8000
(from backend/, with .venv activated — see backend/README.md)
"""

import asyncio
import contextlib
import io
import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from starlette.concurrency import run_in_threadpool

from .chain import ChainNotConfigured, get_chain_client
from .config import get_settings
from .db import SessionLocal, init_db
from .reconciliation import reconcile_pending
from .routers import audit, auth, blockchain, carepool, health, registry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("anemiascan")

RECONCILE_INTERVAL_SECONDS = 30


def _build_warmup_image_bytes() -> bytes:
    """A tiny synthetic JPEG used only to force the real model to load (and
    run one full forward pass) at startup, so a missing/broken bundle fails
    loudly in the logs instead of on a user's first request.
    """
    buffer = io.BytesIO()
    Image.new("RGB", (128, 128), color=(150, 110, 110)).save(buffer, format="JPEG")
    return buffer.getvalue()


_WARMUP_IMAGE_BYTES = _build_warmup_image_bytes()


async def _reconciliation_loop() -> None:
    while True:
        await asyncio.sleep(RECONCILE_INTERVAL_SECONDS)
        try:
            db = SessionLocal()
            try:
                reconcile_pending(db, get_chain_client())
            finally:
                db.close()
        except ChainNotConfigured:
            pass  # nothing to reconcile against yet
        except Exception:  # noqa: BLE001 — a background loop must never die on one bad tick
            logger.exception("reconciliation loop tick failed")


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    settings = get_settings()

    try:
        chain = get_chain_client()
        live_chain_id = chain.check_chain_id()
        if live_chain_id != settings.mst_chain_id:
            logger.error(
                "MST chain ID mismatch! expected=%s live=%s rpc=%s — refusing to trust cached config.",
                settings.mst_chain_id,
                live_chain_id,
                settings.mst_rpc_url,
            )
        else:
            logger.info("MST chain ID verified live: %s (%s)", live_chain_id, settings.mst_network)
    except ChainNotConfigured as err:
        logger.warning("MST chain adapter not ready yet: %s", err)

    if settings.inference_provider == "real":
        try:
            from .inference import get_inference_provider

            provider = get_inference_provider(settings)
            await run_in_threadpool(provider.run, image_bytes=_WARMUP_IMAGE_BYTES)
            logger.info("AnemiaScan V3.1 model loaded and warmed up (device=%s)", settings.ml_device)
        except Exception:  # noqa: BLE001 — must never crash startup; the endpoint will 503 until fixed
            logger.exception(
                "Real inference model failed to load at startup — /registry/screenings will 503 until fixed"
            )

    task = asyncio.create_task(_reconciliation_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(
    title="AnemiaScan Proof-of-Care API",
    description="Screening commitments, MST Testnet anchoring, and CarePool/CarePass bookkeeping.",
    version="0.1.0",
    lifespan=lifespan,
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(blockchain.router)
app.include_router(auth.router)
app.include_router(registry.router)
app.include_router(carepool.router)
app.include_router(audit.router)


@app.exception_handler(ChainNotConfigured)
async def chain_not_configured_handler(request: Request, exc: ChainNotConfigured) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": f"MST chain not configured: {exc}"})

