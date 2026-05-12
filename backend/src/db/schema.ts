import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      listing_id       TEXT PRIMARY KEY,
      ipfs_cid         TEXT NOT NULL,
      seller_pubkey    TEXT NOT NULL,
      encryption_key   TEXT NOT NULL,
      created_at       BIGINT NOT NULL,
      chain_listing_id TEXT,
      lint_status      TEXT,
      lint_stdout      TEXT,
      lint_stderr      TEXT,
      linted_at        BIGINT
    )
  `);
  await pool.query(`
    ALTER TABLE listings ADD COLUMN IF NOT EXISTS chain_listing_id TEXT
  `);
}

export interface DbListing {
  listing_id: string;
  ipfs_cid: string;
  seller_pubkey: string;
  encryption_key: string;
  created_at: number;
  chain_listing_id?: string;
  lint_status?: string;
  lint_stdout?: string;
  lint_stderr?: string;
  linted_at?: number;
}

export async function insertListing(row: DbListing): Promise<void> {
  await pool.query(
    `INSERT INTO listings (listing_id, ipfs_cid, seller_pubkey, encryption_key, created_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [row.listing_id, row.ipfs_cid, row.seller_pubkey, row.encryption_key, row.created_at]
  );
}

export async function updateChainListingId(listingId: string, chainListingId: string): Promise<void> {
  await pool.query(
    'UPDATE listings SET chain_listing_id = $1 WHERE listing_id = $2',
    [chainListingId, listingId]
  );
}

export async function getListingById(listingId: string): Promise<DbListing | undefined> {
  const result = await pool.query('SELECT * FROM listings WHERE listing_id = $1', [listingId]);
  return result.rows[0] as DbListing | undefined;
}

export async function getListingByChainId(chainListingId: string): Promise<DbListing | undefined> {
  const result = await pool.query('SELECT * FROM listings WHERE chain_listing_id = $1', [chainListingId]);
  return result.rows[0] as DbListing | undefined;
}
