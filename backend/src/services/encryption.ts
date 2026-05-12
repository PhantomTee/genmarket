import crypto from 'crypto';
import nacl from 'tweetnacl';

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

// Output format: base64(iv[12] + authTag[16] + ciphertext)
export function encryptString(plainText: string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

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

// Aliases used by route files
export const encryptKeyWithMaster = encryptString;
export const decryptKeyWithMaster = decryptString;

export function generateEncryptionKeyBase64(): string {
  return crypto.randomBytes(32).toString('base64');
}

// ── Per-listing encryption (NaCl secretbox) ───────────────────────────────────
// Must stay tweetnacl-compatible: frontend encrypts with tweetnacl, backend
// decrypts here (judge.ts). Uses Buffer instead of tweetnacl-util to avoid
// the CJS named-export issue in ESM mode.

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64encode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function b64decode(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

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
  return { encryptedBase64: b64encode(combined), keyBase64: b64encode(key) };
}

export function decryptFromStorage(encryptedBase64: string, keyBase64: string): string {
  const key = b64decode(keyBase64);
  const combined = b64decode(encryptedBase64);
  const nonce = combined.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = combined.slice(nacl.secretbox.nonceLength);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('Decryption failed: invalid key or corrupted ciphertext');
  return dec.decode(plaintext);
}
