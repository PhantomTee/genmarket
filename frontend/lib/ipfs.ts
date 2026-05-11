const GATEWAY = 'https://gateway.pinata.cloud/ipfs';

// Fetch raw text content from IPFS via the Pinata public gateway.
// Used by the buyer after receiving the decryption key — fetches the
// encrypted source blob, then decryptToBuffer() handles the rest in-browser.
export async function fetchFromIPFS(cid: string): Promise<string> {
  const res = await fetch(`${GATEWAY}/${cid}`);
  if (!res.ok) {
    throw new Error(`IPFS fetch failed for CID ${cid}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}
