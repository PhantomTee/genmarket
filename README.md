# GenMarket

Decentralized code marketplace built on [GenLayer](https://genlayer.com) — buy and sell verified intelligent contracts with on-chain escrow and AI-powered code evaluation.

## Architecture

```
/genmarket
  /contracts        GenLayer intelligent contracts (do not modify)
  /backend          Node.js + Express + TypeScript API
  /frontend         Next.js 14 App Router + Tailwind CSS
```

Two contracts on GenLayer Studionet (chain 61999):
- **Marketplace.py** — deterministic, handles listings and escrow in native GEN token
- **JudgeContract.py** — intelligent contract, evaluates code quality via LLM multi-validator consensus

## Setup

### 1. Environment variables

```bash
cp .env.example backend/.env
cp .env.example frontend/.env.local
```

Fill in all values. Key ones:

| Variable | Description |
|---|---|
| `GENLAYER_RPC_URL` | GenLayer Studionet RPC (default: `http://localhost:4000/api`) |
| `MARKETPLACE_CONTRACT_ADDRESS` | Deployed Marketplace.py address |
| `JUDGE_CONTRACT_ADDRESS` | Deployed JudgeContract.py address |
| `BACKEND_PRIVATE_KEY` | Service wallet private key (signs judge evaluation txs) |
| `ENCRYPTION_MASTER_KEY` | 32-byte base64 key — wraps per-listing keys in DB |
| `PINATA_API_KEY` / `PINATA_SECRET_API_KEY` | Pinata IPFS credentials |

Generate keys:
```bash
# ENCRYPTION_MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# BACKEND_PRIVATE_KEY
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Backend

```bash
cd backend
npm install
npm run dev          # ts-node, port 4000
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev          # Next.js, port 3000
```

## Pages

| Route | Description |
|---|---|
| `/` | Homepage with featured listings |
| `/browse` | All listings with search and category filter |
| `/listing/[id]` | Live contract playground + AI evaluation + purchase flow |
| `/sell` | Multi-step seller flow (encrypt → IPFS → on-chain listing) |
| `/dashboard` | Seller earnings + buyer purchase history |
| `/editor` | Standalone GenLayer contract editor with live lint |

## Payment flow

1. Buyer calls `Marketplace.buy(listing_id)` with GEN token as `msg.value` — payment locked in contract
2. Buyer calls `POST /api/payments/confirm` — backend verifies escrow on-chain, returns decryption key
3. Buyer fetches encrypted source from IPFS and decrypts in browser
4. Buyer calls `Marketplace.confirm_purchase(escrow_id)` — releases GEN to seller

## Security properties

- Source code encrypted with NaCl secretbox (client-side) before upload — backend never sees plaintext
- Per-listing encryption keys stored in SQLite wrapped with `ENCRYPTION_MASTER_KEY`
- Plaintext source only exists in memory during `/api/judge` request lifetime
- Decryption key only released after on-chain escrow is verified as `locked`
- Buyer address verified against on-chain escrow before key release

## GenLayer Studionet

Chain ID: `61999`  
Network name: `studionet`  
RPC: `http://localhost:4000/api` (local Studio) or hosted Studionet endpoint
