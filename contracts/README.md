# AnemiaScan contracts

Solidity contracts for the MST Blockchain Hackathon track integration. See
[`../docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for the full architecture,
what's verified vs. assumed, and the two real bugs found and fixed while
building this.

## Contracts

- **`AnemiaRegistry.sol`** — provenance registry. Stores a keccak256
  commitment to a screening result (never the eye image, never a raw
  risk/lab value) plus which registered model version produced it.
  `verifyScreening(scanIdHash, commitment)` is the public tamper-check.
- **`CarePool.sol`** — sponsor-funded pools that pay clinics for
  confirmatory follow-up, gated by `AnemiaRegistry.verifyScreening`.
  `issueCarePass` reverts if the referenced screening isn't a currently
  verified, unrevoked commitment — this is what makes MST part of the
  product's state machine rather than a decorative transaction.

Roles use OpenZeppelin `AccessControl`; both contracts are `Pausable`,
`CarePool` is additionally `ReentrancyGuard`.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in PRIVATE_KEY, funded via https://faucet.mstblockchain.com
npm run compile
npm test
```

## Golden commitment vector

```bash
npm run vector
```

Deploys `AnemiaRegistry` to an ephemeral in-memory network and calls its
`hashScreeningCommitment` (the ground truth — it's what actually runs
on-chain) to (re)generate `../sdk/golden-vector.json`. The Python
(`backend/tests/test_commitment.py`) and TypeScript (`sdk/ts/verify.mjs`)
implementations are checked against that file — regenerate it and re-run
both after any change to the commitment encoding.

## Deploy

Order matters — each step depends on the one before it:

```bash
npm run deploy:testnet          # 1. writes deployments.json + prints addresses for backend/.env
npm run grant-roles:testnet     # 2. registers the mock model, prints its hash for backend/.env, and
                                #    grants ATTESTER/ISSUER to BACKEND_SIGNER_ADDRESS if you set one
npm run register-model:testnet  # 3. registers the REAL model hash read from model-manifest.json
npm run verify:testnet -- <address> <constructor args...>   # optional MSTScan source verification
```

`deploy:local` / `grant-roles:local` / `register-model:local` do the same
against an `npx hardhat node` you run in another terminal — useful for
iterating without spending testnet funds.

### Why step 3 is not optional

`AnemiaRegistry.registerScreening` reverts with `ModelNotFound` unless the
`modelHash` it is handed was registered by a `MODEL_MANAGER_ROLE` holder, and
with `ModelInactive` if that version was later switched off. That is the whole
point of the registry: a screening can only be anchored against a model version
someone explicitly put on record first.

Step 2 registers only `MOCK_MODEL_HASH`
(`keccak256("ANEMIASCAN_MOCK_MODEL_V0_DEMO_ONLY")`), which covers
`INFERENCE_PROVIDER=mock`. `backend/.env.example` ships
`INFERENCE_PROVIDER=real`, and the real provider attests under a completely
different hash — so skipping step 3 means the first genuine screening broadcasts
a transaction that reverts on-chain, after the user has already been shown the
result.

The real hash is never typed by hand. `backend/app/ml/manifest.py` sha256s every
file the predictor loads and writes `contracts/model-manifest.json`, whose
`model_hash` is keccak256 of the canonical manifest text; `registerModel.ts`
reads that file and re-derives the hash from its `canonical_text` before
sending, so a hand-edited or stale manifest fails loudly instead of anchoring a
hash no running model can reproduce. Change one byte of one checkpoint (or one
threshold in `runtime_config.json`) and the hash changes — and must be
registered again, which is exactly the tamper evidence the anchor exists for.

If `contracts/model-manifest.json` is missing or stale, regenerate it from the
installed bundle — from `backend/`:

```bash
python -m app.ml.manifest --json ../contracts/model-manifest.json
```

`MODEL_URI` (optional) sets the off-chain pointer stored beside the hash. It
defaults to a descriptive `manifest://` string; for anything longer-lived than a
demo, point it at an IPFS CID for the manifest or a URL to the model card.

## Network (verified live 2026-09-12 — see docs/DEPLOYMENT.md)

| | |
|---|---|
| RPC | `https://testnetrpc.mstblockchain.com` |
| Chain ID | `91562037` |
| Explorer | `https://testnet.mstscan.com` |
| Faucet | `https://faucet.mstblockchain.com` (reCAPTCHA-gated — needs a human) |
