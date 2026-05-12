import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { TransactionStatus, ExecutionResult } from 'genlayer-js/types';

// ---------------------------------------------------------------------------
// Types mirroring Marketplace.py state
// ---------------------------------------------------------------------------

export interface Listing {
  id: string;
  seller: string;
  title: string;
  description: string;
  price: number;        // wei — native GEN token
  category: string;
  demo_contract_address: string;
  ipfs_cid: string;
  status: 'active' | 'pending' | 'sold' | 'removed';
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
  return createClient({ chain: studionet });
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
): Promise<ReturnType<typeof createReadClient>['waitForTransactionReceipt'] extends (...a: any[]) => Promise<infer R> ? R : never> {
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

  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error(`Transaction failed: ${params.functionName}`);
  }

  return receipt as any;
}

// ---------------------------------------------------------------------------
// Marketplace — write methods (called from user wallet)
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
  }
): Promise<string> {
  const receipt = await writeAndWait(writeClient, {
    address: marketplaceAddress(),
    functionName: 'create_listing',
    args: [
      params.title,
      params.description,
      params.price,
      params.category,
      params.demo_contract_address,
      params.ipfs_cid,
    ],
  });
  return (receipt as any).returnValue ?? '';
}

export async function buy(
  writeClient: ReturnType<typeof createClient>,
  listingId: string,
  priceWei: bigint
): Promise<string> {
  const receipt = await writeAndWait(writeClient, {
    address: marketplaceAddress(),
    functionName: 'buy',
    args: [listingId],
    value: priceWei,
  });
  // escrow_id is deterministic: "{listing_id}_{buyer_address}" — also returned by contract
  return (receipt as any).returnValue ?? '';
}

export async function confirmPurchase(
  writeClient: ReturnType<typeof createClient>,
  escrowId: string
): Promise<void> {
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
  await writeAndWait(writeClient, {
    address: marketplaceAddress(),
    functionName: 'refund',
    args: [escrowId],
  });
}

export async function removeListing(
  writeClient: ReturnType<typeof createClient>,
  listingId: string
): Promise<void> {
  await writeAndWait(writeClient, {
    address: marketplaceAddress(),
    functionName: 'remove_listing',
    args: [listingId],
  });
}

// ---------------------------------------------------------------------------
// Marketplace — read methods
// ---------------------------------------------------------------------------

export async function getAllListings(): Promise<Listing[]> {
  const client = createReadClient();

  const countRaw = await client.readContract({
    address: marketplaceAddress(),
    functionName: "get_listing_count",
    args: [],
  });

  const count = Number(countRaw);
  const listings: Listing[] = [];

  for (let i = 0; i < count; i++) {
    try {
      const raw = await client.readContract({
        address: marketplaceAddress(),
        functionName: "get_listing_json",
        args: [String(i)],
      });

      const listing = typeof raw === "string" ? JSON.parse(raw) : raw;

      if ((listing as Listing).status === "active") {
        listings.push(listing as Listing);
      }
    } catch (error) {
      console.error(`Failed to load listing ${i}:`, error);
    }
  }

  return listings;
}

export async function getListing(listingId: string): Promise<Listing> {
  const client = createReadClient();

  const raw = await client.readContract({
    address: marketplaceAddress(),
    functionName: "get_listing_json",
    args: [listingId],
  });

  return (typeof raw === "string" ? JSON.parse(raw) : raw) as unknown as Listing;
}

export async function getListingsBySeller(seller: string): Promise<Listing[]> {
  const client = createReadClient();
  const raw = await client.readContract({
    address: marketplaceAddress() as `0x${string}`,
    functionName: 'get_listings_by_seller_json',
    args: [seller],
  });
  const result = (typeof raw === 'string' ? JSON.parse(raw) : raw) as unknown as Listing[];
  return Array.isArray(result) ? result : [];
}

export async function getListingsByCategory(category: string): Promise<Listing[]> {
  const listings = await getAllListings();
  return listings.filter((listing) => listing.category === category);
}

export async function getEscrow(escrowId: string): Promise<Escrow> {
  const client = createReadClient();

  const raw = await client.readContract({
    address: marketplaceAddress(),
    functionName: "get_escrow_json",
    args: [escrowId],
  });

  return (typeof raw === "string" ? JSON.parse(raw) : raw) as unknown as Escrow;
}

// ---------------------------------------------------------------------------
// Generic contract introspection — ContractPlayground
// ---------------------------------------------------------------------------

export async function getContractABI(address: string): Promise<ABI> {
  const res = await fetch(`/api/listings/abi?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error('Failed to fetch contract ABI');
  return res.json();
}

export async function callContractMethod(
  address: string,
  functionName: string,
  args: unknown[]
): Promise<unknown> {
  const client = createReadClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return client.readContract({
    address: address as `0x${string}`,
    functionName,
    args: args as any,
  });
}

// ---------------------------------------------------------------------------
// Call a write (non-readonly) method on an arbitrary contract
// ---------------------------------------------------------------------------

export async function callWriteMethod(
  writeClient: ReturnType<typeof createClient>,
  address: string,
  functionName: string,
  args: unknown[],
  value = 0n
): Promise<{ txHash: string; result: unknown; receipt: unknown }> {
  const txHash = await writeClient.writeContract({
    address: address as `0x${string}`,
    functionName,
    args: args as any[],
    value,
  });

  const readClient = createReadClient();
  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash as any,
    status: TransactionStatus.FINALIZED,
    interval: 3_000,
    retries: 40,
  });

  if ((receipt as any).txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error('Transaction failed on-chain');
  }

  return {
    txHash: txHash as string,
    result: (receipt as any).returnValue ?? null,
    receipt,
  };
}

// ---------------------------------------------------------------------------
// Deploy a new contract — returns the deployed contract address
// ---------------------------------------------------------------------------

export async function deployContract(
  writeClient: ReturnType<typeof createClient>,
  code: string
): Promise<`0x${string}`> {
  const txHash = await writeClient.deployContract({ code, args: [] });

  const readClient = createReadClient();
  const receipt = await readClient.waitForTransactionReceipt({
    hash: txHash as any,
    status: TransactionStatus.FINALIZED,
    interval: 3_000,
    retries: 60,
  });

  if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error('Contract deployment failed on-chain');
  }

  // The deployed address lives in txDataDecoded or to_address
  const decoded = (receipt as any).txDataDecoded;
  const contractAddress =
    decoded?.contractAddress ??
    (receipt as any).to_address ??
    (receipt as any).recipient;

  if (!contractAddress) throw new Error('Deployment succeeded but contract address not found in receipt');
  return contractAddress as `0x${string}`;
}


