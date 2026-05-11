import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

function getMasterKey(): Uint8Array {
  const raw = process.env.ENCRYPTION_MASTER_KEY;
  if (!raw) throw new Error('ENCRYPTION_MASTER_KEY is not set');
  const key = decodeBase64(raw);
  if (key.length !== nacl.secretbox.keyLength) {
    throw new Error(
      `ENCRYPTION_MASTER_KEY must decode to exactly ${nacl.secretbox.keyLength} bytes`
    );
  }
  return key;
}

function sealWithKey(plaintext: Uint8Array, key: Uint8Array): string {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(plaintext, nonce, key);
  const combined = new Uint8Array(nonce.length + box.length);
  combined.set(nonce);
  combined.set(box, nonce.length);
  return encodeBase64(combined);
}

function openWithKey(encryptedBase64: string, key: Uint8Array): Uint8Array {
  const combined = decodeBase64(encryptedBase64);
  const nonce = combined.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = combined.slice(nacl.secretbox.nonceLength);
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('Decryption failed: invalid key or corrupted ciphertext');
  return plaintext;
}

export function encryptForStorage(plaintext: string): {
  encryptedBase64: string;
  keyBase64: string;
} {
  const key = nacl.randomBytes(nacl.secretbox.keyLength);
  const encryptedBase64 = sealWithKey(encodeUTF8(plaintext), key);
  return { encryptedBase64, keyBase64: encodeBase64(key) };
}

export function decryptFromStorage(encryptedBase64: string, keyBase64: string): string {
  const key = decodeBase64(keyBase64);
  return decodeUTF8(openWithKey(encryptedBase64, key));
}

export function encryptKeyWithMaster(keyBase64: string): string {
  return sealWithKey(encodeUTF8(keyBase64), getMasterKey());
}

export function decryptKeyWithMaster(encryptedKey: string): string {
  return decodeUTF8(openWithKey(encryptedKey, getMasterKey()));
}
