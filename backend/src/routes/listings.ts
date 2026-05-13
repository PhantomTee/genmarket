import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pinContent } from '../services/ipfs.js';
import { encryptKeyWithMaster, encryptForStorage } from '../services/encryption.js';
import { getAllListings, getListing, getContractABI } from '../services/genlayer.js';
import { insertListing, getListingById, getListingByChainId, updateChainListingId } from '../db/schema.js';

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

    // Encrypt full source on the backend — Pinata JWT and MASTER_KEY never leave here
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

// POST /api/listings/:id/chain-id
router.post('/:id/chain-id', async (req: Request, res: Response) => {
  try {
    const { chain_listing_id } = req.body;
    if (!chain_listing_id) return res.status(400).json({ error: 'chain_listing_id is required' });
    await updateChainListingId(req.params.id, String(chain_listing_id));
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/listings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const listings = await getAllListings();
    return res.json(listings);
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

// GET /api/listings/:id — accepts UUID or on-chain integer id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    let chainId = rawId;
    let dbRow;

    if (UUID_RE.test(rawId)) {
      dbRow = await getListingById(rawId);
      if (!dbRow?.chain_listing_id) return res.status(404).json({ error: 'Listing not yet linked to on-chain id' });
      chainId = dbRow.chain_listing_id;
    } else {
      dbRow = await getListingByChainId(rawId);
    }

    const listing = await getListing(chainId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    return res.json({
      ...listing,
      ipfs_cid:     dbRow?.ipfs_cid     ?? listing.ipfs_cid,
      preview_code: (listing as any).preview_code || dbRow?.preview_code || '',
      source_hash:  (listing as any).source_hash  || dbRow?.source_hash  || '',
    });
  } catch (err: any) {
    return res.status(500).json({ error: 'Failed to load listing', details: err.message });
  }
});

export default router;
