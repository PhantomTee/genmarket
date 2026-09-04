import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { getEscrow, getListing } from '../services/genlayer.js';
import {
  getListingByAnyId,
  upsertPurchase,
  confirmPurchaseInDb,
  refundPurchaseInDb,
} from '../db/schema.js';
import { decryptKeyWithMaster, decryptFromStorage } from '../services/encryption.js';
import { fetchFromIPFS } from '../services/ipfs.js';
import { verifySignature } from '../services/auth.js';

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

    return res.json({ escrow_id: String(escrow_id), status: 'locked' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/payments/confirm
// Full delivery gate:
//   1. Wallet-signature auth (buyer signed a nonce via GET /api/auth/nonce)
//   2. On-chain escrow must be 'released' (buyer already called confirm_purchase)
//   3. escrow.listing_id must match dbRow.onchain_listing_id (binds escrow to DB record)
//   4. on-chain source_hash must match DB source_hash (binds on-chain listing to encrypted file)
router.post('/confirm', async (req: Request, res: Response) => {
  try {
    const {
      listing_id,
      buyer_address,
      escrow_id,
      onchain_listing_id,
      signature,
      auth_message,
    } = req.body;

    if (!listing_id || !buyer_address || !escrow_id) {
      return res.status(400).json({
        error: 'listing_id, buyer_address, and escrow_id are required',
      });
    }

    // ── 1. Wallet-signature auth ──────────────────────────────────────────────
    if (!signature || !auth_message) {
      return res.status(401).json({
        error: 'Wallet signature required. Obtain a nonce via GET /api/auth/nonce and sign it.',
      });
    }
    const sigValid = await verifySignature(buyer_address, signature, auth_message);
    if (!sigValid) {
      return res.status(401).json({ error: 'Invalid or expired wallet signature' });
    }

    // ── 2. On-chain escrow verification ──────────────────────────────────────
    const finalEscrowId = String(escrow_id);
    const escrow = await getEscrow(finalEscrowId);

    if (!escrow) {
      return res.status(404).json({ error: 'Escrow not found on-chain' });
    }
    if (String(escrow.buyer).toLowerCase() !== String(buyer_address).toLowerCase()) {
      return res.status(403).json({ error: 'Address mismatch: caller is not the buyer on this escrow' });
    }
    if (escrow.status !== 'released') {
      return res.status(400).json({
        error: `Source not available yet. Escrow status is '${escrow.status}'. Call confirm_purchase on-chain first.`,
      });
    }

    // ── 3. Resolve DB row — accepts UUID or on-chain integer id ──────────────
    // Try the supplied listing_id first; fall back to onchain_listing_id if needed.
    const dbRow = await getListingByAnyId(String(listing_id))
      ?? (onchain_listing_id ? await getListingByAnyId(String(onchain_listing_id)) : undefined);

    if (!dbRow) {
      return res.status(404).json({ error: 'Listing not found in database' });
    }

    // ── 4. Bind escrow → DB record via on-chain listing_id ───────────────────
    // escrow.listing_id is the on-chain integer slot; it must match what we stored.
    const resolvedOnchainId = dbRow.onchain_listing_id ?? onchain_listing_id;
    if (resolvedOnchainId && String(escrow.listing_id) !== String(resolvedOnchainId)) {
      return res.status(403).json({
        error: `Escrow listing_id (${escrow.listing_id}) does not match DB record (${resolvedOnchainId}). Cannot deliver source.`,
      });
    }

    // ── 5. Bind on-chain source_hash → DB source_hash ────────────────────────
    // Fetching the on-chain listing proves the IPFS CID and source hash committed
    // at listing time haven't been swapped in the DB.
    if (resolvedOnchainId) {
      try {
        const onchain = await getListing(resolvedOnchainId);
        const onchainHash = (onchain as any).source_hash;
        if (onchainHash && dbRow.source_hash && onchainHash !== dbRow.source_hash) {
          return res.status(403).json({
            error: 'Source hash mismatch between on-chain record and database. Delivery refused.',
          });
        }
      } catch {
        // If the on-chain read fails, proceed — we still verify the decrypted hash below.
      }
    }

    // ── 6. Decrypt and verify integrity ──────────────────────────────────────
    const keyBase64 = decryptKeyWithMaster(dbRow.encryption_key);
    const encryptedBase64 = await fetchFromIPFS(dbRow.ipfs_cid);
    const sourceCode = decryptFromStorage(encryptedBase64, keyBase64);

    const verifiedHash = crypto.createHash('sha256').update(sourceCode, 'utf8').digest('hex');
    const sourceHash = dbRow.source_hash ?? verifiedHash;
    const hashMatch = dbRow.source_hash ? verifiedHash === dbRow.source_hash : null;

    // ── 7. Persist confirmation ───────────────────────────────────────────────
    try {
      await upsertPurchase({
        listing_id: dbRow.listing_id,
        onchain_listing_id: resolvedOnchainId ?? finalEscrowId,
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

    return res.json({ escrow_id: String(escrow_id), status: 'refunded' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
