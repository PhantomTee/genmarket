import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getEscrow } from '../services/genlayer.js';
import { getListingById } from '../db/schema.js';
import { decryptKeyWithMaster, decryptFromStorage } from '../services/encryption.js';
import { fetchFromIPFS } from '../services/ipfs.js';

const router = Router();

// POST /api/payments/buy — tracking only, actual tx is wallet-submitted
router.post('/buy', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address } = req.body;
    if (!listing_id || !buyer_address) return res.status(400).json({ error: 'listing_id and buyer_address are required' });
    return res.json({ escrow_id: `${listing_id}_${buyer_address.toLowerCase()}` });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/confirm
// Verifies escrow is locked on-chain, decrypts full source on the backend, and delivers it.
router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address } = req.body;
    if (!listing_id || !buyer_address) return res.status(400).json({ error: 'listing_id and buyer_address are required' });

    const escrow_id = `${listing_id}_${buyer_address.toLowerCase()}`;

    const escrow = await getEscrow(escrow_id);
    if (!escrow) return res.status(404).json({ error: 'Escrow not found' });
    if (escrow.buyer.toLowerCase() !== buyer_address.toLowerCase()) return res.status(403).json({ error: 'Address mismatch: not the buyer on this escrow' });
    if (escrow.status !== 'locked') return res.status(400).json({ error: `Escrow is not locked (current: ${escrow.status})` });

    const dbRow = await getListingById(listing_id);
    if (!dbRow) return res.status(404).json({ error: 'Listing not found in database' });

    // Decrypt full source on the backend — key never leaves the server
    const keyBase64 = decryptKeyWithMaster(dbRow.encryption_key);
    const encryptedBase64 = await fetchFromIPFS(dbRow.ipfs_cid);
    const sourceCode = decryptFromStorage(encryptedBase64, keyBase64);

    // Verify integrity
    const verifiedHash = crypto.createHash('sha256').update(sourceCode, 'utf8').digest('hex');
    const hashMatch = dbRow.source_hash ? verifiedHash === dbRow.source_hash : null;

    return res.json({
      sourceCode,
      sourceHash: dbRow.source_hash ?? verifiedHash,
      verifiedHash,
      hashMatch,
      ipfs_cid: dbRow.ipfs_cid,
    });
  } catch (err: any) {
    console.error('POST /confirm error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/refund — tracking passthrough
router.post('/refund', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address } = req.body;
    if (!listing_id || !buyer_address) return res.status(400).json({ error: 'listing_id and buyer_address are required' });
    return res.json({ escrow_id: `${listing_id}_${buyer_address.toLowerCase()}`, status: 'refund_initiated' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
