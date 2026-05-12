'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import WalletConnect from '../../components/WalletConnect';
import { useWallet } from '../../lib/wallet-context';
import { getListingsBySeller, removeListing, refund, Listing } from '../../lib/genlayer';
import { formatGEN } from '../../lib/encryption';
import { fetchFromIPFS } from '../../lib/ipfs';
import { decryptToBuffer } from '../../lib/encryption';
import { useToast } from '../../components/Toast';

type Tab = 'selling' | 'buying';

interface Purchase {
  listing_id: string;
  title: string;
  price: number;
  ipfs_cid: string;
  escrow_id?: string;
  encryption_key_base64?: string;
}

export default function DashboardPage() {
  const { address, writeClient } = useWallet();
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('selling');

  // Selling
  const [listings, setListings] = useState<Listing[]>([]);
  const [loadingListings, setLoadingListings] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Buying
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [refundingId, setRefundingId] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    setLoadingListings(true);
    getListingsBySeller(address)
      .then(setListings)
      .catch(() => setListings([]))
      .finally(() => setLoadingListings(false));

    // Load purchase history from localStorage (persists across sessions)
    try {
      const raw = localStorage.getItem('purchases');
      if (raw) { const p = JSON.parse(raw); setPurchases(Array.isArray(p) ? p : []); }
    } catch { /* ignore */ }
  }, [address]);

  async function handleRemove(listingId: string) {
    if (!writeClient) return;
    setRemovingId(listingId);
    try {
      await removeListing(writeClient, listingId);
      setListings((prev) => prev.map((l) => l.id === listingId ? { ...l, status: 'removed' } : l));
      showToast('Listing removed.', 'success');
    } catch (e: any) {
      showToast(e.message ?? 'Failed to remove listing.', 'error');
    } finally {
      setRemovingId(null);
    }
  }

  async function handleDownload(purchase: Purchase) {
    if (!purchase.encryption_key_base64) return;
    setDownloadingId(purchase.listing_id);
    try {
      const encrypted = await fetchFromIPFS(purchase.ipfs_cid);
      const buffer = decryptToBuffer(encrypted, purchase.encryption_key_base64);
      const arrayBuffer = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
      ) as ArrayBuffer;
      const blob = new Blob([arrayBuffer], { type: 'text/x-python' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `listing-${purchase.listing_id}.py`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Download started.', 'success');
    } catch (e: any) {
      showToast(e.message ?? 'Download failed.', 'error');
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleRefund(purchase: Purchase) {
    if (!writeClient || !purchase.escrow_id) return;
    setRefundingId(purchase.listing_id);
    try {
      await refund(writeClient, purchase.escrow_id);
      // Remove from purchases list since escrow is now refunded
      const updated = (Array.isArray(purchases) ? purchases : []).filter((p) => p.listing_id !== purchase.listing_id);
      setPurchases(updated);
      try { localStorage.setItem('purchases', JSON.stringify(updated)); } catch { /* ignore */ }
      showToast('Refund processed.', 'success');
    } catch (e: any) {
      showToast(e.message ?? 'Refund failed.', 'error');
    } finally {
      setRefundingId(null);
    }
  }

  const totalEarnings = (Array.isArray(listings) ? listings : [])
    .filter((l) => l.status === 'sold')
    .reduce((sum, l) => sum + l.price, 0);

  if (!address) {
    return (
      <div className="min-h-screen flex flex-col">
        <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200">
          <Link href="/" className="text-xl font-bold">GenMarket<span className="text-neutral-400">.</span></Link>
          <WalletConnect />
        </nav>
        <div className="flex-1 flex items-center justify-center flex-col gap-4">
          <p className="text-neutral-500 text-sm">Connect your wallet to view your dashboard.</p>
          <WalletConnect />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200">
        <Link href="/" className="text-xl font-bold">GenMarket<span className="text-neutral-400">.</span></Link>
        <div className="flex items-center gap-4">
          <Link href="/sell" className="hidden sm:block text-sm text-neutral-500 hover:text-neutral-900 transition-colors">+ New listing</Link>
          <WalletConnect />
        </div>
      </nav>

      <main className="flex-1 px-6 md:px-12 py-10 max-w-5xl mx-auto w-full">
        <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

        {/* Tabs */}
        <div className="flex gap-1 bg-neutral-100 p-1 rounded-xl w-fit mb-8">
          {(['selling', 'buying'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 text-sm font-medium rounded-lg transition-colors capitalize ${
                tab === t ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-900'
              }`}>
              {t}
            </button>
          ))}
        </div>

        {/* Selling tab */}
        {tab === 'selling' && (
          <div className="flex flex-col gap-6">
            {(Array.isArray(listings) ? listings : []).filter((l) => l.status === 'sold').length > 0 && (
              <div className="bg-white border border-neutral-200 rounded-2xl p-5 flex items-center justify-between">
                <div>
                  <p className="text-xs text-neutral-400 mb-1">Total earnings</p>
                  <p className="text-2xl font-bold text-neutral-900">{formatGEN(totalEarnings)}</p>
                </div>
                <span className="text-3xl">💰</span>
              </div>
            )}

            {loadingListings ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 bg-neutral-100 rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : listings.length === 0 ? (
              <div className="text-center py-16 text-neutral-400">
                <p className="mb-3 text-4xl">·</p>
                <p className="text-sm mb-4">You haven&apos;t listed any contracts yet.</p>
                <Link href="/sell" className="text-sm bg-neutral-900 text-[#F7F4EF] px-5 py-2.5 rounded-full hover:bg-neutral-700 transition-colors">
                  Create your first listing
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {listings.map((l) => (
                  <div key={l.id} className="bg-white border border-neutral-200 rounded-2xl p-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <Link href={`/listing/${l.id}`} className="font-medium text-neutral-900 hover:underline line-clamp-1">
                        {l.title}
                      </Link>
                      <p className="text-xs text-neutral-400 mt-0.5">{l.category} · {formatGEN(l.price)}</p>
                    </div>
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                      l.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                      l.status === 'sold' ? 'bg-blue-100 text-blue-700' :
                      l.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                      'bg-neutral-100 text-neutral-500'
                    }`}>
                      {l.status}
                    </span>
                    {l.status === 'active' && writeClient && (
                      <button
                        onClick={() => handleRemove(l.id)}
                        disabled={removingId === l.id}
                        className="text-xs text-red-500 hover:text-red-700 transition-colors disabled:opacity-50"
                      >
                        {removingId === l.id ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Buying tab */}
        {tab === 'buying' && (
          <div className="flex flex-col gap-3">
            {purchases.length === 0 ? (
              <div className="text-center py-16 text-neutral-400">
                <p className="mb-3 text-4xl">·</p>
                <p className="text-sm mb-4">No purchases yet.</p>
                <Link href="/browse" className="text-sm bg-neutral-900 text-[#F7F4EF] px-5 py-2.5 rounded-full hover:bg-neutral-700 transition-colors">
                  Browse contracts
                </Link>
              </div>
            ) : (
              purchases.map((p) => (
                <div key={p.listing_id} className="bg-white border border-neutral-200 rounded-2xl p-4 flex items-center gap-3 flex-wrap sm:flex-nowrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-neutral-900 line-clamp-1">{p.title}</p>
                    <p className="text-xs text-neutral-400 mt-0.5">{formatGEN(p.price)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {p.encryption_key_base64 ? (
                      <button
                        onClick={() => handleDownload(p)}
                        disabled={downloadingId === p.listing_id}
                        className="text-xs bg-neutral-900 text-[#F7F4EF] px-3 py-1.5 rounded-lg hover:bg-neutral-700 transition-colors disabled:opacity-50"
                      >
                        {downloadingId === p.listing_id ? 'Decrypting…' : 'Download source'}
                      </button>
                    ) : (
                      <span className="text-xs text-neutral-400">Key pending</span>
                    )}
                    {p.escrow_id && writeClient && (
                      <button
                        onClick={() => handleRefund(p)}
                        disabled={refundingId === p.listing_id}
                        className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                      >
                        {refundingId === p.listing_id ? 'Refunding…' : 'Refund'}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  );
}
