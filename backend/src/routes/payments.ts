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
    const { listing_id, buyer_address, escrow_id } = req.body;

    if (!listing_id || !buyer_address) {
      return res.status(400).json({
        error: 'listing_id and buyer_address are required',
      });
    }

    // Prefer the exact escrow_id returned by the contract/frontend.
    // Do not manually build it from DB UUID + lowercased address.
    return res.json({
      escrow_id: escrow_id ? String(escrow_id) : null,
      status: 'tracking_only',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/confirm
// Verifies escrow is locked on-chain, decrypts full source on the backend, and delivers it.
router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address, escrow_id } = req.body;

    if (!listing_id || !buyer_address || !escrow_id) {
      return res.status(400).json({
        error: 'listing_id, buyer_address, and escrow_id are required',
      });
    }

    // ── On-chain escrow verification (mandatory) ────────────────────────────
    // The frontend calls confirm_purchase on-chain BEFORE hitting this endpoint.
    // After that, the contract transitions the escrow from 'locked' → 'released'.
    // We accept both states to cover the small race window where the tx is
    // finalized but our RPC cache hasn't updated yet.
    const finalEscrowId = String(escrow_id);
    const escrow = await getEscrow(finalEscrowId);

    if (!escrow) {
      return res.status(404).json({ error: 'Escrow not found on-chain' });
    }

    // Buyer address is ALWAYS required — no conditional check
    if (String(escrow.buyer).toLowerCase() !== String(buyer_address).toLowerCase()) {
      return res.status(403).json({
        error: 'Address mismatch: caller is not the buyer on this escrow',
      });
    }

    if (escrow.status !== 'locked' && escrow.status !== 'released') {
      return res.status(400).json({
        error: `Payment not confirmed on-chain (escrow status: ${escrow.status}). Call confirm_purchase on-chain first.`,
      });
    }


    const dbRow = await getListingById(String(listing_id));

    if (!dbRow) {
      return res.status(404).json({
        error: 'Listing not found in database',
      });
    }

    // Decrypt full source on the backend — key never leaves the server
    const keyBase64 = decryptKeyWithMaster(dbRow.encryption_key);
    const encryptedBase64 = await fetchFromIPFS(dbRow.ipfs_cid);
    const sourceCode = decryptFromStorage(encryptedBase64, keyBase64);

    // Verify integrity
    const verifiedHash = crypto
      .createHash('sha256')
      .update(sourceCode, 'utf8')
      .digest('hex');

    const sourceHash = dbRow.source_hash ?? verifiedHash;
    const hashMatch = dbRow.source_hash ? verifiedHash === dbRow.source_hash : null;

    return res.json({
      sourceCode,
      sourceHash,
      verifiedHash,
      hashMatch,
      ipfs_cid: dbRow.ipfs_cid,
      escrow_id: finalEscrowId,
    });
  } catch (err: any) {
    console.error('POST /confirm error:', err.message);

    return res.status(500).json({
      error: err.message,
    });
  }
});

// POST /api/payments/refund — tracking passthrough
router.post('/refund', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address, escrow_id } = req.body;

    if (!listing_id || !buyer_address) {
      return res.status(400).json({
        error: 'listing_id and buyer_address are required',
      });
    }

    return res.json({
      escrow_id: escrow_id ? String(escrow_id) : null,
      status: 'refund_initiated',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;