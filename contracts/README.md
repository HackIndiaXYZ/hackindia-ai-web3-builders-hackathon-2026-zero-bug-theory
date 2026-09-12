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

```bash
npm run deploy:testnet        # writes deployments.json + prints addresses for backend/.env
npm run grant-roles:testnet   # registers the mock model, prints its hash for backend/.env
npm run verify:testnet -- <address> <constructor args...>   # optional MSTScan source verification
```

`deploy:local` / a `localhost` network target work the same way against a
`npx hardhat node` you run in another terminal — useful for iterating
without spending testnet funds.

## Network (verified live 2026-09-12 — see docs/DEPLOYMENT.md)

| | |
|---|---|
| RPC | `https://testnetrpc.mstblockchain.com` |
| Chain ID | `91562037` |
| Explorer | `https://testnet.mstscan.com` |
| Faucet | `https://faucet.mstblockchain.com` (reCAPTCHA-gated — needs a human) |
