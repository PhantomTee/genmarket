# GenMarket

**Decentralized code marketplace on [GenLayer](https://genlayer.com)** — sell and buy AI-verified intelligent contracts with trustless on-chain escrow in native GEN token.

Live: **[genmarketplace.vercel.app](https://genmarketplace.vercel.app)**

---

## What is GenMarket?

GenMarket is a peer-to-peer marketplace where developers can sell their GenLayer intelligent contract source code. Every listing is:

- **Encrypted server-side** — full source is encrypted with NaCl secretbox on the backend; buyers see only a public code preview until they purchase
- **Stored on IPFS** — via Pinata; permanent and decentralized (ciphertext only)
- **AI-evaluable** — an optional AI Judge (JudgeContract) lets buyers request an advisory quality score before purchasing
- **Trustlessly paid** — native GEN token is locked in a smart contract escrow; source is only delivered after the escrow is confirmed released on-chain

---

## Architecture

```
genmarket/
├── contracts/
│   ├── Marketplace.py       GenLayer deterministic contract — listings, escrow, reputation
│   └── JudgeContract.py     GenLayer intelligent contract — LLM multi-validator code evaluation
├── backend/                 Node.js + Express + TypeScript
│   ├── src/routes/          REST API (auth, listings, payments, contracts, purchases, stats)
│   ├── src/services/        GenLayer RPC, encryption, IPFS, wallet-signature auth
│   └── src/db/schema.ts     PostgreSQL schema (Supabase) — listings + purchases
└── frontend/                Next.js 15 App Router
    ├── app/                 Pages (browse, sell, listing, dashboard, editor)
    ├── components/          PaymentModal, ListingCard, ListingClient, Navbar, Toast
    └── lib/                 genlayer.ts, wallet-context, encryption, lint, normalize
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
| `get_listing_count()` | Number of listings ever created |
| `get_listing_json(listing_id)` | Single listing as JSON |
| `get_escrow_json(escrow_id)` | Escrow state (buyer, amount, status) |
| `get_seller_reputation_json(seller_hex)` | Seller score |

**Escrow design:** `escrow_id === listing_id`. One active escrow per listing; can be reused after refund.

**ID model:** Each listing has two IDs. The DB UUID (`listing_id`) is an internal identifier generated at upload time. The on-chain integer (`onchain_listing_id`, e.g. `"0"`) is set after the `create_listing` transaction confirms. The backend maps between them and never passes a UUID to GenLayer.

### `JudgeContract.py` (Intelligent)

Uses GenLayer's LLM multi-validator consensus to evaluate the **public code preview** (not the encrypted full source). Returns a structured JSON verdict with a score and reasoning. The evaluation is advisory — sellers can opt in before listing, buyers can request it to aid purchasing decisions.

---

## Encryption Model

Full source code is never stored or transmitted in plaintext. The backend:

1. Generates a random NaCl secretbox key per listing
2. Encrypts the full source with that key
3. Uploads the **ciphertext** to IPFS
4. Wraps the per-listing key with AES-256-GCM using `MASTER_KEY`
5. Stores the wrapped key in PostgreSQL

Decryption only happens inside the backend process at delivery time. The `MASTER_KEY` environment variable stays exclusively on the backend — never in the frontend or database.

---

## Payment Flow

```
Seller                          Buyer                          Backend
  │                               │                               │
  ├─ Upload full source ──────────────────────────────────────►  │
  │                                                   encrypt    │
  │                                                   IPFS pin   │
  │  ◄── listing_id (UUID) ────────────────────────────────────  │
  ├─ create_listing() on-chain                                    │
  ├─ POST /api/listings/:id/chain-id (signed) ─────────────────► │
  │                               │                               │
  │                    buy(id) on-chain (GEN locked)              │
  │                    confirm_purchase(id) on-chain              │
  │                    ├─ escrow status: released                  │
  │                    │                                          │
  │                    ├─ GET /api/auth/nonce ─────────────────► │
  │                    │  ◄── nonce message ──────────────────── │
  │                    ├─ personal_sign(nonce) [MetaMask]         │
  │                    ├─ POST /api/payments/confirm (signed) ──► │
  │                               │            verify signature   │
  │                               │            verify escrow      │
  │                               │            decrypt source     │
  │                               │◄── source code ──────────── │
  │                    vote_seller() (optional)                   │
```

**Security guarantee:** Backend decrypts and delivers source only when:
1. `escrow.status === "released"` on-chain (seller already received GEN)
2. The caller provides a valid `personal_sign` over a one-time nonce tied to their wallet address

---

## Authentication

Sensitive routes require a wallet-signed nonce:

1. `GET /api/auth/nonce?address=0x...&action=<action>` — returns a one-time message
2. Client calls `personal_sign(message, address)` via MetaMask
3. Signed request is sent with `{ signature, auth_message }` in the request body
4. Backend verifies with viem `recoverMessageAddress`; nonce expires after 5 minutes and is single-use

| Route | Auth required |
|---|---|
| `POST /api/payments/confirm` | Buyer must sign (`action=confirm-purchase`) |
| `POST /api/listings/:id/chain-id` | Seller should sign (`action=link-listing`) |

---

## Security Properties

| Property | Implementation |
|---|---|
| Source never exposed pre-sale | NaCl secretbox encryption; IPFS stores ciphertext only |
| Per-listing key isolation | Unique key per listing, wrapped with `MASTER_KEY` (AES-256-GCM) |
| Seller paid before source delivered | Backend checks `escrow.status === "released"` on-chain |
| Buyer identity verified on-chain | `escrow.buyer` address matched before decryption |
| Buyer wallet signature required | `personal_sign` nonce-auth on `/api/payments/confirm` |
| No server-side plaintext persistence | Source decrypted in memory at delivery; never written to DB |
| Reputation can't be gamed | Vote requires `escrow.status === "released"` — buyer must have confirmed |
| Preview ≠ full source enforced | Backend rejects uploads where `previewCode === fullSourceCode` |
| AI Judge sees only preview | JudgeContract receives the public preview, never the encrypted full source |

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
| `MASTER_KEY` | backend | Base64-encoded 32-byte master encryption key |
| `DATABASE_URL` | backend | Supabase connection string (port 6543 for pooler) |
| `PINATA_JWT` | backend | Pinata IPFS JWT credential |
| `NEXT_PUBLIC_BACKEND_URL` | frontend | Backend API base URL |
| `NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS` | frontend | Marketplace address (for on-chain reads) |
| `NEXT_PUBLIC_JUDGE_CONTRACT_ADDRESS` | frontend | JudgeContract address |

Generate a master key:
```bash
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
- **Backend:** Node.js, Express, TypeScript, `node-postgres`, `viem`
- **Contracts:** Python on GenLayer Studionet (`genlayer` SDK)
- **Wallet:** MetaMask + `genlayer-js` SDK
- **Storage:** Pinata IPFS
- **Database:** Supabase (PostgreSQL)
- **Encryption:** NaCl secretbox (tweetnacl) + AES-256-GCM master key wrapping
- **Auth:** Wallet-signature nonce auth via `personal_sign` + viem `recoverMessageAddress`
