'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Navbar from '../../components/Navbar';

interface RecentPurchase {
  purchase_id: string;
  listing_id: string;
  onchain_listing_id: string | null;
  escrow_id: string;
  buyer_address: string;
  seller_address: string | null;
  price: string | null;
  ipfs_cid: string | null;
  source_hash: string | null;
  status: string;
  created_at: number;
  confirmed_at: number | null;
}

function shortAddr(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ms: number | null) {
  if (!ms) return '—';
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatGEN(priceWei: string | null) {
  if (!priceWei) return '—';
  try {
    const gen = Number(BigInt(priceWei)) / 1e18;
    return `${gen.toFixed(gen < 1 ? 4 : 2)} GEN`;
  } catch {
    return priceWei;
  }
}

export default function RecentPurchasesPage() {
  const [purchases, setPurchases] = useState<RecentPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) { setError('Backend URL not configured'); setLoading(false); return; }

    fetch(`${backendUrl}/api/purchases/recent`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPurchases(data);
        else setError('Unexpected response from server');
      })
      .catch(() => setError('Failed to load recent purchases'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F4EF] dark:bg-neutral-950">
      <Navbar />

      <main className="flex-1 px-6 md:px-12 py-10 max-w-5xl mx-auto w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100">Recent Purchases</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Last 15 confirmed on-chain purchases across the marketplace
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-neutral-200 dark:bg-neutral-800 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-24 text-neutral-400 dark:text-neutral-500">
            <p className="text-4xl mb-3">⚠</p>
            <p className="text-sm">{error}</p>
          </div>
        ) : purchases.length === 0 ? (
          <div className="text-center py-24 text-neutral-400 dark:text-neutral-500">
            <p className="text-4xl mb-3">·</p>
            <p className="text-sm">No confirmed purchases yet.</p>
            <Link href="/browse" className="mt-4 inline-block text-sm text-neutral-900 dark:text-neutral-100 underline underline-offset-2">Browse listings</Link>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_1.5fr_1.5fr_1fr_1fr] gap-4 px-5 py-3 border-b border-neutral-100 dark:border-neutral-800 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
              <span>Listing</span>
              <span>Buyer</span>
              <span>Seller</span>
              <span>Price</span>
              <span className="text-right">Confirmed</span>
            </div>

            {/* Rows */}
            {purchases.map((p, idx) => {
              const listingHref = p.onchain_listing_id
                ? `/listing/${p.onchain_listing_id}`
                : `/listing/${p.listing_id}`;

              return (
                <div
                  key={p.purchase_id}
                  className={`grid grid-cols-[2fr_1.5fr_1.5fr_1fr_1fr] gap-4 px-5 py-4 items-center text-sm transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${
                    idx < purchases.length - 1 ? 'border-b border-neutral-100 dark:border-neutral-800' : ''
                  }`}
                >
                  {/* Listing */}
                  <div className="min-w-0">
                    <Link
                      href={listingHref}
                      className="font-medium text-neutral-900 dark:text-neutral-100 hover:underline truncate block"
                    >
                      Listing #{p.onchain_listing_id ?? p.escrow_id}
                    </Link>
                    {p.source_hash && (
                      <span className="text-xs text-neutral-400 dark:text-neutral-500 font-mono truncate block">
                        {p.source_hash.slice(0, 16)}…
                      </span>
                    )}
                  </div>

                  {/* Buyer */}
                  <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400 truncate" title={p.buyer_address}>
                    {shortAddr(p.buyer_address)}
                  </span>

                  {/* Seller */}
                  <span className="font-mono text-xs text-neutral-500 dark:text-neutral-400 truncate" title={p.seller_address ?? ''}>
                    {p.seller_address ? shortAddr(p.seller_address) : '—'}
                  </span>

                  {/* Price */}
                  <span className="font-medium text-neutral-900 dark:text-neutral-100 tabular-nums">
                    {formatGEN(p.price)}
                  </span>

                  {/* Time */}
                  <span className="text-right text-xs text-neutral-400 dark:text-neutral-500 tabular-nums">
                    {timeAgo(p.confirmed_at)}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Live indicator */}
        {!loading && !error && purchases.length > 0 && (
          <p className="mt-4 text-xs text-neutral-400 dark:text-neutral-500 text-center">
            Showing {purchases.length} most recent confirmed purchases
            {' · '}
            <button
              onClick={() => {
                setLoading(true);
                const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';
                fetch(`${backendUrl}/api/purchases/recent`)
                  .then((r) => r.json())
                  .then((data) => { if (Array.isArray(data)) setPurchases(data); })
                  .catch(() => {})
                  .finally(() => setLoading(false));
              }}
              className="underline underline-offset-2 hover:text-neutral-700 dark:hover:text-neutral-300 transition-colors"
            >
              Refresh
            </button>
          </p>
        )}
      </main>
    </div>
  );
}
