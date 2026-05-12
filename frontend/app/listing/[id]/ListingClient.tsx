'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Link from 'next/link';
import WalletConnect from '../../../components/WalletConnect';
import ContractPlayground from '../../../components/ContractPlayground';
import VerdictCard, { Verdict } from '../../../components/VerdictCard';
import PaymentModal from '../../../components/PaymentModal';
import { Listing } from '../../../lib/genlayer';
import { formatGEN } from '../../../lib/encryption';

interface Props {
  id: string;
}

export default function ListingClient({ id }: Props) {
  const playgroundRef = useRef<HTMLDivElement>(null);

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [requirement, setRequirement] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);

  const [showPayment, setShowPayment] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchListing = useCallback(() => {
    fetch(`/api/listings/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setListing(data);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [id]);

  // Initial load
  useEffect(() => { fetchListing(); }, [fetchListing]);

  // Auto-refresh: every 30 s while tab is visible
  useEffect(() => {
    const interval = setInterval(() => {
      if (!document.hidden) fetchListing();
    }, 30_000);
    const onVisible = () => { if (!document.hidden) fetchListing(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fetchListing]);

  async function handleEvaluate() {
    if (!requirement.trim() || !listing) return;
    setEvaluating(true);
    setVerdict(null);
    setJudgeError(null);
    try {
      const res = await fetch('/api/judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: id, buyer_requirement: requirement }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Evaluation failed');
      setVerdict(data.verdict);
    } catch (e: any) {
      setJudgeError(e.message);
    } finally {
      setEvaluating(false);
    }
  }

  function scrollToPlayground() {
    playgroundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function copyAddress(addr: string) {
    navigator.clipboard.writeText(addr);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-neutral-500">{error ?? 'Listing not found.'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200 sticky top-0 bg-[#F7F4EF] z-10">
        <Link href="/" className="text-xl font-bold tracking-tight text-neutral-900">
          GenMarket<span className="text-neutral-400">.</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/browse" className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors">← Browse</Link>
          <WalletConnect />
        </div>
      </nav>

      <main className="flex-1 px-6 md:px-12 py-10 max-w-7xl mx-auto w-full">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-medium bg-neutral-100 text-neutral-600 px-2.5 py-1 rounded-full">
              {listing.category}
            </span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              listing.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-neutral-100 text-neutral-500'
            }`}>
              {listing.status}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-neutral-900 leading-tight mb-2">
            {listing.title}
          </h1>
          <p className="text-neutral-500 text-base max-w-2xl">{listing.description}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8" ref={playgroundRef}>
          {/* Path A */}
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-neutral-900">Path A: Try it yourself</h2>
              <span className="text-xs text-neutral-400">Live contract</span>
            </div>
            <div className="bg-white border border-neutral-200 rounded-2xl p-4">
              <p className="text-xs text-neutral-400 mb-2 font-medium uppercase tracking-wide">Demo contract</p>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-neutral-700 flex-1 break-all">
                  {listing.demo_contract_address}
                </span>
                <button
                  onClick={() => copyAddress(listing.demo_contract_address)}
                  className="shrink-0 text-xs text-neutral-400 hover:text-neutral-900 bg-neutral-50 border border-neutral-200 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
            <ContractPlayground contractAddress={listing.demo_contract_address} />
            <button
              onClick={() => setShowPayment(true)}
              className="w-full bg-neutral-900 text-[#F7F4EF] font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors"
            >
              Buy this code · {formatGEN(listing.price)}
            </button>
          </div>

          {/* Path B */}
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-neutral-900">Path B: Ask GenLayer</h2>
              <span className="text-xs text-neutral-400 bg-purple-50 border border-purple-200 text-purple-600 px-2 py-1 rounded-full">AI Evaluation</span>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm text-neutral-600 font-medium">
                Describe what you need this contract to do
              </label>
              <textarea
                value={requirement}
                onChange={(e) => setRequirement(e.target.value)}
                rows={4}
                placeholder="e.g. I need a contract that lets users stake tokens and earn rewards proportional to their stake duration…"
                className="border border-neutral-200 bg-white rounded-xl px-4 py-3 text-sm text-neutral-900 resize-none focus:outline-none focus:border-neutral-900 transition-colors"
              />
              <button
                onClick={handleEvaluate}
                disabled={evaluating || !requirement.trim()}
                className="bg-neutral-900 text-[#F7F4EF] font-semibold py-3 rounded-xl hover:bg-neutral-700 transition-colors disabled:opacity-50 text-sm"
              >
                {evaluating ? 'GenLayer is thinking…' : 'Evaluate with AI'}
              </button>
            </div>
            {judgeError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{judgeError}</p>
            )}
            <VerdictCard verdict={verdict} loading={evaluating} />
            {verdict && (
              <button
                onClick={scrollToPlayground}
                className="text-sm text-neutral-400 hover:text-neutral-900 transition-colors text-left"
              >
                Still want to test it yourself? ↑ Try the live demo
              </button>
            )}
            <button
              onClick={() => setShowPayment(true)}
              className="w-full bg-white border border-neutral-200 text-neutral-900 font-semibold py-3.5 rounded-2xl hover:border-neutral-400 transition-colors"
            >
              Buy this code · {formatGEN(listing.price)}
            </button>
          </div>
        </div>
      </main>

      {showPayment && (
        <PaymentModal
          listingId={listing.id}
          price={listing.price}
          ipfsCid={listing.ipfs_cid}
          listingTitle={listing.title}
          onClose={() => setShowPayment(false)}
        />
      )}
    </div>
  );
}
