import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64 } from 'tweetnacl-util';

// Encrypt a raw file buffer (Uint8Array) with a fresh random key.
// Returns both the base64-encoded ciphertext and the base64-encoded key.
// Called client-side during the /sell upload step — plaintext never leaves the browser.
export function encryptFile(fileBuffer: Uint8Array): {
  encryptedBase64: string;
  keyBase64: string;
} {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(fileBuffer, nonce, key);

  const combined = new Uint8Array(nonce.length + box.length);
  combined.set(nonce);
  combined.set(box, nonce.length);

  return {
    encryptedBase64: encodeBase64(combined),
    keyBase64: encodeBase64(key),
  };
}

// Decrypt a base64-encoded ciphertext back to a Uint8Array.
// Called client-side after the buyer receives the decryption key from the backend.
export function decryptToBuffer(encryptedBase64: string, keyBase64: string): Uint8Array {
  const key = decodeBase64(keyBase64);
  const combined = decodeBase64(encryptedBase64);
  const nonce = combined.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = combined.slice(nacl.secretbox.nonceLength);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('Decryption failed: invalid key or corrupted data');
  return plaintext;
}

// Generate a NaCl keypair for the seller's public key stored in the listing.
export function generateKeyPair(): { publicKeyBase64: string; secretKeyBase64: string } {
  const pair = nacl.box.keyPair();
  return {
    publicKeyBase64: encodeBase64(pair.publicKey),
    secretKeyBase64: encodeBase64(pair.secretKey),
  };
}

// Convenience: format wei as a human-readable GEN string
// 1 GEN = 10^18 wei
export function formatGEN(wei: bigint | number | string): string {
  const w = BigInt(wei);
  const whole = w / BigInt(1e18);
  const frac = w % BigInt(1e18);
  if (frac === 0n) return `${whole} GEN`;
  const fracStr = frac.toString().padStart(18, '0').replace(/0+$/, '').slice(0, 4);
  return `${whole}.${fracStr} GEN`;
}

// Parse a GEN string like "1.5" to wei bigint
export function parseGEN(gen: string): bigint {
  const [whole = '0', frac = '0'] = gen.split('.');
  const fracPadded = frac.padEnd(18, '0').slice(0, 18);
  return BigInt(whole) * BigInt(1e18) + BigInt(fracPadded);
}
