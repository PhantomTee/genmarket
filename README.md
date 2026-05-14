# GenMarket

**Decentralized code marketplace on [GenLayer](https://genlayer.com)** — sell and buy AI-verified intelligent contracts with trustless on-chain escrow in native GEN token.

Live: **[genmarketplace.vercel.app](https://genmarketplace.vercel.app)**

---

## What is GenMarket?

GenMarket is a peer-to-peer marketplace where developers can sell their GenLayer intelligent contract source code. Every listing is:

- **Encrypted** — source code is encrypted client-side before upload; the backend never sees plaintext
- **Stored on IPFS** — via Pinata, permanent and decentralized
- **AI-evaluated** — the JudgeContract runs multi-validator LLM consensus to score code quality before listing goes live
- **Trustlessly paid** — native GEN token is locked in a smart contract escrow; seller receives funds only when the buyer confirms delivery

---

## Architecture

```
genmarket/
├── contracts/
│   ├── Marketplace.py       GenLayer intelligent contract — listings, escrow, reputation
│   └── JudgeContract.py     Intelligent contract — LLM multi-validator code evaluation
├── backend/                 Node.js + Express + TypeScript
│   ├── src/routes/          REST API (listings, payments, judge, IPFS)
│   ├── src/services/        GenLayer RPC, encryption, IPFS helpers
│   └── src/db/schema.ts     PostgreSQL schema (Supabase) — listings + purchases
└── frontend/                Next.js 15 App Router
    ├── app/                 Pages (browse, sell, listing, dashboard, editor)
    ├── components/          PaymentModal, ListingClient, Toast, etc.
    └── lib/                 genlayer.ts, wallet-context, lint, normalize
```

**Chain:** GenLayer Studionet — Chain ID `61999`

---

## Contracts

### `Marketplace.py` (Deterministic)

Handles all listings and escrow logic on-chain.

| Method | Description |
|---|---|
| `create_listing(title, desc, price, category, preview, source_hash)` | Publish a listing on-chain |
| `buy(listing_id)` **payable** | Lock GEN in escrow; escrow ID = listing ID |
| `confirm_purchase(escrow_id)` | Release GEN to seller; marks listing sold |
| `refund(escrow_id)` | Return GEN to buyer; re-activates listing |
| `vote_seller(escrow_id, upvote)` | Submit seller reputation vote after purchase |
| `remove_listing(listing_id)` | Seller or owner removes a listing |
| `get_all_listings_json()` | All active listings as JSON |
| `get_listing_json(listing_id)` | Single listing |
| `get_escrow_json(escrow_id)` | Escrow state (buyer, amount, status) |
| `get_seller_reputation_json(seller_hex)` | Seller score |

**Escrow design:** `escrow_id === listing_id`. One active escrow per listing; can be reused after refund.

### `JudgeContract.py` (Intelligent)

Uses GenLayer's LLM multi-validator consensus to evaluate contract code quality before listing goes live. Returns a structured JSON verdict with a score and reasoning.

---

## Payment Flow

```
Seller                          Buyer                          Backend
  │                               │                               │
  ├─ Encrypt source (NaCl)        │                               │
  ├─ Upload to IPFS               │                               │
  ├─ POST /api/listings (store)   │                               │
  ├─ Judge evaluation (LLM)       │                               │
  ├─ create_listing() on-chain ───┤                               │
  │                               │                               │
  │                    buy(id) on-chain (GEN locked)              │
  │                    confirm_purchase(id) on-chain              │
  │                    ├─ emit_transfer → seller receives GEN      │
  │                    ├─ escrow status: released                  │
  │                    └─ POST /api/payments/confirm ────────────►│
  │                               │            verify escrow      │
  │                               │◄── source code ───────────────┤
  │                               │                               │
  │                    vote_seller() (optional)                   │
```

**Security guarantee:** Backend decrypts and delivers source code **only** when `escrow.status === "released"` on-chain — meaning the seller has already received payment.

---

## Security Properties

| Property | Implementation |
|---|---|
| Source never exposed pre-sale | NaCl secretbox encryption before upload; IPFS stores ciphertext only |
| Per-listing key isolation | Each listing has a unique encryption key, wrapped with `ENCRYPTION_MASTER_KEY` |
| Seller paid before source delivered | Backend checks `escrow.status === "released"` — not just "locked" |
| Buyer identity verified | `escrow.buyer` address matched against request before decryption |
| No server-side plaintext | Source decrypted on backend for delivery but never written to disk or DB |
| Reputation can't be gamed | Vote requires `escrow.status === "released"` — buyer must have actually paid and confirmed |

---

## Pages

| Route | Description |
|---|---|
| `/` | Homepage — featured listings, stats |
| `/browse` | All active listings with search + category filter |
| `/listing/[id]` | Listing detail — AI evaluation, live preview, buy flow |
| `/sell` | Multi-step seller flow: write → lint → encrypt → IPFS → on-chain |
| `/dashboard` | Seller earnings, buyer purchase history with re-download |
| `/editor` | Standalone Monaco-powered GenLayer contract IDE with live lint |

---

## Local Development

### Prerequisites

- Node.js 20+
- A GenLayer Studionet RPC endpoint (local Studio or hosted)
- Pinata account (IPFS)
- Supabase project (PostgreSQL)
- MetaMask with GenLayer Studionet configured

### 1. Environment variables

```bash
cp .env.example backend/.env
cp .env.example frontend/.env.local
```

| Variable | Where | Description |
|---|---|---|
| `GENLAYER_RPC_URL` | backend | GenLayer Studionet RPC |
| `MARKETPLACE_CONTRACT_ADDRESS` | backend | Deployed Marketplace.py address |
| `JUDGE_CONTRACT_ADDRESS` | backend | Deployed JudgeContract.py address |
| `MASTER_KEY` | backend | 32-byte base64 master encryption key |
| `DATABASE_URL` | backend | Supabase connection string (port 6543 for pooler) |
| `PINATA_API_KEY` / `PINATA_SECRET_API_KEY` | backend | Pinata IPFS credentials |
| `NEXT_PUBLIC_BACKEND_URL` | frontend | Backend API base URL |
| `NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS` | frontend | Same Marketplace address (public) |
| `NEXT_PUBLIC_GENLAYER_RPC_URL` | frontend | GenLayer RPC for frontend reads |

Generate keys:
```bash
# MASTER_KEY
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
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

---

## Deployment

| Service | Platform |
|---|---|
| Frontend | Vercel |
| Backend | Railway |
| Database | Supabase (PostgreSQL) |
| File storage | Pinata (IPFS) |
| Smart contracts | GenLayer Studionet |

### Database setup (Supabase)

Run in the Supabase SQL editor:

```sql
create extension if not exists "pgcrypto";

create table if not exists public.listings (
  listing_id text primary key,
  ipfs_cid text not null,
  seller_pubkey text not null default '',
  encryption_key text not null,
  created_at bigint not null,
  chain_listing_id text,
  onchain_listing_id text,
  create_tx_hash text,
  preview_code text,
  source_hash text,
  lint_status text,
  lint_stdout text,
  lint_stderr text,
  linted_at bigint
);

create table if not exists public.purchases (
  purchase_id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.listings(listing_id) on delete cascade,
  onchain_listing_id text,
  escrow_id text not null,
  buyer_address text not null,
  seller_address text,
  price text,
  ipfs_cid text,
  source_hash text,
  status text not null default 'locked',
  created_at bigint not null,
  confirmed_at bigint,
  refunded_at bigint,
  unique (escrow_id)
);
```

### Adding GenLayer Studionet to MetaMask

| Field | Value |
|---|---|
| Network name | GenLayer Studionet |
| RPC URL | *(your Studionet endpoint)* |
| Chain ID | `61999` |
| Currency symbol | `GEN` |

---

## Tech Stack

- **Frontend:** Next.js 15, TypeScript, Tailwind CSS, Monaco Editor, `@monaco-editor/react`
- **Backend:** Node.js, Express, TypeScript, `node-postgres`
- **Contracts:** Python on GenLayer Studionet (`genlayer` SDK)
- **Wallet:** MetaMask + `genlayer-js` SDK
- **Storage:** Pinata IPFS
- **Database:** Supabase (PostgreSQL)
- **Encryption:** NaCl secretbox (tweetnacl) + AES-256-GCM master key wrapping
