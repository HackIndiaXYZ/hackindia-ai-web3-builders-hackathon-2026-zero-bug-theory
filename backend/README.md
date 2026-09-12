# AnemiaScan backend

FastAPI service: screening commitments, MST Testnet anchoring, and
CarePool/CarePass bookkeeping. See
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for the full architecture
and privacy boundary. Standalone Python project — does not touch `src/`.

## Setup

Use **Python 3.11**, not 3.14: `web3`'s native dependencies (`ckzg`,
`lru-dict` at some versions) don't have prebuilt wheels for 3.14 yet on
Windows and fail to build without MSVC build tools. `py -3.11 -m venv .venv`
sidesteps this entirely.

```bash
py -3.11 -m venv .venv
./.venv/Scripts/pip install -r requirements.txt      # macOS/Linux: .venv/bin/pip
cp .env.example .env
```

Fill in `.env` with the values `contracts/`'s deploy/grant-roles scripts
print (`MST_ANEMIA_REGISTRY_ADDRESS`, `MST_CARE_POOL_ADDRESS`,
`MST_MOCK_MODEL_HASH`), and `MST_ATTESTER_PRIVATE_KEY` (reuse
`contracts/.env.local`'s `PRIVATE_KEY` — that deployer key already holds
every on-chain role from the constructor).

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

## Test

```bash
./.venv/Scripts/python -m pytest -v
```

`tests/test_commitment.py` is the Python leg of the three-way commitment
parity check (Solidity ground truth -> Python -> TypeScript) — see
`contracts/README.md`'s "Golden commitment vector" section.

## What's real vs. mocked here

| | |
|---|---|
| FastAPI, SQLAlchemy, commitment building | Real |
| MST chain reads/writes (once configured) | Real transactions |
| AI risk/recommendation scoring | **Synthetic** — see `app/inference.py`; every result carries `is_synthetic=True` and the DEMO MODE notice |
| Sponsor/clinic wallet signing | **Backend-custodial for the hackathon** — see `app/chain.py`'s module docstring for exactly what a production build would change |

## Directory layout

```
app/
  main.py            FastAPI app, CORS, startup chain-id preflight, background reconciliation loop
  config.py           env-driven settings
  db.py / models.py   SQLAlchemy (SQLite by default; swap DATABASE_URL for Postgres, no code change)
  commitment.py        ANEMIASCAN_SCREENING_COMMITMENT_V1 (Python leg)
  carepass.py          ANEMIASCAN-CAREPASS|1|<token> encode/decode
  chain.py             MST adapter — see its module docstring for the SDK bug workaround
  inference.py          MockInferenceProvider (DEMO MODE)
  security.py           wallet challenge-response auth (sponsor/clinic only — patient stays walletless)
  reconciliation.py      DB<->chain tx state machine recovery
  routers/               health, auth, registry, carepool, audit
tests/
  test_commitment.py    three-way golden-vector parity check
```
