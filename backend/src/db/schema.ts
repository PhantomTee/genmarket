import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ---------------------------------------------------------------------------
// Schema init — idempotent, safe to run on every startup
// ---------------------------------------------------------------------------

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.listings (
      listing_id         TEXT PRIMARY KEY,
      ipfs_cid           TEXT NOT NULL,
      seller_pubkey      TEXT NOT NULL DEFAULT '',
      encryption_key     TEXT NOT NULL,
      created_at         BIGINT NOT NULL,
      chain_listing_id   TEXT,
      onchain_listing_id TEXT,
      create_tx_hash     TEXT,
      preview_code       TEXT,
      source_hash        TEXT,
      lint_status        TEXT,
      lint_stdout        TEXT,
      lint_stderr        TEXT,
      linted_at          BIGINT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.purchases (
      purchase_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      listing_id         TEXT NOT NULL REFERENCES public.listings(listing_id) ON DELETE CASCADE,
      onchain_listing_id TEXT,
      escrow_id          TEXT NOT NULL,
      buyer_address      TEXT NOT NULL,
      seller_address     TEXT,
      price              TEXT,
      ipfs_cid           TEXT,
      source_hash        TEXT,
      status             TEXT NOT NULL DEFAULT 'locked',
      created_at         BIGINT NOT NULL,
      confirmed_at       BIGINT,
      refunded_at        BIGINT,
      UNIQUE (escrow_id)
    )
  `);

  // Safe migrations for existing deployments
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS chain_listing_id TEXT`);
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS onchain_listing_id TEXT`);
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS create_tx_hash TEXT`);
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS preview_code TEXT`);
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS source_hash TEXT`);
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS lint_status TEXT`);
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS lint_stdout TEXT`);
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS lint_stderr TEXT`);
  await pool.query(`ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS linted_at BIGINT`);

  // Migrate old chain_listing_id → onchain_listing_id
  await pool.query(`
    UPDATE public.listings
    SET onchain_listing_id = chain_listing_id
    WHERE onchain_listing_id IS NULL AND chain_listing_id IS NOT NULL
  `);
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export interface DbListing {
  listing_id: string;
  ipfs_cid: string;
  seller_pubkey: string;
  encryption_key: string;
  created_at: number;
  chain_listing_id?: string;
  onchain_listing_id?: string;
  create_tx_hash?: string;
  preview_code?: string;
  source_hash?: string;
  lint_status?: string;
  lint_stdout?: string;
  lint_stderr?: string;
  linted_at?: number;
}

export async function insertListing(
  row: Omit<DbListing, 'chain_listing_id' | 'onchain_listing_id' | 'create_tx_hash' | 'lint_status' | 'lint_stdout' | 'lint_stderr' | 'linted_at'>
): Promise<void> {
  await pool.query(
    `INSERT INTO public.listings (listing_id, ipfs_cid, seller_pubkey, encryption_key, created_at, preview_code, source_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [row.listing_id, row.ipfs_cid, row.seller_pubkey, row.encryption_key, row.created_at, row.preview_code ?? null, row.source_hash ?? null]
  );
}

export async function updateOnchainListingId(listingId: string, onchainListingId: string, txHash?: string): Promise<void> {
  await pool.query(
    `UPDATE public.listings
     SET onchain_listing_id = $1, chain_listing_id = $1, create_tx_hash = $3
     WHERE listing_id = $2`,
    [onchainListingId, listingId, txHash ?? null]
  );
}

// Legacy alias kept for any remaining call sites
export const updateChainListingId = updateOnchainListingId;

/** Lookup by DB UUID or on-chain integer id — whichever matches first. */
export async function getListingByAnyId(id: string): Promise<DbListing | undefined> {
  const result = await pool.query(
    `SELECT * FROM public.listings WHERE listing_id = $1 OR onchain_listing_id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] as DbListing | undefined;
}

export async function getListingById(listingId: string): Promise<DbListing | undefined> {
  const result = await pool.query('SELECT * FROM public.listings WHERE listing_id = $1', [listingId]);
  return result.rows[0] as DbListing | undefined;
}

export async function getListingByChainId(chainListingId: string): Promise<DbListing | undefined> {
  const result = await pool.query(
    `SELECT * FROM public.listings WHERE onchain_listing_id = $1 OR chain_listing_id = $1 LIMIT 1`,
    [chainListingId]
  );
  return result.rows[0] as DbListing | undefined;
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export interface DbPurchase {
  purchase_id?: string;
  listing_id: string;
  onchain_listing_id?: string;
  escrow_id: string;
  buyer_address: string;
  seller_address?: string;
  price?: string;
  ipfs_cid?: string;
  source_hash?: string;
  status: 'locked' | 'released' | 'refunded';
  created_at: number;
  confirmed_at?: number;
  refunded_at?: number;
}

export async function upsertPurchase(row: Omit<DbPurchase, 'purchase_id'>): Promise<void> {
  await pool.query(
    `INSERT INTO public.purchases
       (listing_id, onchain_listing_id, escrow_id, buyer_address, seller_address,
        price, ipfs_cid, source_hash, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (escrow_id) DO UPDATE SET
       status             = EXCLUDED.status,
       onchain_listing_id = COALESCE(EXCLUDED.onchain_listing_id, public.purchases.onchain_listing_id),
       seller_address     = COALESCE(EXCLUDED.seller_address, public.purchases.seller_address),
       price              = COALESCE(EXCLUDED.price, public.purchases.price),
       ipfs_cid           = COALESCE(EXCLUDED.ipfs_cid, public.purchases.ipfs_cid),
       source_hash        = COALESCE(EXCLUDED.source_hash, public.purchases.source_hash)`,
    [
      row.listing_id,
      row.onchain_listing_id ?? null,
      row.escrow_id,
      row.buyer_address,
      row.seller_address ?? null,
      row.price ?? null,
      row.ipfs_cid ?? null,
      row.source_hash ?? null,
      row.status,
      row.created_at,
    ]
  );
}

export async function confirmPurchaseInDb(escrowId: string): Promise<void> {
  await pool.query(
    `UPDATE public.purchases SET status = 'released', confirmed_at = $2 WHERE escrow_id = $1`,
    [escrowId, Date.now()]
  );
}

export async function refundPurchaseInDb(escrowId: string): Promise<void> {
  await pool.query(
    `UPDATE public.purchases SET status = 'refunded', refunded_at = $2 WHERE escrow_id = $1`,
    [escrowId, Date.now()]
  );
}

export async function getPurchaseByEscrowId(escrowId: string): Promise<DbPurchase | undefined> {
  const result = await pool.query(
    `SELECT * FROM public.purchases WHERE escrow_id = $1`,
    [escrowId]
  );
  return result.rows[0] as DbPurchase | undefined;
}

export async function getPurchasesByBuyer(buyerAddress: string): Promise<DbPurchase[]> {
  const result = await pool.query(
    `SELECT * FROM public.purchases WHERE lower(buyer_address) = lower($1) ORDER BY created_at DESC`,
    [buyerAddress]
  );
  return result.rows as DbPurchase[];
}

export async function getRecentPurchases(limit = 15): Promise<DbPurchase[]> {
  const result = await pool.query(
    `SELECT * FROM public.purchases
     WHERE status = 'released'
     ORDER BY confirmed_at DESC NULLS LAST
     LIMIT $1`,
    [limit]
  );
  return result.rows as DbPurchase[];
}
