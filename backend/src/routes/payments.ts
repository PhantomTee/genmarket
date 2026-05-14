import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getEscrow } from '../services/genlayer.js';
import { getListingById, upsertPurchase, confirmPurchaseInDb, refundPurchaseInDb } from '../db/schema.js';
import { decryptKeyWithMaster, decryptFromStorage } from '../services/encryption.js';
import { fetchFromIPFS } from '../services/ipfs.js';

const router = Router();

// POST /api/payments/buy — records purchase intent, actual tx is wallet-submitted
router.post('/buy', async (req: Request, res: Response) => {
  try {
    const { listing_id, onchain_listing_id, buyer_address, escrow_id, price } = req.body;

    if (!listing_id || !buyer_address || !escrow_id) {
      return res.status(400).json({
        error: 'listing_id, buyer_address, and escrow_id are required',
      });
    }

    // Record the purchase in DB (non-blocking — don't fail if it errors)
    try {
      await upsertPurchase({
        listing_id,
        onchain_listing_id: onchain_listing_id ?? escrow_id,
        escrow_id: String(escrow_id),
        buyer_address,
        price: price ? String(price) : undefined,
        status: 'locked',
        created_at: Date.now(),
      });
    } catch (dbErr: any) {
      console.warn('POST /buy DB upsert failed (non-fatal):', dbErr.message);
    }

    return res.json({
      escrow_id: String(escrow_id),
      status: 'locked',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/confirm
// Verifies escrow state on-chain, decrypts full source on the backend, and delivers it.
router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address, escrow_id, onchain_listing_id } = req.body;

    if (!listing_id || !buyer_address || !escrow_id) {
      return res.status(400).json({
        error: 'listing_id, buyer_address, and escrow_id are required',
      });
    }

    // ── On-chain escrow verification (mandatory) ────────────────────────────
    // The frontend calls confirm_purchase on-chain BEFORE hitting this endpoint.
    // After that, the contract transitions the escrow: 'locked' → 'released'.
    // We accept both states to cover the small race window.
    const finalEscrowId = String(escrow_id);
    const escrow = await getEscrow(finalEscrowId);

    if (!escrow) {
      return res.status(404).json({ error: 'Escrow not found on-chain' });
    }

    if (String(escrow.buyer).toLowerCase() !== String(buyer_address).toLowerCase()) {
      return res.status(403).json({
        error: 'Address mismatch: caller is not the buyer on this escrow',
      });
    }

    if (escrow.status !== 'released') {
      return res.status(400).json({
        error: `Source not available yet. Escrow status is '${escrow.status}'. Call confirm_purchase on-chain first to release payment to the seller.`,
      });
    }

    const dbRow = await getListingById(String(listing_id));

    if (!dbRow) {
      return res.status(404).json({ error: 'Listing not found in database' });
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

    // Record confirmation in DB (non-blocking)
    try {
      await upsertPurchase({
        listing_id,
        onchain_listing_id: onchain_listing_id ?? finalEscrowId,
        escrow_id: finalEscrowId,
        buyer_address,
        seller_address: dbRow.seller_pubkey || undefined,
        price: escrow.amount != null ? String(escrow.amount) : undefined,
        ipfs_cid: dbRow.ipfs_cid,
        source_hash: sourceHash,
        status: 'released',
        created_at: Date.now(),
      });
      await confirmPurchaseInDb(finalEscrowId);
    } catch (dbErr: any) {
      console.warn('POST /confirm DB update failed (non-fatal):', dbErr.message);
    }

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
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/refund — records refund in DB
router.post('/refund', async (req: Request, res: Response) => {
  try {
    const { listing_id, buyer_address, escrow_id } = req.body;

    if (!listing_id || !buyer_address || !escrow_id) {
      return res.status(400).json({
        error: 'listing_id, buyer_address, and escrow_id are required',
      });
    }

    try {
      await refundPurchaseInDb(String(escrow_id));
    } catch (dbErr: any) {
      console.warn('POST /refund DB update failed (non-fatal):', dbErr.message);
    }

    return res.json({
      escrow_id: String(escrow_id),
      status: 'refunded',
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;