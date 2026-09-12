# AnemiaScan × MST — architecture, verification log, and deployment guide

This documents the MST Blockchain integration built into `contracts/`,
`backend/`, and `sdk/`, plus the privacy boundary where the AnemiaScan V4
frontend and inference endpoint meet that existing flow. It supersedes
assumptions in planning documents written before this code existed.

## What's real vs. mocked

| Component | Status |
|---|---|
| Solidity contracts (`AnemiaRegistry`, `CarePool`) | Real, tested (16 Hardhat tests, all passing) |
| Local compile/test | Real |
| MST Testnet deployment | **Not yet run** — needs a funded wallet, see "Deploying for real" below |
| Commitment hash (`ANEMIASCAN_SCREENING_COMMITMENT_V1`) | Real, three-way verified (Solidity ground truth ↔ Python ↔ TypeScript) |
| FastAPI backend, SQLAlchemy models | Real |
| MST chain reads/writes | Real — end-to-end tested against a live EVM chain (see "Verification log") |
| Patient V4 analysis (`POST /api/anemia/analyze`) | **Real.** Strict-loaded EfficientNet-B3 + ConvNeXt-Tiny + ViT-B/16, 32 engineered features, saved calibrated logistic stacker, and metrics from the trusted bundle |
| Registry AI scoring (`POST /registry/screenings`) | **Real by default.** It uses the same V4 singleton; a clearly marked deterministic mock remains available only when `INFERENCE_PROVIDER=mock` is explicitly configured for CI/offline development |
| Sponsor/clinic wallet signing | **Backend-custodial for this build**, not BridgeKey-signed — see the notes below |

## V4 integration boundary

The patient capture flow sends only the guided conjunctiva ROI to
`POST /api/anemia/analyze`. The backend holds those bytes in memory for the
request, does not write them to disk or the database, and returns the V4 score,
quality result, provenance, warning, and internal benchmark. This analysis
endpoint does not create an on-chain record. The separate registry route keeps
the existing commitment/CarePool functionality available.

One consequence: `CarePool.createPool` / `fundPool` (sponsor) and
`redeemCarePass` (clinic) are meant, long-term, to be signed client-side by
BridgeKey-connected wallets — that's inherently frontend work. For now the
backend signs all of these with its own held keys (`MST_ISSUER_PRIVATE_KEY`
/ `MST_CLINIC_PRIVATE_KEY` in `backend/.env`), so the full flow is
demoable and API-testable today. `backend/app/chain.py`'s module docstring
spells out exactly which calls a production build would move to
client-side signing (`registerScreening` and `issueCarePass` are genuine
backend/attester/issuer responsibilities and would stay). The wallet-auth
endpoints (`/auth/challenge`, `/auth/verify`) are real and ready for the
UI to use as-is once it wires up BridgeKey.

## Verified vs. assumed (Phase 0 findings)

The original plan assumed a lot about MST's tooling without checking it.
Before writing any contract or backend code, this build actually installed
and inspected the real packages:

- **`@mstblockchain/mst-sdk`** (npm, v1.0.0) and **`mst-sdk-python`**
  (PyPI, v1.0.1) — both real. Installed and read their full source. Neither
  has a generic "call any contract method" helper — just
  `deploy`/`sendNative`/`sendToken`/raw `sendTransaction`. Custom contract
  calls go through the raw `web3.py`/`ethers` instance the SDK exposes
  directly (`client.provider.web3` in Python), which is the documented
  fallback pattern for "SDK operation unavailable," not a fabrication.
- **`@mstblockchain/mst-vibe-kit`** (npm, v0.1.1) — real scaffolding CLI.
  Not run in the repo root (it generates a whole new Next.js+Hardhat
  project tree, which would collide with the existing app and this
  backend). Instead, its bundled templates (`templates/base/packages/contracts/hardhat.config.ts`,
  `templates/base/packages/shared/src/constants.ts`) were read directly to
  get the *actual* sponsor-recommended Hardhat config, which corrected
  several assumptions:

  | | Assumed (deep-research-report.md) | Actually verified |
  |---|---|---|
  | Hardhat | 3.x + Ignition | **2.22.10** + `hardhat-toolbox` 5 |
  | Explorer | generic "MSTScan" | **`testnet.mstscan.com`** |
  | Golden commitment vector | a specific hardcoded hex value | **not trusted** — regenerated from the actual deployed contract instead |

- **Live `eth_chainId`** against `https://testnetrpc.mstblockchain.com` →
  `91562037` — matches the public registry, confirmed with a direct RPC
  call, not assumed. `backend`'s `/health` endpoint repeats this check on
  every request rather than trusting the configured value once.
- **Faucet** (`https://faucet.mstblockchain.com`) — real, titled "MST
  Testnet Faucet", dispenses MSTC. reCAPTCHA-gated, so it cannot be
  automated; a human has to fund the deployer wallet (see "Deploying for
  real" below).

## Verification log — two real bugs found and fixed

Everything above was verified before writing code. Two more problems only
surfaced by actually running the full stack end-to-end against a live
chain — documented here because they're non-obvious and would silently
break a from-scratch reimplementation:

**1. `mst-sdk-python`'s `Signer.send_transaction` crashes on every call, as
installed.** It calls `signed.raw_transaction`, an attribute `eth-account`
only added in 0.13. The SDK's own declared dependency is
`web3>=6.15.0`, and `web3==6.20.4` (what that floor resolves to) requires
`eth-account<0.13` — which only has `SignedTransaction.rawTransaction`
(camelCase). There is no version combination where the SDK's own code and
its own declared dependencies both work. Reproduced by installing exactly
what `pip install mst-sdk-python` resolves to and calling
`send_transaction`; confirmed by trying to force `eth-account>=0.13` and
watching pip's resolver reject it against `web3==6.20.4`.

  Fix: `backend/app/chain.py`'s `MstChainClient._send_transaction` does the
  sign-and-broadcast itself (reusing the SDK's `Signer.account` and
  `Provider.web3` — the parts that work correctly) instead of calling the
  SDK's broken `send_transaction`, tolerant of either attribute name so it
  keeps working if a future SDK release fixes this upstream.
  `backend/requirements.txt` pins exact versions (not ranges) for the
  whole eth-*/web3 stack so a routine `pip install --upgrade` can't
  silently reintroduce this.

**2. A bug in this build's own first draft of `chain.py`**: write
transactions were built against a contract instance bound to the read-only
`web3` instance (`settings.MST_RPC_URL`), then signed and broadcast through
a *different* `web3` instance (the SDK client's own, resolved from the
network name). `web3.py`'s `build_transaction` auto-fills `chainId` from
whichever instance the contract is bound to — so if those two instances
ever point at different chains, every write is signed for the wrong chain
ID and reverts. It surfaced immediately in local integration testing
(local Hardhat node for reads, real testnet resolution for the SDK
client) as `invalid chain id for signer: have 31337 want 91562037`.

  Fix: `MstChainClient._send` now rebinds the contract onto the *same*
  `web3` instance used to sign and broadcast, for every write.

**End-to-end proof.** After both fixes, a full local-chain integration run
(Hardhat node standing in for MST Testnet — same EVM, same contract code,
same `chain.py` code path, only the SDK's hardcoded network→RPC resolution
was substituted for the test) exercised the real flow: register a
screening → confirm on-chain → tamper-check via `/registry/verify` →
create + fund a sponsor pool with a real wallet-signature-authenticated
session → issue a CarePass gated on the verified screening → authenticate
a clinic wallet → redeem the pass → confirm re-redemption is blocked →
reconciliation pass → audit trail populated. All of it real transactions,
real event-log decoding (`PoolCreated`, `CarePassIssued`), real receipts.

## The commitment: `ANEMIASCAN_SCREENING_COMMITMENT_V1`

```
keccak256(abi.encode(
  schemaHash,          // keccak256("ANEMIASCAN_SCREENING_COMMITMENT_V1"), baked into the contract, not caller-supplied
  scanIdHash,
  imageDigest,
  modelHash,
  riskCode,             // uint8
  recommendationCode,   // uint8
  confidenceBps,        // uint16
  qualityBps,            // uint16
  consentHash,
  capturedAt,            // uint64
  salt
))
```

`abi.encode`, never `abi.encodePacked` — packed encoding is ambiguous for
a struct mixing several fixed-width types like this one.

The Solidity contract's own `hashScreeningCommitment` (a `pure` function)
is the ground truth — it's what actually runs on-chain. Rather than trust a
hardcoded hex constant from a planning document, `sdk/golden-vector.json`
is *generated from that function* (`npm run vector` in `contracts/`), and
both the Python (`backend/app/commitment.py`, checked in
`backend/tests/test_commitment.py`) and TypeScript
(`sdk/ts/commitment.mjs`, checked by `sdk/ts/verify.mjs`) implementations
are asserted against it. All three currently agree. Regenerate the vector
and re-run both checks after any change to the encoding.

## Privacy boundary

| Never on MST or in the database | On MST | In the database only |
|---|---|---|
| Raw eye image | Screening commitment | `image_digest`, `consent_hash` (hashes, not the underlying data) |
| Patient name / phone / email | Model hash | Risk/recommendation codes, confidence/quality bps |
| Raw risk label as free text | Consent hash | CarePass redemption secret (bearer-credential-sensitive — see `backend/app/carepass.py`) |
| Hb value / CBC report | `scanIdHash` | Audit event log |
| Raw consent document | CarePool state | Wallet auth nonces |
| | CarePass hash/state | |
| | Wallet addresses, tx history | | |

Enforced independently at three layers: the persistence schemas have no raw
image field, the Solidity ABI has no raw image field, and both inference routes
discard uploaded bytes after processing. `POST /api/anemia/analyze` is
non-persisting; the registry route stores only a SHA-256 image digest and the
coded result needed for its commitment.

## Deploying for real

A funded testnet deployer wallet was generated locally
(`contracts/.env.local`, gitignored — never committed, never printed to
any log). Its address:

```
0x26217031d5F54f9f2f49025CCb50Bc0D968c7559
```

To go from here to a real, judge-verifiable MST Testnet deployment:

1. **Fund it.** Visit `https://faucet.mstblockchain.com`, request MSTC for
   `0x26217031d5F54f9f2f49025CCb50Bc0D968c7559` (reCAPTCHA-gated — this
   step needs a human).
2. Confirm the balance **via RPC, not the faucet UI** (matches the
   caution in the original plan about not trusting the faucet page's
   wording at face value):
   ```bash
   cd contracts && npx hardhat run --network testnet -e "console.log(await ethers.provider.getBalance('0x26217031d5F54f9f2f49025CCb50Bc0D968c7559'))"
   ```
3. `npm run deploy:testnet` — deploys both contracts, writes
   `contracts/deployments.json`, prints the addresses for `backend/.env`.
4. Register the installed V4 manifest hash with `AnemiaRegistry.registerModel`
   before anchoring real V4 screenings. If deliberately deploying the mock
   CI/demo path instead, `npm run grant-roles:testnet` registers its mock model
   and prints `MST_MOCK_MODEL_HASH`.
5. Fill in `backend/.env`: the two contract addresses and
   `MST_ATTESTER_PRIVATE_KEY` /
   `MST_ISSUER_PRIVATE_KEY` / `MST_CLINIC_PRIVATE_KEY` (all can reuse
   `contracts/.env.local`'s `PRIVATE_KEY` for a single-key hackathon demo —
   that key already holds every role from the constructor).
6. Start the backend (`backend/README.md`) and hit `GET /health` — it
   confirms the live chain ID matches before you do anything else.
7. `POST /registry/screenings` for the first real
   `registerScreening()` transaction; note the `explorer_url` it returns.

## Non-breaking-changes check

```bash
corepack pnpm run build   # from the repo root
```

Confirmed passing after this work. `contracts/` and `sdk/ts/` use `npm`
(their own `node_modules`, gitignored) specifically so `pnpm-workspace.yaml`
at the root — which has no `packages:` glob, so it isn't actually a
multi-package pnpm workspace — never picks them up. `backend/` is a
separate Python project (own `.venv`, gitignored).

## What's deliberately out of scope here

- **BridgeKey / client-side wallet signing** — inherently frontend work.
  `/auth/challenge` + `/auth/verify` are ready
  for it.
- **Postgres + Alembic** — `backend/app/db.py` documents the swap
  (`DATABASE_URL`, same SQLAlchemy models); not wired up because SQLite +
  `create_all()` is enough for a hackathon build that isn't shipping to
  production, and Alembic migration authoring wasn't worth the time
  against everything else in this pass.
- **External clinical validation** — the values shown in the app are explicitly
  labelled as an internal development benchmark and are not a clinical-accuracy
  claim.
