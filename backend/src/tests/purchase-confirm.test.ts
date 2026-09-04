/**
 * End-to-end tests for POST /api/payments/confirm
 *
 * All external services (GenLayer, IPFS, DB, encryption, auth) are mocked
 * so tests run without network or database access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock all external modules before importing the route ─────────────────────

vi.mock('../services/genlayer.js', () => ({
  getEscrow: vi.fn(),
  getListing: vi.fn(),
}));

vi.mock('../db/schema.js', () => ({
  getListingByAnyId: vi.fn(),
  upsertPurchase: vi.fn(),
  confirmPurchaseInDb: vi.fn(),
  refundPurchaseInDb: vi.fn(),
}));

vi.mock('../services/encryption.js', () => ({
  decryptKeyWithMaster: vi.fn(),
  decryptFromStorage: vi.fn(),
}));

vi.mock('../services/ipfs.js', () => ({
  fetchFromIPFS: vi.fn(),
}));

vi.mock('../services/auth.js', () => ({
  verifySignature: vi.fn(),
  buildMessage: vi.fn(),
  generateNonce: vi.fn(),
}));

// ── Import mocked modules so tests can control return values ─────────────────

import * as genlayer from '../services/genlayer.js';
import * as schema from '../db/schema.js';
import * as encryption from '../services/encryption.js';
import * as ipfs from '../services/ipfs.js';
import * as auth from '../services/auth.js';
import paymentsRouter from '../routes/payments.js';

// ── Test app ─────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/payments', paymentsRouter);
  return app;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const BUYER = '0xBuyer000000000000000000000000000000000001';
const SELLER = '0xSeller00000000000000000000000000000000001';
const UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const ONCHAIN_ID = '3';
const ESCROW_ID = ONCHAIN_ID;
const SOURCE = 'class MyContract(IContract):\n  pass\n';
const SOURCE_HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'; // sha256 placeholder
const IPFS_CID = 'QmTestCid';
const ENCRYPTED = 'encryptedBase64Data';
const KEY_B64 = 'keyBase64';

const validDbRow = {
  listing_id: UUID,
  ipfs_cid: IPFS_CID,
  seller_pubkey: SELLER,
  encryption_key: 'wrappedKey',
  created_at: Date.now(),
  onchain_listing_id: ONCHAIN_ID,
  source_hash: SOURCE_HASH,
};

const releasedEscrow = {
  id: ESCROW_ID,
  buyer: BUYER,
  listing_id: ONCHAIN_ID,
  amount: 1_000_000_000_000_000_000,
  status: 'released' as const,
};

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    listing_id: UUID,
    buyer_address: BUYER,
    escrow_id: ESCROW_ID,
    onchain_listing_id: ONCHAIN_ID,
    signature: '0xsig',
    auth_message: 'GenMarket: confirm-purchase\nAddress: ...\nNonce: abc',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/payments/confirm', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
    vi.resetAllMocks();

    // Happy-path defaults
    vi.mocked(auth.verifySignature).mockResolvedValue(true);
    vi.mocked(genlayer.getEscrow).mockResolvedValue(releasedEscrow);
    vi.mocked(genlayer.getListing).mockResolvedValue({
      id: ONCHAIN_ID,
      seller: SELLER,
      title: 'Test',
      description: '',
      price: 1,
      category: 'DeFi',
      demo_contract_address: '',
      ipfs_cid: IPFS_CID,
      status: 'active',
      source_hash: SOURCE_HASH,
    } as any);
    vi.mocked(schema.getListingByAnyId).mockResolvedValue(validDbRow as any);
    vi.mocked(ipfs.fetchFromIPFS).mockResolvedValue(ENCRYPTED);
    vi.mocked(encryption.decryptKeyWithMaster).mockReturnValue(KEY_B64);
    vi.mocked(encryption.decryptFromStorage).mockReturnValue(SOURCE);
    vi.mocked(schema.upsertPurchase).mockResolvedValue(undefined);
    vi.mocked(schema.confirmPurchaseInDb).mockResolvedValue(undefined);
  });

  it('delivers source on valid request', async () => {
    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.sourceCode).toBe(SOURCE);
    expect(res.body.escrow_id).toBe(ESCROW_ID);
    expect(res.body.ipfs_cid).toBe(IPFS_CID);
    expect(typeof res.body.verifiedHash).toBe('string');
    expect(res.body.verifiedHash).toHaveLength(64); // sha256 hex
  });

  it('returns 401 when signature is missing', async () => {
    const res = await request(app)
      .post('/api/payments/confirm')
      .send(validBody({ signature: undefined, auth_message: undefined }));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/signature required/i);
  });

  it('returns 401 when signature is invalid', async () => {
    vi.mocked(auth.verifySignature).mockResolvedValue(false);

    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid or expired/i);
  });

  it('returns 404 when escrow is not found on-chain', async () => {
    vi.mocked(genlayer.getEscrow).mockResolvedValue(null as any);

    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/escrow not found/i);
  });

  it('returns 403 when escrow buyer does not match caller', async () => {
    vi.mocked(genlayer.getEscrow).mockResolvedValue({
      ...releasedEscrow,
      buyer: '0xSomeoneElse',
    });

    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/address mismatch/i);
  });

  it('returns 400 when escrow is not yet released', async () => {
    vi.mocked(genlayer.getEscrow).mockResolvedValue({ ...releasedEscrow, status: 'locked' });

    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locked/i);
  });

  it('returns 403 when escrow listing_id does not match DB onchain_listing_id', async () => {
    vi.mocked(genlayer.getEscrow).mockResolvedValue({
      ...releasedEscrow,
      listing_id: '99', // different from ONCHAIN_ID = '3'
    });

    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/escrow listing_id/i);
  });

  it('returns 403 when on-chain source_hash differs from DB source_hash', async () => {
    vi.mocked(genlayer.getListing).mockResolvedValue({
      id: ONCHAIN_ID,
      seller: SELLER,
      title: 'Test',
      description: '',
      price: 1,
      category: 'DeFi',
      demo_contract_address: '',
      ipfs_cid: IPFS_CID,
      status: 'active',
      source_hash: 'deadbeef000000000000000000000000deadbeef000000000000000000000000',
    } as any);

    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/source hash mismatch/i);
  });

  it('returns 404 when listing not found in DB', async () => {
    vi.mocked(schema.getListingByAnyId).mockResolvedValue(undefined);

    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/listing not found/i);
  });

  it('resolves listing by onchain_listing_id when UUID lookup fails', async () => {
    // First call (UUID) returns nothing; second call (onchain_id) returns the row
    vi.mocked(schema.getListingByAnyId)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(validDbRow as any);

    const res = await request(app).post('/api/payments/confirm').send(validBody());

    expect(res.status).toBe(200);
    expect(res.body.sourceCode).toBe(SOURCE);
  });

  it('records the purchase in DB on success', async () => {
    await request(app).post('/api/payments/confirm').send(validBody());

    expect(schema.upsertPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        escrow_id: ESCROW_ID,
        buyer_address: BUYER,
        status: 'released',
      })
    );
    expect(schema.confirmPurchaseInDb).toHaveBeenCalledWith(ESCROW_ID);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/payments/confirm')
      .send({ buyer_address: BUYER });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });
});
