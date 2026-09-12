# AnemiaScan

AnemiaScan is a responsive React screening interface backed by a FastAPI
service and the deterministic AnemiaScan V4 ensemble. It is a research
screening aid, not a diagnostic device; results require CBC/haemoglobin testing
and professional evaluation.

## Repository layout

- `src/`, `components/`, `lib/` — React 19 + Vite + Tailwind frontend.
- `backend/` — FastAPI, V4 inference, persistence, auth, and MST adapters.
- `contracts/` — Hardhat contracts for screening commitments and CarePool.
- `sdk/` — shared commitment helpers and verification vector.
- `docs/DEPLOYMENT.md` — blockchain architecture and deployment notes.

## Run locally

Install and start the frontend:

```powershell
corepack pnpm install
corepack pnpm run dev
```

Copy `.env.example` to `.env.local` and keep
`VITE_API_BASE_URL=http://localhost:8000` for local development.

The backend requires Python 3.11 and the trusted V4 bundle. From `backend/`:

```powershell
py -3.11 -m venv .venv
.\.venv\Scripts\pip.exe install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1
.\.venv\Scripts\pip.exe install -r requirements.txt
.\.venv\Scripts\python.exe scripts\install_v4_bundle.py G:\path\to\anemiascan_v4_eff_conv_vit_bundle.zip
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

The installer validates and extracts only the required trusted artifacts into
the gitignored `backend/app/ml/model_assets/` directory. See
[`backend/README.md`](backend/README.md) for the API, model flow, tests, and
Unix command equivalents.

## Verify

```powershell
corepack pnpm exec tsc --noEmit
corepack pnpm run build
cd backend
.\.venv\Scripts\python.exe -m pytest -q
```
