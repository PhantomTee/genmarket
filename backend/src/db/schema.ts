import Database from 'better-sqlite3';
import path from 'path';

let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = process.env.DATABASE_URL ?? './genmarket.db';
  _db = new Database(path.resolve(dbPath));
  _db.pragma('journal_mode = WAL');
  return _db;
}

export function initDb(): void {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS listings (
      listing_id    TEXT PRIMARY KEY,
      ipfs_cid      TEXT NOT NULL,
      seller_pubkey TEXT NOT NULL,
      encryption_key TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
  `);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface DbListing {
  listing_id: string;
  ipfs_cid: string;
  seller_pubkey: string;
  encryption_key: string; // master-key-encrypted — never the raw key
  created_at: number;
}

export function insertListing(row: DbListing): void {
  getDb()
    .prepare(
      `INSERT INTO listings (listing_id, ipfs_cid, seller_pubkey, encryption_key, created_at)
       VALUES (@listing_id, @ipfs_cid, @seller_pubkey, @encryption_key, @created_at)`
    )
    .run(row);
}

export function getListingById(listingId: string): DbListing | undefined {
  return getDb()
    .prepare('SELECT * FROM listings WHERE listing_id = ?')
    .get(listingId) as DbListing | undefined;
}

export function getAllDbListings(): DbListing[] {
  return getDb()
    .prepare('SELECT * FROM listings ORDER BY created_at DESC')
    .all() as DbListing[];
}
