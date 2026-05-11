import { Router, Request, Response } from 'express';
import { fetchContent } from '../services/ipfs';
import { decryptFromStorage, decryptKeyWithMaster } from '../services/encryption';
import { evaluateCode, getListing } from '../services/genlayer';
import { getListingById } from '../db/schema';

const router = Router();

// POST /api/judge
// Decrypts source in memory, calls JudgeContract.evaluate via service wallet,
// discards plaintext immediately. Source never touches disk or logs.
router.post('/', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_requirement } = req.body;

    if (!listing_id || !buyer_requirement) {
      return res.status(400).json({ error: 'listing_id and buyer_requirement are required' });
    }

    const dbRow = getListingById(listing_id);
    if (!dbRow) {
      return res.status(404).json({ error: 'Listing not found in database' });
    }

    const listing = await getListing(listing_id);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found on chain' });
    }

    // Fetch encrypted source from IPFS
    const encryptedSource = await fetchContent(dbRow.ipfs_cid);

    // Unwrap the per-listing key and decrypt source — in memory only
    const keyBase64 = decryptKeyWithMaster(dbRow.encryption_key);
    const sourceCode = decryptFromStorage(encryptedSource, keyBase64);

    // Call JudgeContract.evaluate (signed write tx via backend service wallet)
    const verdictJson = await evaluateCode(
      sourceCode,
      listing.description,
      buyer_requirement
    );

    // sourceCode goes out of scope here — GC eligible immediately
    return res.json({ verdict: JSON.parse(verdictJson) });
  } catch (err: any) {
    console.error('POST /judge error:', err.message);
    return res.status(500).json({ error: 'Evaluation failed', details: err.message });
  }
});

export default router;
