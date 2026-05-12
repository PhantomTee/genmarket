import crypto from 'crypto';
import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// ── Master key (AES-256-GCM) ─────────────────────────────────────────────────

function getMasterKey(): Buffer {
  const raw = process.env.MASTER_KEY;
  if (!raw) throw new Error('MASTER_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('MASTER_KEY must decode to exactly 32 bytes');
  return key;
}

// Encrypt an arbitrary string with the master key (AES-256-GCM).
// Output format: base64(iv[12] + authTag[16] + ciphertext)
export function encryptString(plainText: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

// Decrypt a base64 string produced by encryptString.
export function decryptString(encryptedBase64: string): string {
  const key = getMasterKey();
  const buf = Buffer.from(encryptedBase64, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// Aliases used by route files (listings, payments, judge)
export const encryptKeyWithMaster = encryptString;
export const decryptKeyWithMaster = decryptString;

// Generate a fresh 32-byte random key encoded as base64
export function generateEncryptionKeyBase64(): string {
  return crypto.randomBytes(32).toString('base64');
}

// ── Per-listing encryption (NaCl secretbox) ───────────────────────────────────
// Must stay tweetnacl-compatible: frontend encrypts with encryptFile() in
// frontend/lib/encryption.ts; backend decrypts here in judge.ts.

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encryptForStorage(plaintext: string): {
  encryptedBase64: string;
  keyBase64: string;
} {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(enc.encode(plaintext), nonce, key);
  const combined = new Uint8Array(nonce.length + box.length);
  combined.set(nonce);
  combined.set(box, nonce.length);
  return { encryptedBase64: encodeBase64(combined), keyBase64: encodeBase64(key) };
}

export function decryptFromStorage(encryptedBase64: string, keyBase64: string): string {
  const key = decodeBase64(keyBase64);
  const combined = decodeBase64(encryptedBase64);
  const nonce = combined.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = combined.slice(nacl.secretbox.nonceLength);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('Decryption failed: invalid key or corrupted ciphertext');
  return dec.decode(plaintext);
}
