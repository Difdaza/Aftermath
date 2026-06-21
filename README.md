# Aftermath

On-chain exploit insurance on [GenLayer](https://genlayer.com). File a protocol-exploit claim with the on-chain trace and the public post-mortem; LLM-validator consensus decides whether it was a genuine, covered breach and pays the policy coverage from the pool.

## How it works

1. Backers **fund the pool** in GEN. It is the capital every covered claim is paid from.
2. A policyholder **files a claim** with the protocol name, the on-chain trace, the post-mortem, and the coverage (sum insured, in GEN).
3. **Adjudication** runs on GenLayer: each validator reads the trace against the post-mortem and agrees on whether the event was a real exploit (`covered`) and the eligible damage in USD. Validators agree on the covered flag and land within 20% of each other on the damage.
4. A `COVERED` claim is **settled** for its coverage, capped by the pool. The USD damage figure only gates the verdict; it never enters the payout math, so dollar and wei are never mixed.

## Architecture

```
src/                   React + Vite + TypeScript dashboard (genlayer-js)
backend/aftermath.py   GenLayer Intelligent Contract (Python, runs on the GenVM)
```

The dashboard is a static single-page app. It reads protocol state directly through genlayer-js (`get_case`, `get_counts`, `get_pool_balance`) and signs writes with the connected wallet. No backend server.

## Live deployment

- **Network**: GenLayer Studionet (chain id 61999)
- **Contract**: `0xb17730AB3B2a4972aA157A8e18A2AD65Efb5B77E`

## Run locally

```bash
npm install
npm run dev      # Vite dev server
npm run build    # production build to dist
```

## Deploy the contract

Requires the [GenLayer CLI](https://docs.genlayer.com/) (`npx genlayer`). Set the deployed address in `frontend/src/chain.ts` afterwards.

```bash
npx genlayer deploy --contract backend/aftermath.py
```

## Contract methods (`ClaimForge`)

| Method | Type | Description |
|--------|------|-------------|
| `fund_pool` | write, payable | Add GEN to the insurance pool |
| `file_claim` | write | Register a claim (protocol, trace, post-mortem, coverage) |
| `adjudicate` | write | LLM consensus on the covered flag and damage; sets the verdict |
| `settle_claim` | write | Pay a COVERED claim its coverage, capped by the pool |
| `get_case` | view | Read a claim by id |
| `get_pool_balance` | view | Current pool balance |
| `get_counts` | view | `next_id \|\| ruled \|\| covered` |

## License

MIT
