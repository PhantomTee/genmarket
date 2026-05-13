import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pinContent } from '../services/ipfs.js';
import { encryptKeyWithMaster, encryptForStorage } from '../services/encryption.js';
import { getAllListings, getListing, getContractABI } from '../services/genlayer.js';
import {
  insertListing,
  getListingByAnyId,
  getListingByChainId,
  updateOnchainListingId,
} from '../db/schema.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/listings/create
// Backend owns encryption + IPFS upload.
// Frontend sends plaintext fullSourceCode and public previewCode.
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { title, description, price, category, demoContractAddress, fullSourceCode, previewCode } = req.body;

    if (!title || !description || !price || !category) {
      return res.status(400).json({ error: 'Missing required fields: title, description, price, category' });
    }
    if (!fullSourceCode || typeof fullSourceCode !== 'string' || !fullSourceCode.trim()) {
      return res.status(400).json({ error: 'fullSourceCode is required' });
    }
    if (!previewCode || typeof previewCode !== 'string' || !previewCode.trim()) {
      return res.status(400).json({ error: 'previewCode is required' });
    }
    if (previewCode.trim() === fullSourceCode.trim()) {
      return res.status(400).json({ error: 'previewCode cannot be identical to fullSourceCode' });
    }

    const listing_id = uuidv4();

    const { encryptedBase64, keyBase64 } = encryptForStorage(fullSourceCode);
    const ipfs_cid = await pinContent(encryptedBase64, `listing-${listing_id}.enc`);
    const wrappedKey = encryptKeyWithMaster(keyBase64);
    const source_hash = crypto.createHash('sha256').update(fullSourceCode, 'utf8').digest('hex');

    await insertListing({
      listing_id,
      ipfs_cid,
      seller_pubkey: '',
      encryption_key: wrappedKey,
      created_at: Date.now(),
      preview_code: previewCode,
      source_hash,
    });

    return res.json({
      listing_id,
      ipfs_cid,
      source_hash,
      preview_code: previewCode,
      demo_contract_address: demoContractAddress ?? 'pending',
    });
  } catch (err: any) {
    console.error('POST /create error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/:id/chain-id — called by frontend after on-chain create_listing tx
router.post('/:id/chain-id', async (req: Request, res: Response) => {
  try {
    const { chain_listing_id, onchain_listing_id, tx_hash } = req.body;
    const resolvedId = onchain_listing_id ?? chain_listing_id;
    if (!resolvedId) return res.status(400).json({ error: 'onchain_listing_id is required' });
    await updateOnchainListingId(req.params.id, String(resolvedId), tx_hash);
    return res.json({ success: true, onchain_listing_id: resolvedId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/listings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const listings = await getAllListings();
    // `id` from the contract is the on-chain integer id — expose it as onchain_listing_id too
    const enriched = listings.map((l) => ({ ...l, onchain_listing_id: l.id }));
    return res.json(enriched);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load listings', details: err.message });
  }
});

// GET /api/listings/abi?address=0x...
router.get('/abi', async (req: Request, res: Response) => {
  try {
    const { address } = req.query;
    if (!address || typeof address !== 'string') return res.status(400).json({ error: 'address is required' });
    const abi = await getContractABI(address);
    return res.json(abi);
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to fetch ABI', details: err.message });
  }
});

// GET /api/listings/:id — accepts DB UUID or on-chain integer id
router.get('/:id', async (req: Request, res: Response) => {
  const rawId = req.params.id;
  console.log('GET /api/listings/:id', rawId);
  try {
    // 1. Try to find DB row by UUID or onchain_listing_id
    let dbRow = await getListingByAnyId(rawId);

    // 2. Determine the on-chain ID
    let chainId: string;

    if (dbRow?.onchain_listing_id) {
      chainId = dbRow.onchain_listing_id;
    } else if (!UUID_RE.test(rawId)) {
      // rawId is an on-chain integer id (e.g. "0") — use directly
      chainId = rawId;
    } else {
      // UUID with no onchain_listing_id yet — scan on-chain by ipfs_cid
      if (!dbRow) return res.status(404).json({ error: 'Listing not found' });
      const all = await getAllListings();
      const match = all.find((l) => l.ipfs_cid === dbRow!.ipfs_cid);
      if (match) {
        await updateOnchainListingId(dbRow.listing_id, match.id);
        dbRow = { ...dbRow, onchain_listing_id: match.id };
        chainId = match.id;
      } else {
        return res.status(404).json({ error: 'Listing not yet confirmed on-chain' });
      }
    }

    // 3. Fetch on-chain data
    const listing = await getListing(chainId);
    if (!listing) return res.status(404).json({ error: 'Listing not found on-chain' });

    console.log('Found listing id=%s onchain_listing_id=%s', listing.id, chainId);

    // 4. Return merged response with both IDs explicit
    return res.json({
      ...listing,
      onchain_listing_id: chainId,
      ipfs_cid:     dbRow?.ipfs_cid     ?? listing.ipfs_cid,
      preview_code: (listing as any).preview_code || dbRow?.preview_code || '',
      source_hash:  (listing as any).source_hash  || dbRow?.source_hash  || '',
    });
  } catch (err: any) {
    console.error('GET /api/listings/:id error', rawId, err.message);
    return res.status(500).json({ error: 'Failed to load listing', details: err.message });
  }
});

export default router;
