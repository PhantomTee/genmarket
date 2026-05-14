import { createClient, createAccount } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus, ExecutionResult } from 'genlayer-js/types';

// ---------------------------------------------------------------------------
// Types mirroring Marketplace.py state
// ---------------------------------------------------------------------------

export interface Listing {
  id: string;
  onchain_listing_id?: string;
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
  amount: number;       // wei
  status: 'locked' | 'released' | 'refunded';
}

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

// ---------------------------------------------------------------------------
// Contract addresses (set NEXT_PUBLIC_ vars in .env.local)
// ---------------------------------------------------------------------------

function marketplaceAddress(): `0x${string}` {
  const addr = process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS;
  if (!addr) throw new Error('NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS is not set');
  return addr as `0x${string}`;
}

// ---------------------------------------------------------------------------
// Read client — no wallet needed
// ---------------------------------------------------------------------------

export function createReadClient() {
  // A throw-away account is required by some genlayer-js versions for the
  // internal signer to initialise. It is never used to sign write txs here.
  const account = createAccount();
  return createClient({ chain: studionet, account });
}

// ---------------------------------------------------------------------------
// Wallet connection — returns address + a write-capable client
// ---------------------------------------------------------------------------

export async function connectWallet(): Promise<{
  address: `0x${string}`;
  writeClient: ReturnType<typeof createClient>;
}> {
  if (typeof window === 'undefined' || !window.ethereum) {
    throw new Error('No wallet detected. Install MetaMask or a compatible wallet.');
  }

  const accounts: string[] = await window.ethereum.request({
    method: 'eth_requestAccounts',
  });

  const address = accounts[0] as `0x${string}`;

  const writeClient = createClient({
    chain: studionet,
    account: address,
    provider: window.ethereum,
  });

  // Prompt wallet to add / switch to GenLayer Studionet.
  // writeClient.connect() uses MetaMask Snaps — not supported by Rabby or non-MetaMask wallets.
  // Wrap in try/catch and fall back to wallet_addEthereumChain so Rabby still works.
  try {
    await writeClient.connect('studionet');
  } catch {
    try {
      await window.ethereum.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: '0xF22F', // 61999
          chainName: 'Genlayer Studio Network',
          rpcUrls: ['https://studio.genlayer.com/api'],
          nativeCurrency: { name: 'GEN Token', symbol: 'GEN', decimals: 18 },
        }],
      });
    } catch {
      // Rabby / other wallets may silently handle network switching — proceed anyway
    }
  }

  return { address, writeClient };
}

// ---------------------------------------------------------------------------
// Helper — submit write tx and wait for FINALIZED
// ---------------------------------------------------------------------------

async function writeAndWait(
  writeClient: ReturnType<typeof createClient>,
  params: {
    address: `0x${string}`;
    functionName: string;
    args: unknown[];
    value?: bigint;
  }
): Promise<any> {
  const txHash = await writeClient.writeContract({
    address: params.address,
    functionName: params.functionName,
    args: params.args as any[],
    value: params.value ?? 0n,
  });

  const readClient = createReadClient();

  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 3_000,
    retries: 40,
  });

  const r = receipt as any;

  // GenLayer: consensus can be ACCEPTED while execution still ERRORS.
  // Check every field that might carry the execution failure.
  const hasError =
    r.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR ||
    r.txExecutionResultName === 'ERROR' ||
    r.execution_result === 'ERROR' ||
    r.execution_result === ExecutionResult.FINISHED_WITH_ERROR ||
    r.txExecutionResult === 'ERROR' ||
    r.txExecutionResult === ExecutionResult.FINISHED_WITH_ERROR ||
    r?.consensus_data?.leader_receipt?.execution_result === 'ERROR';

  if (hasError) {
    const stderr = r?.consensus_data?.leader_receipt?.stderr ?? '';
    const detail = stderr ? `: ${stderr.slice(0, 200)}` : '';
    throw new Error(`Transaction failed: ${params.functionName}${detail}`);
  }

  return receipt as any;
}

function safeParseJson(value: unknown): unknown {
  let current = value;

  for (let i = 0; i < 5; i++) {
    if (typeof current !== 'string') return current;

    const trimmed = current.trim();
    if (!trimmed) return null;

    try {
      current = JSON.parse(trimmed);
    } catch {
      return current;
    }
  }

  return current;
}

function decodeHexString(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  if (!/^0x[0-9a-fA-F]+$/.test(value)) return value;

  try {
    const hex = value.slice(2);
    let out = '';

    for (let i = 0; i < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }

    return out.replace(/\0+$/g, '');
  } catch {
    return value;
  }
}

function findReturnValueDeep(value: any, depth = 0): unknown {
  if (depth > 8 || value == null) return null;

  const parsed = safeParseJson(decodeHexString(value));

  if (typeof parsed === 'string') {
    return parsed;
  }

  if (typeof parsed !== 'object') {
    return null;
  }

  const directKeys = [
    'returnValue',
    'return_value',
    'returnData',
    'return_data',
    'output',
    'result',
  ];

  for (const key of directKeys) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      const found = safeParseJson(decodeHexString((parsed as any)[key]));
      if (found) return found;
    }
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findReturnValueDeep(item, depth + 1);
      if (found) return found;
    }
  } else {
    for (const item of Object.values(parsed as Record<string, unknown>)) {
      const found = findReturnValueDeep(item, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

// Shared helper — reads the contract's return value from a fullTransaction receipt.
// GenLayer SDK puts it in consensus_data.leader_receipt.eq_outputs (not .returnValue).
function extractReturnValue(receipt: any): string {
  // Primary: consensus_data path (requires fullTransaction: true)
  const eqOutputs = receipt?.consensus_data?.leader_receipt?.eq_outputs;

  const fromOutputs = (() => {
    if (!eqOutputs) return '';
    if (typeof eqOutputs === 'string') return eqOutputs;
    if (Array.isArray(eqOutputs) && eqOutputs.length > 0) {
      const v = eqOutputs[0];
      return typeof v === 'string' ? v : (v?.result ?? v?.value ?? '');
    }
    if (typeof eqOutputs === 'object') {
      return eqOutputs?.result ?? eqOutputs?.value ?? '';
    }
    return '';
  })();

  if (fromOutputs && String(fromOutputs).trim()) {
    return String(fromOutputs).trim().replace(/^"+|"+$/g, '');
  }

  // Legacy fallbacks (kept for SDK version changes)
  const legacy =
    receipt?.returnValue ??
    receipt?.result ??
    receipt?.txExecutionResult?.returnValue ??
    '';

  return legacy ? String(legacy).trim() : '';
}

async function tryReadTxReturn(txHash: `0x${string}`): Promise<string> {
  const readClient = createReadClient();

  try {
    const trace = await (readClient as any).debugTraceTransaction({
      hash: txHash,
      round: 0,
    });

    const value = findReturnValueDeep(trace);

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    if (value != null) {
      return String(value);
    }
  } catch {
    // Some clients may not expose debugTraceTransaction.
  }

  return '';
}

// ---------------------------------------------------------------------------
// Marketplace — write methods
// ---------------------------------------------------------------------------

export async function createListing(
  writeClient: ReturnType<typeof createClient>,
  params: {
    title: string;
    description: string;
    price: bigint;
    category: string;
    demo_contract_address: string;
    ipfs_cid: string;
    preview_code: string;
    source_hash: string;
  }
): Promise<string> {
  const txHash = await writeClient.writeContract({
    address: marketplaceAddress(),
    functionName: 'create_listing',
    args: [
      params.title,
      params.description,
      params.price,
      params.category,
      params.demo_contract_address,
      params.ipfs_cid,
      params.preview_code,
      params.source_hash,
    ] as any[],
    value: 0n,
  });

  const readClient = createReadClient();

  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 3_000,
    retries: 100,          // 5 min total — GenLayer Studionet can be slow
    fullTransaction: true,
  } as any);

  if ((receipt as any).txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error('Transaction failed: create_listing');
  }

  const listingIdFromReceipt = extractReturnValue(receipt);
  if (listingIdFromReceipt) return listingIdFromReceipt;

  return tryReadTxReturn(txHash as `0x${string}`);
}

export async function buy(
  writeClient: ReturnType<typeof createClient>,
  listingId: string,
  priceWei: bigint,
  buyerAddress?: string
): Promise<string> {
  const txHash = await writeClient.writeContract({
    address: marketplaceAddress(),
    functionName: 'buy',
    args: [listingId],
    value: priceWei,
  });

  const readClient = createReadClient();

  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 3_000,
    retries: 40,
    fullTransaction: true,
  } as any);

  if ((receipt as any).txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error('Transaction failed: buy');
  }

  const fromReceipt = extractReturnValue(receipt);
  if (fromReceipt) return fromReceipt;

  const traced = await tryReadTxReturn(txHash as `0x${string}`);
  if (traced) return traced;

  // New Marketplace contract: escrow_id === listing_id.
  // Return listing_id as the reliable fallback.
  return listingId;
}



export async function confirmPurchase(
  writeClient: ReturnType<typeof createClient>,
  escrowId: string
): Promise<void> {
  if (!escrowId || !escrowId.trim()) {
    throw new Error('Missing escrow id for confirm_purchase');
  }

  await writeAndWait(writeClient, {
    address: marketplaceAddress(),
    functionName: 'confirm_purchase',
    args: [escrowId],
  });
}

export async function refund(
  writeClient: ReturnType<typeof createClient>,
  escrowId: string
): Promise<void> {
  if (!escrowId || !escrowId.trim()) {
    throw new Error('Missing escrow id for refund');
  }

  await writeAndWait(writeClient, {
    address: marketplaceAddress(),
    functionName: 'refund',
    args: [escrowId],
  });
}

export async function voteSeller(
  writeClient: ReturnType<typeof createClient>,
  escrowId: string,
  isUpvote: boolean
): Promise<void> {
  if (!escrowId || !escrowId.trim()) {
    throw new Error('Missing escrow id for vote_seller');
  }

  await writeAndWait(writeClient, {
    address: marketplaceAddress(),
    functionName: 'vote_seller',
    args: [escrowId, isUpvote],
  });
}

// ---------------------------------------------------------------------------
// Deploy a contract to GenLayer Studionet
// ---------------------------------------------------------------------------

export async function deployContract(
  writeClient: ReturnType<typeof createClient>,
  sourceCode: string
): Promise<`0x${string}`> {
  const txHash = await (writeClient as any).deployContract({
    code: sourceCode,
    args: [],
    value: 0n,
  });

  const readClient = createReadClient();

  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 3_000,
    retries: 60,
  });

  if ((receipt as any).txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error('Contract deployment failed');
  }

  // The deployed contract address is returned in the receipt
  const addr =
    (receipt as any).contractAddress ??
    (receipt as any).to ??
    (receipt as any)?.txExecutionResult?.contractAddress;

  if (!addr) {
    throw new Error('Deployment succeeded but no contract address returned');
  }

  return addr as `0x${string}`;
}
// ---------------------------------------------------------------------------
// Marketplace — read methods
// ---------------------------------------------------------------------------

export async function callContractMethod(
  contractAddress: string,
  functionName: string,
  args: unknown[]
): Promise<unknown> {
  const client = createReadClient();

  const raw = await client.readContract({
    address: contractAddress as `0x${string}`,
    functionName,
    args,
  } as any);

  // Try to parse as JSON, fall back to the raw value
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

export async function callWriteMethod(
  writeClient: ReturnType<typeof createClient>,
  contractAddress: string,
  functionName: string,
  args: unknown[],
  value: bigint = 0n
): Promise<{ txHash: string; result: unknown }> {
  const receipt = await writeAndWait(writeClient, {
    address: contractAddress as `0x${string}`,
    functionName,
    args,
    value,
  });

  const result =
    (receipt as any).returnValue ??
    (receipt as any).result ??
    (receipt as any)?.txExecutionResult?.returnValue ??
    null;

  return {
    txHash: (receipt as any).transactionHash ?? (receipt as any).txHash ?? '',
    result: result !== null && typeof result === 'string'
      ? (() => { try { return JSON.parse(result); } catch { return result; } })()
      : result,
  };
}

export async function removeListing(
  writeClient: ReturnType<typeof createClient>,
  listingId: string
): Promise<void> {
  if (!listingId || !listingId.trim()) {
    throw new Error('Missing listing id for remove_listing');
  }

  await writeAndWait(writeClient, {
    address: marketplaceAddress(),
    functionName: 'remove_listing',
    args: [listingId],
  });
}


export async function getAllListings(): Promise<Listing[]> {
  const client = createReadClient();

  const raw = await client.readContract({
    address: marketplaceAddress(),
    functionName: 'get_all_listings_json',
    args: [],
  } as any);

  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const listings = Array.isArray(parsed) ? parsed : [];

  return listings.filter((listing: any) => listing.status === 'active') as Listing[];
}

export async function getListing(listingId: string): Promise<Listing> {
  const client = createReadClient();

  const raw = await client.readContract({
    address: marketplaceAddress(),
    functionName: 'get_listing_json',
    args: [listingId],
  } as any);

  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as Listing;
}

export async function getListingsBySeller(seller: string): Promise<Listing[]> {
  const client = createReadClient();

  const raw = await client.readContract({
    address: marketplaceAddress(),
    functionName: 'get_listings_by_seller_json',
    args: [seller],
  } as any);

  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? (parsed as Listing[]) : [];
}

export async function getListingsByCategory(category: string): Promise<Listing[]> {
  const client = createReadClient();

  const raw = await client.readContract({
    address: marketplaceAddress(),
    functionName: 'get_listings_by_category_json',
    args: [category],
  } as any);

  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return Array.isArray(parsed) ? (parsed as Listing[]) : [];
}

export async function getEscrow(escrowId: string): Promise<Escrow | null> {
  const client = createReadClient();

  try {
    const raw = await client.readContract({
      address: marketplaceAddress(),
      functionName: 'get_escrow_json',
      args: [escrowId],
    } as any);

    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as Escrow;
  } catch (err: any) {
    // GenLayer raises 'execution failed' when escrow_id not found.
    const msg = String(err?.message ?? '');
    if (msg.includes('execution failed') || msg.includes('KeyError') || msg.includes('Escrow not found')) {
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Generic contract introspection — ContractPlayground
// ---------------------------------------------------------------------------

export async function getContractABI(address: string): Promise<ABI> {
  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

  if (!BACKEND) {
    throw new Error('NEXT_PUBLIC_BACKEND_URL is not configured');
  }

  const res = await fetch(`${BACKEND}/api/listings/abi?address=${encodeURIComponent(address)}`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to fetch ABI');
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as ABI) : [];
}

// ---------------------------------------------------------------------------
// Judge contract
// ---------------------------------------------------------------------------

function judgeAddress(): `0x${string}` {
  const addr = process.env.NEXT_PUBLIC_JUDGE_CONTRACT_ADDRESS;

  if (!addr) {
    throw new Error('NEXT_PUBLIC_JUDGE_CONTRACT_ADDRESS is not set');
  }

  return addr as `0x${string}`;
}

export interface JudgeVerdict {
  verdict: 'match' | 'partial' | 'mismatch';
  confidence: number;
  explanation: string;
  caveats?: string[];
}

export async function evaluateWithJudge(
  writeClient: ReturnType<typeof createClient>,
  sourceCodePreview: string,
  sellerDescription: string,
  buyerRequirement: string
): Promise<JudgeVerdict | string> {
  const txHash = await writeClient.writeContract({
    address: judgeAddress(),
    functionName: 'evaluate',
    args: [sourceCodePreview, sellerDescription, buyerRequirement],
    value: 0n,
  });

  const readClient = createReadClient();

  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash,
    status: TransactionStatus.FINALIZED,
    interval: 3_000,
    retries: 100,          // 5 min total — Judge calls an LLM, can be slow on Studionet
    fullTransaction: true,
  } as any);

  if ((receipt as any).txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error('Judge transaction failed');
  }

  const judgeRaw = extractReturnValue(receipt) ?? (await tryReadTxReturn(txHash as `0x${string}`));

  if (judgeRaw) {
    const parsed = safeParseJson(decodeHexString(judgeRaw));
    if (typeof parsed === 'object' && parsed !== null) return parsed as JudgeVerdict;
    return String(parsed);
  }

  throw new Error('Judge transaction finalized, but no return value was found');
}
