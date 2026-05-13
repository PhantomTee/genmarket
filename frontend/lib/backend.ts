export function getBackendUrl(): string {
  const url = process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL;

  if (!url) {
    throw new Error('Backend URL is not configured. Set NEXT_PUBLIC_BACKEND_URL.');
  }

  return url.replace(/\/$/, '');
}

export async function fetchJson<T>(path: string): Promise<T> {
  const backendUrl = getBackendUrl();

  const res = await fetch(`${backendUrl}${path}`, {
    cache: 'no-store',
  });

  const text = await res.text();

  let data: any;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Backend returned non-JSON: ${text.slice(0, 250)}`);
  }

  if (!res.ok) {
    throw new Error(data?.error || data?.message || `Request failed with ${res.status}`);
  }

  return data as T;
}
