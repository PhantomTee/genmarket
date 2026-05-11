import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pinContent } from '../services/ipfs';
import { encryptKeyWithMaster } from '../services/encryption';
import { getAllListings, getListing, getContractABI } from '../services/genlayer';
import { insertListing, getListingById } from '../db/schema';

const router = Router();

// POST /api/listings/create
router.post('/create', async (req: Request, res: Response) => {
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

  insertListing({
    listing_id,
    ipfs_cid,
    seller_pubkey: seller_public_key,
    encryption_key: wrappedKey,
    created_at: Date.now(),
  });

  return res.json({ ipfs_cid, listing_id });
});

// GET /api/listings
router.get('/', async (_req: Request, res: Response) => {
  const listings = await getAllListings();
  return res.json(listings);
});

// GET /api/listings/:id
router.get('/:id', async (req: Request, res: Response) => {
  const listing = await getListing(req.params.id);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });

  // Attach ipfs_cid from local DB so the frontend can fetch encrypted source
  const dbRow = getListingById(req.params.id);
  return res.json({ ...listing, ipfs_cid: dbRow?.ipfs_cid ?? listing.ipfs_cid });
});

// GET /api/listings/abi?address=0x...
// Used by the frontend ContractPlayground via the Next.js proxy route
router.get('/abi', async (req: Request, res: Response) => {
  const { address } = req.query;
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ error: 'address query param is required' });
  }
  const abi = await getContractABI(address);
  return res.json(abi);
});

export default router;
