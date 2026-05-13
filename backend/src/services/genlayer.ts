import axios from 'axios';

// ---------------------------------------------------------------------------
// NOTE: genlayer-js is ESM-only. We use dynamic import() throughout so our
// CJS module can load it at runtime without static require() calls.
// Node.js caches dynamic imports, so repeated calls are instant after first load.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ABIParam {
  name: string;
  type: string;
}

export interface ABIMethod {
  name: string;
  inputs: ABIParam[];
  outputs: ABIParam[];
  readonly: boolean;
}

export type ABI = ABIMethod[];

export interface Listing {
  id: string;
  seller: string;
  title: string;
  description: string;
  price: number;
  category: string;
  demo_contract_address: string;
  ipfs_cid: string;
  status: 'active' | 'pending' | 'sold' | 'removed';
  preview_code?: string;
  source_hash?: string;
  seller_upvotes?: string;
  seller_downvotes?: string;
  seller_score?: string;
}

export interface Escrow {
  id: string;
  buyer: string;
  listing_id: string;
  amount: number;          // wei
  status: 'locked' | 'released' | 'refunded';
}

// ---------------------------------------------------------------------------
// Contract addresses
// ---------------------------------------------------------------------------

function marketplaceAddress(): string {
  const addr = process.env.MARKETPLACE_CONTRACT_ADDRESS;
  if (!addr) throw new Error('MARKETPLACE_CONTRACT_ADDRESS is not set');
  return addr;
}

// ---------------------------------------------------------------------------
// Read client (memoised — created once, reused for all view calls)
// Uses an ephemeral random account; reads don't require signing.
// ---------------------------------------------------------------------------

let _readClient: any = null;

async function getReadClient() {
  if (_readClient) return _readClient;
  const [{ createClient, createAccount }, { studionet }] = await Promise.all([
    import('genlayer-js'),
    import('genlayer-js/chains'),
  ]);
  const account = createAccount();
  _readClient = createClient({ chain: studionet, account });
  return _readClient;
}

// Helper: call a read-only (_json) method and parse the JSON string it returns
async function readJson<T>(functionName: string, args: unknown[] = []): Promise<T> {
  const client = await getReadClient();
  const jsonStr: string = await client.readContract({
    address: marketplaceAddress() as `0x${string}`,
    functionName,
    args,
  });
  return JSON.parse(jsonStr) as T;
}

// ---------------------------------------------------------------------------
// Marketplace — view reads
// Actual on-chain method names all have _json suffix and return JSON strings.
// ---------------------------------------------------------------------------

export async function getAllListings(): Promise<Listing[]> {
  const client = await getReadClient();
  const addr = marketplaceAddress() as `0x${string}`;

  const countRaw: unknown = await client.readContract({ address: addr, functionName: 'get_listing_count', args: [] });
  const count = Number(countRaw);
  const listings: Listing[] = [];

  for (let i = 0; i < count; i++) {
    try {
      const raw: unknown = await client.readContract({ address: addr, functionName: 'get_listing_json', args: [String(i)] });
      const listing = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Listing;
      listings.push(listing);
    } catch {
      // skip bad listings silently
    }
  }

  return listings;
}

export async function getListing(listingId: string): Promise<Listing> {
  return readJson<Listing>('get_listing_json', [listingId]);
}

export async function getListingsBySeller(seller: string): Promise<Listing[]> {
  return readJson<Listing[]>('get_listings_by_seller_json', [seller]);
}

export async function getEscrow(escrowId: string): Promise<Escrow> {
  return readJson<Escrow>('get_escrow_json', [escrowId]);
}

// ---------------------------------------------------------------------------
// Generic contract introspection — ContractPlayground
// gen_getContractSchema does NOT accept a block param (one arg only).
// ---------------------------------------------------------------------------

let _rpcId = 1;

function getRpcUrl(): string {
  const url = process.env.GENLAYER_RPC_URL;
  if (!url) throw new Error('GENLAYER_RPC_URL is not set');
  return url;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await axios.post<{ result: T; error?: { message: string } }>(
    getRpcUrl(),
    { jsonrpc: '2.0', method, params, id: _rpcId++ },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30_000 }
  );
  if (res.data.error) {
    throw new Error(`GenLayer RPC error (${method}): ${res.data.error.message}`);
  }
  return res.data.result;
}

export async function getContractABI(address: string): Promise<ABI> {
  // gen_getContractSchema takes only the address — no block tag
  return rpc<ABI>('gen_getContractSchema', [address]);
}

export async function callContractMethod(
  address: string,
  functionName: string,
  args: unknown[]
): Promise<unknown> {
  const client = await getReadClient();
  // For arbitrary contracts (ContractPlayground), call readContract directly
  const result: any = await client.readContract({
    address: address as `0x${string}`,
    functionName,
    args,
  });
  // If the result looks like a JSON string, parse it
  if (typeof result === 'string') {
    try { return JSON.parse(result); } catch { /* return as-is */ }
  }
  return result;
}
