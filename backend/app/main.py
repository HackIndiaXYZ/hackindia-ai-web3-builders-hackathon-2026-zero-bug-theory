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
from .routers import audit, auth, blockchain, carepool, health, inference, registry

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("anemiascan")

RECONCILE_INTERVAL_SECONDS = 30


def _warm_up_model(device: str) -> None:
    """Load the weights and run one real forward pass at startup.

    This used to feed a flat 128x128 colour JPEG through the provider. That no
    longer exercises anything: a constant-colour image is refused by the
    plausibility gate before the encoders ever run, so the ~150MB of weights
    would stay cold and the first real user would pay the load cost. Drive the
    encoders directly instead — it is both faster and a stricter check that the
    bundle is actually usable.
    """
    import numpy as np
    import torch

    from .ml.predictor import get_predictor

    predictor = get_predictor(device)
    with torch.inference_mode():
        dummy_b3 = torch.zeros(1, 3, 300, 300, device=predictor.device)
        dummy_conv = torch.zeros(1, 3, 224, 224, device=predictor.device)
        efficientnet_embedding = predictor.efficientnet.encode(dummy_b3)
        convnext_embedding = predictor.convnext.encode(dummy_conv)
        predictor.efficientnet.classify_embedding(efficientnet_embedding)
        predictor.convnext.classify_embedding(convnext_embedding)
        features = torch.zeros(1, 32, device=predictor.device)
        for head in predictor.gated_heads:
            head(efficientnet_embedding, convnext_embedding, features)
    # Exercise the stacker too, so a broken pickle fails here and not later.
    predictor.stacker["model"].predict_proba(
        predictor.stacker["scaler"].transform(np.zeros((1, 34)))
    )


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

    if not settings.firebase_project_id:
        logger.error(
            "FIREBASE_PROJECT_ID is unset, so sign-in cannot be verified and every "
            "screening request will be refused with 503. Set it in backend/.env."
        )

    if settings.inference_provider == "real":
        try:
            await run_in_threadpool(_warm_up_model, settings.ml_device)
            from .ml.manifest import get_model_hash
            from .ml.predictor import MODEL_VERSION

            derived = get_model_hash()
            logger.info(
                "AnemiaScan model ready: version=%s hash=%s device=%s",
                MODEL_VERSION,
                derived,
                settings.ml_device,
            )
            # A pinned MST_REAL_MODEL_HASH silently overrides the hash derived
            # from the weights on disk. If someone pins a stale value, every
            # screening is anchored on-chain under a model identity that does
            # not match the model that actually produced it — which defeats the
            # entire point of anchoring it. Refuse to let that pass quietly.
            pinned = settings.mst_real_model_hash
            if pinned and pinned.lower() != derived.lower():
                logger.error(
                    "MST_REAL_MODEL_HASH is pinned to %s but the installed bundle derives %s. "
                    "Screenings would be anchored under a model hash that does not match the "
                    "weights in app/ml/model_assets/. Clear the pin, or re-run "
                    "`python -m app.ml.manifest` and register the derived hash on-chain.",
                    pinned,
                    derived,
                )
        except Exception:  # noqa: BLE001 — must never crash startup; the endpoint will 503 until fixed
            logger.exception(
                "Real inference model failed to load at startup — "
                "POST /inference/predict will 503 until fixed"
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
app.include_router(inference.router)
app.include_router(registry.router)
app.include_router(carepool.router)
app.include_router(audit.router)


@app.exception_handler(ChainNotConfigured)
async def chain_not_configured_handler(request: Request, exc: ChainNotConfigured) -> JSONResponse:
    return JSONResponse(status_code=503, content={"detail": f"MST chain not configured: {exc}"})


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    """A malformed hex field used to escape as a 500 with a plain-text body the
    frontend could not parse. Return JSON, and treat it as a client error."""
    logger.warning("rejected malformed input on %s: %s", request.url.path, exc)
    return JSONResponse(status_code=422, content={"detail": f"invalid input: {exc}"})


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Never leak a traceback or a plain-text body to the client."""
    logger.exception("unhandled error on %s", request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. The incident has been logged."},
    )
