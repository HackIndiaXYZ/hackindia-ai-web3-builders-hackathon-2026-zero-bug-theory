# Aneris

Hackathon team repository for Zero bug theory - [hackindia-team:hackindia-ai-web3-builders-hackathon-2026:zero-bug-theory]

## Tech Stack

This project is built with:
- React
- Vite
- Tailwind CSS
- pnpm

## Getting Started

### Installation

Install the project dependencies using `pnpm`:

```bash
pnpm install
```

### Development Server

Start the local development server:

```bash
pnpm run dev
```

### Build

Build the project for production:

```bash
pnpm run build
```

## MST Blockchain integration

Smart contracts (`contracts/`), backend (`backend/`), and a shared
commitment SDK (`sdk/`) live as separate, self-contained projects with
their own dependencies — none of it touches this app's `src/` or its
`pnpm` install. See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the
full architecture, what's been verified against the live MST Testnet, and
deployment steps.
