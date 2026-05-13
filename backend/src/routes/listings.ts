import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pinContent } from '../services/ipfs.js';
import { encryptKeyWithMaster, encryptForStorage } from '../services/encryption.js';
import { getAllListings, getListing, getContractABI } from '../services/genlayer.js';
import {
  insertListing,
  getListingByAnyId,
  updateOnchainListingId,
} from '../db/schema.js';

const router = Router();


// POST /api/listings/create
// Backend owns encryption + IPFS upload.
// Frontend sends plaintext fullSourceCode and public previewCode.
router.post('/create', async (req: Request, res: Response) => {
  try {
    const { title, description, price, category, demoContractAddress, fullSourceCode, previewCode, sellerAddress } = req.body;

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
    if (!sellerAddress || typeof sellerAddress !== 'string' || !sellerAddress.trim()) {
      return res.status(400).json({ error: 'sellerAddress (connected wallet address) is required' });
    }

    const listing_id = uuidv4();

    const { encryptedBase64, keyBase64 } = encryptForStorage(fullSourceCode);
    const ipfs_cid = await pinContent(encryptedBase64, `listing-${listing_id}.enc`);
    const wrappedKey = encryptKeyWithMaster(keyBase64);
    const source_hash = crypto.createHash('sha256').update(fullSourceCode, 'utf8').digest('hex');

    await insertListing({
      listing_id,
      ipfs_cid,
      seller_pubkey: sellerAddress.toLowerCase(),
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

    const safeListings = Array.isArray(listings) ? listings : [];

    const enriched = safeListings.map((l) => ({
      ...l,
      onchain_listing_id: (l as any).onchain_listing_id || l.id,
    }));

    return res.json(enriched);
  } catch (err: any) {
    console.error('GET /api/listings failed:', err.message);

    // Important: frontend expects an array. Do not return an error object here.
    return res.json([]);
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
    const dbRow = await getListingByAnyId(rawId);

    // Case 1: DB UUID or DB row exists
    if (dbRow) {
      const chainId = dbRow.onchain_listing_id || dbRow.chain_listing_id || null;

      // If DB row is not linked to on-chain yet, return DB-safe data.
      // Do NOT call GenLayer with a UUID.
      if (!chainId) {
        return res.json({
          id: dbRow.listing_id,
          listing_id: dbRow.listing_id,
          onchain_listing_id: null,
          ipfs_cid: dbRow.ipfs_cid,
          preview_code: dbRow.preview_code || '',
          source_hash: dbRow.source_hash || '',
          status: 'pending_onchain',
          seller_upvotes: '0',
          seller_downvotes: '0',
          seller_score: 'none',
        });
      }

      const listing = await getListing(chainId);

      return res.json({
        ...listing,
        id: dbRow.listing_id,
        listing_id: dbRow.listing_id,
        onchain_listing_id: chainId,
        onchain_id: chainId,
        ipfs_cid: dbRow.ipfs_cid || listing.ipfs_cid,
        preview_code: (listing as any).preview_code || dbRow.preview_code || '',
        source_hash: (listing as any).source_hash || dbRow.source_hash || '',
      });
    }

    // Case 2: No DB row, but rawId is numeric, so it may be an on-chain listing id
    if (/^[0-9]+$/.test(rawId)) {
      const listing = await getListing(rawId);

      return res.json({
        ...listing,
        id: listing.id,
        onchain_listing_id: listing.id,
        onchain_id: listing.id,
      });
    }

    // Case 3: UUID not found in DB
    return res.status(404).json({ error: 'Listing not found' });
  } catch (err: any) {
    console.error('GET /api/listings/:id error', rawId, err.message);
    return res.status(500).json({
      error: 'Failed to load listing',
      details: err.message,
    });
  }
});

export default router;
