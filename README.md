# Aneris — AnemiaScan

Hackathon team repository for Zero bug theory — [hackindia-team:hackindia-ai-web3-builders-hackathon-2026:zero-bug-theory]

A research prototype that estimates an **anaemia risk signal** from a
photograph of the palpebral conjunctiva (the inner surface of the lower
eyelid), and anchors a privacy-preserving commitment to each screening on the
MST Blockchain.

> **Not a medical device.** No regulatory clearance, no clinical validation,
> and no measured accuracy — the training data, the split and the deployed
> model's metrics are not in this repository and could not be verified. It does
> **not** measure haemoglobin and never reports a g/dL value. Only a blood test
> (CBC) can confirm or rule out anaemia. Read
> [`MODEL_CARD.md`](MODEL_CARD.md) — particularly §8 — before quoting any
> number from this project anywhere.

The photograph **is uploaded to the backend** and **sign-in is required**.
Scoring happens server-side; the browser computes no medical risk of its own.

## How a scan works

1. The browser captures or selects a photo and posts it to
   `POST /inference/predict` with a Firebase ID token.
2. The backend locates and masks the conjunctiva, runs a capture-quality gate
   and an in-distribution gate, and **refuses** anything off-target with an
   HTTP 422 and a named reason — an unusable photo never receives a score.
3. An accepted capture is scored by the AnemiaScan V3.1 calibrated ensemble.
   The result is a calibrated probability plus one of `lower_risk`,
   `higher_risk` or `uncertain` — `uncertain` being a real fourth outcome, not
   a middle severity.
4. A commitment over hashes of the result is computed and, when the chain is
   configured, anchored on MST Testnet under a model hash derived from the
   weights themselves.

## Repository layout

| Directory | What it is | Toolchain |
|---|---|---|
| `src/` | React + Vite + Tailwind patient-facing app | pnpm |
| `backend/` | FastAPI service: inference, gates, commitments, chain adapter | Python 3.11, own `.venv` |
| `contracts/` | `AnemiaRegistry` + `CarePool` Solidity contracts | Hardhat, npm |
| `sdk/` | Shared commitment implementation + golden vector | npm |
| `docs/DEPLOYMENT.md` | Architecture, privacy boundary, verification log, deployment steps | |
| `MODEL_CARD.md` | What the model is, how it is built, and what its evidence base actually is | |

Each of the four is a self-contained project with its own dependencies; the
root `pnpm` install does not pull in `backend/`, `contracts/` or `sdk/`.

## Local run order

The frontend needs the backend running to do anything useful, and the backend
needs the model bundle. Chain configuration is optional.

### 1. Backend

```bash
cd backend
py -3.11 -m venv .venv
./.venv/Scripts/pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1
./.venv/Scripts/pip install -r requirements.txt
cp .env.example .env          # set FIREBASE_PROJECT_ID at minimum
./.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Put the AnemiaScan V3.1 weights in `backend/app/ml/model_assets/` and verify
their SHA-256 digests against [`MODEL_CARD.md`](MODEL_CARD.md) §7 — they are
not in the repository (one checkpoint is 111MB). Without them the service
starts but `POST /inference/predict` returns 503; set `INFERENCE_PROVIDER=mock`
to run with the synthetic provider instead (results carry `is_synthetic=true`
and must show the DEMO MODE notice).

Full setup, the complete API, and the 422 recapture contract:
[`backend/README.md`](backend/README.md).

### 2. Frontend

```bash
pnpm install
cp .env.example .env          # VITE_FIREBASE_* and VITE_API_BASE_URL
pnpm run dev
```

`VITE_FIREBASE_PROJECT_ID` **must be the same Firebase project** as the
backend's `FIREBASE_PROJECT_ID`. If they differ, every screening is rejected
with 401, because the backend checks the token's `aud` claim.

### 3. Contracts (optional — only for on-chain anchoring)

```bash
cd contracts
npm install
npm run test
npm run deploy:testnet          # 1. prints the contract addresses
npm run grant-roles:testnet     # 2. grants roles, registers the MOCK model hash
npm run register-model:testnet  # 3. registers the REAL, weights-derived hash
```

Step 3 is required before the first real screening, and it reads the manifest
that `python -m app.ml.manifest --json ../contracts/model-manifest.json`
writes from the installed weights. Skipping it means `registerScreening`
reverts with `ModelNotFound`. Copy the printed addresses and hashes into
`backend/.env`.

The full deployment sequence, including funding the testnet wallet, is in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Build

```bash
pnpm run build
```

Builds `src/` only. `backend/`, `contracts/` and `sdk/` have their own test
commands (`pytest`, `npm run test`, `node sdk/ts/verify.mjs`) and are not
covered by it.
