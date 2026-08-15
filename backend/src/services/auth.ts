import crypto from 'crypto';
import { recoverMessageAddress } from 'viem';

interface NonceEntry {
  nonce: string;
  expires: number;
}

// In-process nonce store (per-address, one active nonce at a time)
const nonceStore = new Map<string, NonceEntry>();

export function generateNonce(address: string): string {
  const nonce = crypto.randomBytes(16).toString('hex');
  nonceStore.set(address.toLowerCase(), { nonce, expires: Date.now() + 5 * 60 * 1000 });
  return nonce;
}

export function buildMessage(address: string, nonce: string, action: string): string {
  return `GenMarket: ${action}\nAddress: ${address}\nNonce: ${nonce}\n\nThis signature expires in 5 minutes.`;
}

export async function verifySignature(
  address: string,
  signature: string,
  message: string
): Promise<boolean> {
  try {
    const stored = nonceStore.get(address.toLowerCase());
    if (!stored || Date.now() > stored.expires) return false;
    if (!message.includes(stored.nonce)) return false;
    const recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
    if (recovered.toLowerCase() !== address.toLowerCase()) return false;
    nonceStore.delete(address.toLowerCase()); // one-time use
    return true;
  } catch {
    return false;
  }
}
