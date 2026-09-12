# AnemiaScan backend

FastAPI service: conjunctiva screening inference, screening commitments, MST
Testnet anchoring, and CarePool/CarePass bookkeeping. See
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for the full architecture and
privacy boundary, and [`../MODEL_CARD.md`](../MODEL_CARD.md) for what the model
is, what it is not, and what its evidence base actually amounts to.

Standalone Python project — its own `.venv`, its own dependencies, no `pnpm`
involvement.

## Setup

Use **Python 3.11**, not 3.14: `web3`'s native dependencies (`ckzg`,
`lru-dict` at some versions) don't have prebuilt wheels for 3.14 yet on
Windows and fail to build without MSVC build tools. `py -3.11 -m venv .venv`
sidesteps this entirely.

```bash
py -3.11 -m venv .venv
./.venv/Scripts/pip install --index-url https://download.pytorch.org/whl/cpu torch==2.5.1 torchvision==0.20.1
./.venv/Scripts/pip install -r requirements.txt      # macOS/Linux: .venv/bin/pip
cp .env.example .env
```

Installing torch/torchvision first (from PyTorch's own CPU-only wheel
index) keeps the install a few hundred MB instead of pulling a multi-GB
CUDA build — order doesn't matter either way, `requirements.txt` pins the
same versions.

`.env.example` documents every variable. Two are required before a screening
will succeed:

- **`FIREBASE_PROJECT_ID`** — must be the *same* Firebase project as the
  frontend's `VITE_FIREBASE_PROJECT_ID`. Every screening request carries a
  Firebase ID token whose `aud` claim is checked against this value; if the two
  differ, every request is rejected with 401.
- **`MST_ANEMIA_REGISTRY_ADDRESS`** / **`MST_CARE_POOL_ADDRESS`** — printed by
  `contracts/`'s deploy script. Chain config is optional for local dev: the app
  runs fully with the chain unconfigured (commitments are still computed and
  stored, just not anchored).

For on-chain writes also set `MST_ATTESTER_PRIVATE_KEY` (reuse
`contracts/.env.local`'s `PRIVATE_KEY` — that deployer key already holds every
role from the constructor).

### Real inference model

`INFERENCE_PROVIDER=real` (the default) needs the AnemiaScan V3.1 calibrated
bundle in `app/ml/model_assets/`. The small JSON configs and the bundle README
**are** in the repository; the weights are not (`convnext_tiny_best.pth` alone
is 111MB, over GitHub's hard file limit), so they arrive out of band:

```
app/ml/model_assets/
  runtime_config.json            tracked
  calibration.json                tracked
  thresholds.json                 tracked
  inference_contract.json          tracked
  BUNDLE_README.md                 tracked
  train_only_scalers.npz          gitignored — obtain separately
  stacking_model.joblib            gitignored — obtain separately
  anemiafusionnet_v3_1_gated.pth    gitignored — obtain separately
  base_models/
    efficientnet_b3_best.pth        gitignored — obtain separately
    convnext_tiny_best.pth          gitignored — obtain separately
```

**Verify the weights before trusting them.** `../MODEL_CARD.md` §7 lists the
SHA-256 digest of every asset and the `keccak256` model hash derived from them;
`python -m app.ml.manifest` prints the same for whatever is actually installed.
They must match, because that hash is what gets anchored on-chain — a
substituted checkpoint silently changes the model's identity.

`app/ml/model_assets/BUNDLE_README.md` is the bundle's own provenance note. It
contains the inference contract and the authors' caveats; it contains **no**
validation metrics, despite an earlier version of this file saying it did. The
evidence base — including the fact that the *selected* candidate has no
reported metrics at all — is set out in `../MODEL_CARD.md` §8.

Without the weights present, startup logs a clear warning and
`POST /inference/predict` returns `503` until they're added — set
`INFERENCE_PROVIDER=mock` to run without them (CI/offline dev; results are
synthetic, carry `is_synthetic=true`, and must be shown with the DEMO MODE
notice).

`requirements.txt` pins exact versions, not ranges, for the eth-*/web3
stack — see the comment at its top and `app/chain.py`'s module docstring
for why (a real, reproducible upstream bug: `mst-sdk-python`'s own
dependency floor allows an `eth-account` version that doesn't have the
attribute its signing code calls).

## Run

```bash
./.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Interactive API docs at `http://localhost:8000/docs`. `GET /health` does a
live `eth_chainId` call and reports a mismatch rather than trusting the
configured value — check it first if anything chain-related looks wrong.

### Run order for a chain-anchored deployment

The three `contracts/` scripts must run in this order, and the third is not
optional:

```bash
cd contracts
npm run deploy:testnet          # 1. deploys both contracts, prints the addresses
npm run grant-roles:testnet     # 2. grants roles, registers the MOCK model hash
# then, from backend/, with the real bundle installed:
python -m app.ml.manifest --json ../contracts/model-manifest.json
cd contracts
npm run register-model:testnet  # 3. registers the REAL, weights-derived hash
```

Step 3 exists because `grantRoles.ts` registers only `MOCK_MODEL_HASH`.
`registerScreening` reverts with `ModelNotFound` for any hash that was never
registered, so with the shipped `INFERENCE_PROVIDER=real` the first genuine
screening would broadcast a transaction that reverts on-chain and lose the
anchor for a result the user has already seen. `REQUIRE_REGISTERED_MODEL=true`
(the default) catches this beforehand and refuses to broadcast rather than
burning gas on a certain revert.

## API

Everything below is served under the base URL in `VITE_API_BASE_URL`.

### `POST /inference/predict` — canonical screening endpoint

`multipart/form-data`: `image` (file), `consent_hash` (0x + 64 hex), optional
`captured_at` (unix seconds).

**Requires `Authorization: Bearer <Firebase ID token>`.** Without it, or with a
token minted for a different Firebase project, the request is refused with
`401` — the endpoint signs on-chain transactions under the service's own
`ATTESTER_ROLE` key, so it cannot be open. Token verification checks the RS256
signature against Google's `securetoken` certificates, then `iss`, `exp`,
`iat`, `sub`, and `aud` against `FIREBASE_PROJECT_ID`. The uid is used only to
authorise the call; it is deliberately not stored with the screening.

Uploads are capped at `MAX_UPLOAD_BYTES` and checked against
`ALLOWED_IMAGE_TYPES` by declared Content-Type *and* by sniffing the leading
bytes — a mismatch between the two is itself rejected (`415`/`413`), because
neither FastAPI nor Starlette caps a file part.

**`201`** returns the screening: `scan_session_id`, `scan_id_hash`,
`commitment`, `model_hash`, `risk_code`, `recommendation_code`,
`probability_bps`, `quality_bps`, `is_synthetic`, `demo_notice`, the nested
`model_output` / `quality` / `roi` / `gate` reports, and
`registered_on_chain` / `chain_tx_hash` / `chain_tx_status` / `explorer_url`.

`model_output.decision` is one of `lower_risk`, `higher_risk`, `uncertain`.
`uncertain` is a first-class outcome — the probability sits within
`uncertainty_margin` of the operating threshold, or the two candidate models
disagree — and it is never a synonym for "moderate".

**`422` — recapture required.** A gate refused the image. The body is:

```json
{
  "detail": {
    "decision": "recapture_required",
    "reasons": ["no_roi_detected"],
    "message": "No exposed inner eyelid was found in that photo. Pull the lower lid down and fill the guide.",
    "quality": { "...": "..." },
    "roi": { "...": "..." },
    "gate": { "...": "..." }
  }
}
```

`message` is a sentence written for the user; `reasons` are stable codes a
client can branch on:

| Code | Cause |
|---|---|
| `no_roi_detected` | The localiser found no plausible conjunctiva region |
| `roi_coverage_low` | A region was found but fills less than 4.5% of the frame |
| `roi_too_small` | The located region's shorter side is under 96px |
| `extremely_dark` / `extremely_bright` | Mean brightness outside 12–245 |
| `severely_clipped` | Over 80% of tissue pixels at the black/white rails |
| `out_of_focus` | No usable high-frequency detail |
| `degenerate_input` | Zero/near-zero variance, gradient or entropy — not a photograph of tissue |
| `implausible_chroma` | Tissue chroma more than 8 sigma from the training distribution |
| `excess_high_frequency` | Noise, heavy compression artefacts or a dense pattern |
| `out_of_distribution` | Global feature distance beyond the training budget |
| `encoder_out_of_range` | A base encoder left the range it was fitted on |
| `probability_saturated` | The raw probability pinned at a bound — unreadable, not confident |

A refusal is never converted into a score. Do not weaken or bypass a gate:
without them an off-target image reads as elevated risk (a flat grey square
scored p=0.984), because the operating threshold is deliberately low.

### `POST /registry/screenings` — deprecated alias

Identical request and response, kept so existing integrations keep working.
New clients should use `/inference/predict`.

### `GET /inference/model`

The running model's identity: `provider`, `model_version`, `model_hash`,
`operating_threshold`, `uncertainty_margin`, `selected_candidate`,
`target_sensitivity`, the full asset manifest with per-file SHA-256 digests,
`explainer_available`, and a plain-language `notice`. This is how a client or
an auditor confirms *which* model produced a given result without taking the
service's word for it — compare against `../MODEL_CARD.md` §7. Returns `503` if
the bundle is missing. No authentication required.

### `POST /inference/explain`

Optional Gemini explainer. Takes an **already-computed** result (decision,
probability, threshold, margin, candidate probabilities, disagreement flags,
quality) and returns
`{ available, explanation, model, reason, notice }`.

It never sees the image, and it cannot change the decision, the probability,
the database row or the on-chain commitment. With `GEMINI_API_KEY` unset it
returns `available: false` with a `reason` — it never fabricates an explanation
locally. Requires the same Firebase bearer token.

### Others

`GET /health` (live chain-id preflight), `/auth/challenge` + `/auth/verify`
(sponsor/clinic wallet signature auth — patients stay walletless),
`/registry/screenings/{scan_id_hash}`, `/registry/verify`, `/carepool/*`,
`/audit/*`.

## Test

```bash
./.venv/Scripts/python -m pytest -v
```

`tests/test_commitment.py` is the Python leg of the three-way commitment
parity check (Solidity ground truth -> Python -> TypeScript) — see
`contracts/README.md`'s "Golden commitment vector" section.
`tests/test_gate.py` holds the measured in-distribution / degeneracy fixtures
behind the numbers quoted in `app/ml/gate.py`'s docstring.

## What's real vs. mocked here

| | |
|---|---|
| FastAPI, SQLAlchemy, commitment building | Real |
| MST chain reads/writes (once configured) | Real transactions |
| Firebase ID-token verification | Real — RS256 against Google's published certs, `aud` checked |
| AI risk/recommendation scoring | **Real** by default (`INFERENCE_PROVIDER=real`) — the AnemiaScan V3.1 calibrated ensemble in `app/ml/`, with the ROI localiser and gates added here. Set `INFERENCE_PROVIDER=mock` for the deterministic synthetic provider (no weights needed); its results carry `is_synthetic=True` and the DEMO MODE notice |
| The model's *accuracy* | **Unknown.** Real code, real weights, no validated performance — see `../MODEL_CARD.md` §8 before quoting any number |
| Gemini explainer | Real when `GEMINI_API_KEY` is set; honestly reports itself unavailable otherwise |
| Sponsor/clinic wallet signing | **Backend-custodial for the hackathon** — see `app/chain.py`'s module docstring for exactly what a production build would change |

## Directory layout

```
app/
  main.py            FastAPI app, CORS, startup chain-id preflight, model warm-up, background reconciliation loop
  config.py           env-driven settings
  db.py / models.py   SQLAlchemy (SQLite by default; swap DATABASE_URL for Postgres, no code change)
  commitment.py        ANEMIASCAN_SCREENING_COMMITMENT_V1 (Python leg)
  carepass.py          ANEMIASCAN-CAREPASS|1|<token> encode/decode
  chain.py             MST adapter — see its module docstring for the SDK bug workaround
  firebase_auth.py      Firebase ID-token verification (no service-account key needed)
  uploads.py            size cap + Content-Type check + magic-byte sniff
  gemini.py             optional explainer; explains, never decides
  inference.py          RealInferenceProvider + MockInferenceProvider, selected by INFERENCE_PROVIDER
  ml/
    predictor.py          AnemiaScan V3.1 model code (ported from the vendor bundle)
    roi.py                conjunctiva localisation + masking — the stage the bundle requires
    gate.py               in-distribution / degeneracy / encoder-range gates, capture-quality score
    manifest.py           sha256 every asset -> keccak256 -> the on-chain model hash
    model_assets/         JSON configs + BUNDLE_README tracked; weights gitignored
  security.py           wallet challenge-response auth (sponsor/clinic only — patient stays walletless)
  reconciliation.py      DB<->chain tx state machine recovery
  routers/               health, auth, inference, registry, carepool, audit
tests/
  test_commitment.py    three-way golden-vector parity check
  test_gate.py          measured in-distribution / degeneracy fixtures
  test_inference.py     provider behaviour
  fixtures.py           synthetic in-distribution ROI builder
```
