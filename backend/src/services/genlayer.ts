import axios from 'axios';
import { privateKeyToAccount } from 'viem/accounts';

// ---------------------------------------------------------------------------
// NOTE: genlayer-js is ESM-only. Static `import` from a CJS module would
// compile to `require()` which Node cannot use on an ESM package. We use
// dynamic import() instead — it stays as an async import call, not require().
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
  price: number;           // wei — native GEN token
  category: string;
  demo_contract_address: string;
  ipfs_cid: string;
  status: 'active' | 'pending' | 'sold' | 'removed';
}

export interface Escrow {
  id: string;
  buyer: string;
  listing_id: string;
  amount: number;          // wei
  status: 'locked' | 'released' | 'refunded';
}

// ---------------------------------------------------------------------------
// JSON-RPC transport (read-only — view methods only)
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

async function readContract<T>(
  to: string,
  functionName: string,
  args: unknown[] = []
): Promise<T> {
  return rpc<T>('gen_call', [{
    from: '0x0000000000000000000000000000000000000000',
    to,
    data: { method: functionName, args },
    type: 'read',
    status: 'accepted',
  }]);
}

// ---------------------------------------------------------------------------
// Contract addresses
// ---------------------------------------------------------------------------

function marketplaceAddress(): string {
  const addr = process.env.MARKETPLACE_CONTRACT_ADDRESS;
  if (!addr) throw new Error('MARKETPLACE_CONTRACT_ADDRESS is not set');
  return addr;
}

function judgeAddress(): string {
  const addr = process.env.JUDGE_CONTRACT_ADDRESS;
  if (!addr) throw new Error('JUDGE_CONTRACT_ADDRESS is not set');
  return addr;
}

// ---------------------------------------------------------------------------
// Marketplace — view reads
// ---------------------------------------------------------------------------

export async function getAllListings(): Promise<Listing[]> {
  return readContract<Listing[]>(marketplaceAddress(), 'get_all_listings');
}

export async function getListing(listingId: string): Promise<Listing> {
  return readContract<Listing>(marketplaceAddress(), 'get_listing', [listingId]);
}

export async function getListingsBySeller(seller: string): Promise<Listing[]> {
  return readContract<Listing[]>(marketplaceAddress(), 'get_listings_by_seller', [seller]);
}

export async function getEscrow(escrowId: string): Promise<Escrow> {
  return readContract<Escrow>(marketplaceAddress(), 'get_escrow', [escrowId]);
}

// ---------------------------------------------------------------------------
// Generic contract introspection — ContractPlayground
// ---------------------------------------------------------------------------

export async function getContractABI(address: string): Promise<ABI> {
  return rpc<ABI>('gen_getContractSchema', [address, 'latest']);
}

export async function callContractMethod(
  address: string,
  functionName: string,
  args: unknown[]
): Promise<unknown> {
  return readContract<unknown>(address, functionName, args);
}

// ---------------------------------------------------------------------------
// JudgeContract — write tx via backend service wallet (Option A)
//
// evaluate() is @gl.public.write — it uses gl.exec_prompt and
// gl.eq_principle_prompt_comparative, which require multi-validator consensus.
// The backend signs the tx with BACKEND_PRIVATE_KEY, waits for FINALIZED,
// then extracts the verdict string from the transaction messages.
// Plaintext source_code is passed here and discarded by the caller immediately.
//
// genlayer-js is ESM-only, so we use dynamic import() to load it at runtime
// from our CJS module (dynamic import works across the CJS/ESM boundary).
// ---------------------------------------------------------------------------

async function getServiceClient() {
  const [{ createClient }, { studionet }] = await Promise.all([
    import('genlayer-js'),
    import('genlayer-js/chains'),
  ]);

  const pk = process.env.BACKEND_PRIVATE_KEY;
  if (!pk) throw new Error('BACKEND_PRIVATE_KEY is not set');
  const account = privateKeyToAccount(pk as `0x${string}`);

  return createClient({
    chain: studionet,
    account,
  });
}

export async function evaluateCode(
  sourceCode: string,
  sellerDescription: string,
  buyerRequirement: string
): Promise<string> {
  const { TransactionStatus, ExecutionResult } = await import('genlayer-js/types');
  const client = await getServiceClient();

  const txHash = await client.writeContract({
    address: judgeAddress() as `0x${string}`,
    functionName: 'evaluate',
    args: [sourceCode, sellerDescription, buyerRequirement],
    value: 0n,
  });

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 3_000,
    retries: 40,
  });

  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error('JudgeContract evaluation failed during execution');
  }

  // GenLayer returns the write method's return value in the transaction messages.
  // The return message is the last message with a non-null value field.
  const tx = await client.getTransaction({ hash: txHash });
  const messages: Array<{ value?: unknown }> = (tx as any).messages ?? [];
  const returnMsg = [...messages].reverse().find((m) => m.value !== undefined);

  if (returnMsg?.value !== undefined) {
    return typeof returnMsg.value === 'string'
      ? returnMsg.value
      : JSON.stringify(returnMsg.value);
  }

  // Fallback: some SDK versions surface it directly on the receipt
  const fallback = (receipt as any).returnValue ?? (receipt as any).result;
  if (fallback !== undefined) {
    return typeof fallback === 'string' ? fallback : JSON.stringify(fallback);
  }

  throw new Error('Could not extract verdict from judge transaction — check SDK version');
}
