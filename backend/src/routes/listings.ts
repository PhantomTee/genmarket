import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pinContent } from '../services/ipfs.js';
import { encryptKeyWithMaster } from '../services/encryption.js';
import { getAllListings, getListing, getContractABI } from '../services/genlayer.js';
import { insertListing, getListingById, getListingByChainId, updateChainListingId } from '../db/schema.js';

const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/listings/create
router.post('/create', async (req: Request, res: Response) => {
  try {
    const {
      title,
      description,
      price,
      category,
      demo_contract_address,
      encrypted_source_base64,
      seller_public_key,
      encryption_key_base64,
    } = req.body;

    if (
      !title || !description || !price || !category ||
      !demo_contract_address || !encrypted_source_base64 ||
      !seller_public_key || !encryption_key_base64
    ) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const listing_id = uuidv4();

    const ipfs_cid = await pinContent(
      encrypted_source_base64,
      `listing-${listing_id}.enc`
    );

    const wrappedKey = encryptKeyWithMaster(encryption_key_base64);

    await insertListing({
      listing_id,
      ipfs_cid,
      seller_pubkey: seller_public_key,
      encryption_key: wrappedKey,
      created_at: Date.now(),
    });

    return res.json({ ipfs_cid, listing_id });
  } catch (err: any) {
    console.error('POST /create error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/:id/chain-id — called after on-chain listing is created
router.post('/:id/chain-id', async (req: Request, res: Response) => {
  try {
    const { chain_listing_id } = req.body;
    if (!chain_listing_id) {
      return res.status(400).json({ error: 'chain_listing_id is required' });
    }
    await updateChainListingId(req.params.id, String(chain_listing_id));
    return res.json({ success: true });
  } catch (err: any) {
    console.error('POST /:id/chain-id error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/listings
router.get('/', async (_req: Request, res: Response) => {
  try {
    const listings = await getAllListings();
    return res.json(listings);
  } catch (err: any) {
    console.error('GET /listings error:', err.message);
    return res.status(500).json({ error: 'Failed to load listings', details: err.message });
  }
});

// GET /api/listings/abi?address=0x...
// Must come before /:id so Express doesn't treat "abi" as an id
router.get('/abi', async (req: Request, res: Response) => {
  try {
    const { address } = req.query;
    if (!address || typeof address !== 'string') {
      return res.status(400).json({ error: 'address query param is required' });
    }
    const abi = await getContractABI(address);
    return res.json(abi);
  } catch (err: any) {
    console.error('GET /abi error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch ABI', details: err.message });
  }
});

// GET /api/listings/:id
// Accepts either a UUID (backend listing_id) or on-chain integer id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const rawId = req.params.id;
    let chainId = rawId;
    let dbRow;

    if (UUID_RE.test(rawId)) {
      // Look up DB row by UUID, then resolve the on-chain id from it
      dbRow = await getListingById(rawId);
      if (!dbRow?.chain_listing_id) {
        return res.status(404).json({ error: 'Listing not yet linked to on-chain id' });
      }
      chainId = dbRow.chain_listing_id;
    } else {
      // Numeric on-chain id — look up DB row by chain id
      dbRow = await getListingByChainId(rawId);
    }

    const listing = await getListing(chainId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    return res.json({ ...listing, ipfs_cid: dbRow?.ipfs_cid ?? listing.ipfs_cid });
  } catch (err: any) {
    console.error(`GET /${req.params.id} error:`, err.message);
    return res.status(500).json({ error: 'Failed to load listing', details: err.message });
  }
});

export default router;
