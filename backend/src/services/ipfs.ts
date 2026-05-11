import axios from 'axios';
import FormData from 'form-data';

const PINATA_BASE = 'https://api.pinata.cloud';
const GATEWAY_BASE = 'https://gateway.pinata.cloud/ipfs';

function getHeaders() {
  const apiKey = process.env.PINATA_API_KEY;
  const secret = process.env.PINATA_SECRET_API_KEY;
  if (!apiKey || !secret) throw new Error('Pinata credentials are not set in env');
  return { pinata_api_key: apiKey, pinata_secret_api_key: secret };
}

export async function pinContent(content: string, name: string): Promise<string> {
  const form = new FormData();
  form.append('file', Buffer.from(content, 'utf-8'), {
    filename: name,
    contentType: 'text/plain',
  });
  form.append(
    'pinataMetadata',
    JSON.stringify({ name }),
    { contentType: 'application/json' }
  );

  const response = await axios.post<{ IpfsHash: string }>(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    form,
    { headers: { ...getHeaders(), ...form.getHeaders() } }
  );
  return response.data.IpfsHash;
}

export async function fetchContent(cid: string): Promise<string> {
  const response = await axios.get<string>(`${GATEWAY_BASE}/${cid}`, {
    responseType: 'text',
    timeout: 15_000,
  });
  return response.data;
}
