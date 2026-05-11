import { NextRequest, NextResponse } from 'next/server';

// Proxy to backend so the frontend never exposes GENLAYER_RPC_URL directly
export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get('address');
  if (!address) return NextResponse.json({ error: 'address is required' }, { status: 400 });

  const backendUrl = process.env.BACKEND_URL ?? 'http://localhost:4000';
  const res = await fetch(`${backendUrl}/api/listings/abi?address=${encodeURIComponent(address)}`);
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
