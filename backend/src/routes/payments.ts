import { Router, Request, Response } from 'express';
import { getEscrow } from '../services/genlayer.js';
import { getListingById } from '../db/schema.js';
import { decryptKeyWithMaster } from '../services/encryption.js';

const router = Router();

// POST /api/payments/buy
// Tracking only — the actual buy() tx is submitted from the frontend wallet.
router.post('/buy', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address } = req.body;

    if (!listing_id || !buyer_address) {
      return res.status(400).json({ error: 'listing_id and buyer_address are required' });
    }

    const escrow_id = `${listing_id}_${buyer_address.toLowerCase()}`;
    return res.json({ escrow_id });
  } catch (err: any) {
    console.error('POST /buy error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/confirm
// Verifies escrow is locked on-chain, then returns the decryption key.
router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address } = req.body;

    if (!listing_id || !buyer_address) {
      return res.status(400).json({ error: 'listing_id and buyer_address are required' });
    }

    const escrow_id = `${listing_id}_${buyer_address.toLowerCase()}`;

    const escrow = await getEscrow(escrow_id);
    if (!escrow) {
      return res.status(404).json({ error: 'Escrow not found' });
    }

    if (escrow.buyer.toLowerCase() !== buyer_address.toLowerCase()) {
      return res.status(403).json({ error: 'Address mismatch: not the buyer on this escrow' });
    }

    if (escrow.status !== 'locked') {
      return res.status(400).json({
        error: `Escrow is not in locked state (current: ${escrow.status})`,
      });
    }

    const dbRow = await getListingById(listing_id);
    if (!dbRow) {
      return res.status(404).json({ error: 'Listing not found in database' });
    }

    const keyBase64 = decryptKeyWithMaster(dbRow.encryption_key);
    return res.json({ encryption_key_base64: keyBase64, ipfs_cid: dbRow.ipfs_cid });
  } catch (err: any) {
    console.error('POST /confirm error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/refund
// Tracking passthrough — actual refund() tx is submitted from the frontend wallet.
router.post('/refund', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address } = req.body;

    if (!listing_id || !buyer_address) {
      return res.status(400).json({ error: 'listing_id and buyer_address are required' });
    }

    const escrow_id = `${listing_id}_${buyer_address.toLowerCase()}`;
    return res.json({ escrow_id, status: 'refund_initiated' });
  } catch (err: any) {
    console.error('POST /refund error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
