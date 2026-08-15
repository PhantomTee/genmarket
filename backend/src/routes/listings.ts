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

/** Returns true only for valid on-chain listing ids like "0", "1", "2". */
function isOnchainId(value: string): boolean {
  return /^[0-9]+$/.test(value);
}

// POST /api/listings/create
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
    if (!isOnchainId(String(resolvedId))) {
      return res.status(400).json({ error: 'onchain_listing_id must be a numeric string like "0"' });
    }
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

// GET /api/listings/:id — accepts DB UUID or numeric on-chain id
router.get('/:id', async (req: Request, res: Response) => {
  const rawId = req.params.id;
  console.log('GET /api/listings/:id', rawId);
  try {
    // 1. Look up DB row by UUID or onchain_listing_id
    const dbRow = await getListingByAnyId(rawId);

    if (dbRow) {
      // 2a. DB row found — resolve the numeric on-chain id
      const chainId = isOnchainId(dbRow.onchain_listing_id ?? '')
        ? dbRow.onchain_listing_id!
        : await (async () => {
            // onchain_listing_id missing or invalid — scan by ipfs_cid
            const all = await getAllListings();
            const match = all.find((l) => l.ipfs_cid === dbRow.ipfs_cid);
            if (match) {
              await updateOnchainListingId(dbRow.listing_id, match.id);
              return match.id;
            }
            return null;
          })();

      if (!chainId) {
        return res.status(404).json({ error: 'Listing not yet confirmed on-chain' });
      }

      const onchain = await getListing(chainId);
      console.log('Found listing db=%s onchain_id=%s', dbRow.listing_id, chainId);
      return res.json({
        ...onchain,
        onchain_listing_id: chainId,
        ipfs_cid:     dbRow.ipfs_cid     ?? onchain.ipfs_cid,
        preview_code: (onchain as any).preview_code || dbRow.preview_code || '',
        source_hash:  (onchain as any).source_hash  || dbRow.source_hash  || '',
      });
    }

    // 2b. Not in DB — only proceed if rawId is a numeric on-chain id
    if (!isOnchainId(rawId)) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const onchain = await getListing(rawId);
    console.log('Found on-chain listing id=%s', rawId);
    return res.json({ ...onchain, onchain_listing_id: rawId });
  } catch (err: any) {
    console.error('GET /api/listings/:id error', rawId, err.message);
    return res.status(500).json({ error: 'Failed to load listing', details: err.message });
  }
});

export default router;
