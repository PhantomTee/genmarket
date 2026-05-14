'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import WalletConnect from '../../components/WalletConnect';
import ListingCard from '../../components/ListingCard';
import { Listing } from '../../lib/genlayer';

const CATEGORIES = ['All', 'DeFi', 'NFT', 'DAO', 'Oracle', 'Identity', 'Utility'];

export default function BrowsePage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');

  useEffect(() => {
    const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
    if (!backendUrl) { setListings([]); setLoading(false); return; }

    fetch(`${backendUrl}/api/listings`)
      .then((r) => r.text())
      .then((text) => {
        let data: any;
        try { data = JSON.parse(text); } catch {
          console.error('Invalid listings response:', text.slice(0, 300));
          setListings([]); return;
        }
        if (Array.isArray(data)) setListings(data);
        else if (Array.isArray(data?.listings)) setListings(data.listings);
        else { console.error('Unexpected listings shape:', data); setListings([]); }
      })
      .catch((e) => { console.error('Failed to load listings:', e); setListings([]); })
      .finally(() => setLoading(false));
  }, []);

  const categoryCounts = useMemo(() => {
    const safe = Array.isArray(listings) ? listings : [];
    const counts: Record<string, number> = { All: safe.length };
    for (const l of safe) counts[l.category] = (counts[l.category] ?? 0) + 1;
    return counts;
  }, [listings]);

  const filtered = useMemo(() => {
    const safe = Array.isArray(listings) ? listings : [];
    return safe.filter((l) => {
      const matchesCategory = category === 'All' || l.category === category;
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        l.title.toLowerCase().includes(q) ||
        l.description.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [listings, search, category]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200 dark:border-neutral-700">
        <Link href="/" className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          GenMarket<span className="text-neutral-400 dark:text-neutral-500">.</span>
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="hidden sm:flex items-center gap-6">
            <Link href="/sell" className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors">Sell</Link>
            <Link href="/purchases" className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors">Recent</Link>
            <Link href="/dashboard" className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors">Dashboard</Link>
          </div>
          <WalletConnect />
        </div>
      </nav>

      <main className="flex-1 px-6 md:px-12 py-10 max-w-6xl mx-auto w-full">
        {/* Header + search */}
        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-8">
          <h1 className="text-3xl font-bold text-neutral-900 dark:text-neutral-100 flex-1">Browse contracts</h1>
          <input
            type="text"
            placeholder="Search by title or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 rounded-xl px-4 py-2.5 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 w-full md:w-72 focus:outline-none focus:border-neutral-900 dark:focus:border-neutral-400 transition-colors"
          />
        </div>

        {/* Category tabs */}
        <div className="flex flex-wrap gap-2 mb-8">
          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat] ?? 0;
            return (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`text-sm font-medium px-4 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                  category === cat
                    ? 'bg-neutral-900 text-[#F7F4EF] border-neutral-900 dark:bg-neutral-100 dark:text-neutral-900 dark:border-neutral-100'
                    : 'bg-white dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700 hover:border-neutral-400 dark:hover:border-neutral-500'
                }`}
              >
                {cat}
                {!loading && (
                  <span className="text-xs font-normal tabular-nums text-neutral-400 dark:text-neutral-500">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 rounded-2xl p-5 h-52 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-24 text-neutral-400 dark:text-neutral-500">
            <p className="text-4xl mb-3">·</p>
            <p className="text-sm">No listings found{search ? ` for "${search}"` : ''}.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
