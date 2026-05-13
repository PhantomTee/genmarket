'use client';

import { useEffect, useCallback, useState } from 'react';
import Link from 'next/link';
import WalletConnect from '../../../components/WalletConnect';
import VerdictCard, { Verdict } from '../../../components/VerdictCard';
import PaymentModal from '../../../components/PaymentModal';
import { Listing, evaluateWithJudge } from '../../../lib/genlayer';
import { useWallet } from '../../../lib/wallet-context';
import { formatGEN } from '../../../lib/encryption';

interface Props { id: string }

interface DemoSession {
  timestamp: number;
  method: string;
  success: boolean;
}

export default function ListingClient({ id }: Props) {
  const { writeClient, connect, connecting } = useWallet();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showJudge, setShowJudge] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);

  const [showPayment, setShowPayment] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const [demoSession, setDemoSession] = useState<DemoSession | null>(null);

  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

  const fetchListing = useCallback(() => {
    fetch(`${BACKEND}/api/listings/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setListing(data);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [id]);

  useEffect(() => { fetchListing(); }, [fetchListing]);

  useEffect(() => {
    const interval = setInterval(() => { if (!document.hidden) fetchListing(); }, 30_000);
    const onVisible = () => { if (!document.hidden) fetchListing(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [fetchListing]);

  // Read prior demo session from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`genmarket_demo_test_${id}`);
      if (raw) setDemoSession(JSON.parse(raw));
    } catch {}
  }, [id]);

  async function handleEvaluate() {
    if (!requirement.trim() || !listing) return;
    if (!writeClient) { await connect(); return; }
    setEvaluating(true);
    setVerdict(null);
    setJudgeError(null);
    try {
      const sourceCodePreview =
        (listing as any).preview_code ||
        (listing as any).visible_code_preview ||
        (listing as any).code_preview ||
        listing.description ||
        "";

      const result = await evaluateWithJudge(
        writeClient,
        sourceCodePreview,
        listing.description,
        requirement
      );
      setVerdict(result as Verdict);
    } catch (e: any) {
      setJudgeError(e.message);
    } finally {
      setEvaluating(false);
    }
  }

  function copyAddress(addr: string) {
    navigator.clipboard.writeText(addr);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1500);
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-neutral-300 dark:border-neutral-600 border-t-neutral-900 dark:border-t-neutral-100 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !listing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-neutral-500 dark:text-neutral-400">{error ?? 'Listing not found.'}</p>
      </div>
    );
  }

  const hasDemoContract = listing.demo_contract_address &&
    listing.demo_contract_address !== 'pending';

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F4EF] dark:bg-[#0c0c0c]">
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200 dark:border-neutral-700 sticky top-0 bg-[#F7F4EF] dark:bg-[#0c0c0c] z-10">
        <Link href="/" className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          GenMarket<span className="text-neutral-400 dark:text-neutral-500">.</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/browse" className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors">← Browse</Link>
          <WalletConnect />
        </div>
      </nav>

      <main className="flex-1 px-6 md:px-12 py-10 max-w-3xl mx-auto w-full">

        {/* Listing header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 px-2.5 py-1 rounded-full">
              {listing.category}
            </span>
            <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
              listing.status === 'active'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500 dark:text-neutral-400'
            }`}>
              {listing.status}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 dark:text-neutral-100 leading-tight mb-2">
            {listing.title}
          </h1>
          <p className="text-neutral-500 dark:text-neutral-400 text-base mb-4">{listing.description}</p>

          {/* Trust badges */}
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              ✓ GenVM Linted
            </span>
            {hasDemoContract ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                ⬡ Demo Available
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 rounded-full">
                No Demo
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-xs font-medium text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-full">
              ✦ AI Review
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-400 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 rounded-full">
              🔒 Source Encrypted
            </span>
          </div>
        </div>

        {/* Recent demo session banner */}
        {demoSession && (
          <div className={`mb-5 flex items-center gap-2 text-sm px-4 py-3 rounded-xl border ${
            demoSession.success
              ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
              : 'text-amber-700 bg-amber-50 border-amber-200'
          }`}>
            <span className="font-bold">{demoSession.success ? '✓' : '⚠'}</span>
            You tested this demo earlier this session.
            Last call: <span className="font-mono">{demoSession.method}()</span>
            — {demoSession.success ? 'success' : 'failed'}.
          </div>
        )}

        {/* Demo contract address pill */}
        {hasDemoContract && (
          <div className="mb-5 flex items-center gap-2 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl px-4 py-3 text-xs">
            <span className="text-neutral-400 dark:text-neutral-500 font-medium shrink-0">Demo contract</span>
            <span className="font-mono text-neutral-700 dark:text-neutral-300 flex-1 truncate">{listing.demo_contract_address}</span>
            <button
              onClick={() => copyAddress(listing.demo_contract_address)}
              className="shrink-0 text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              {copiedAddr ? 'Copied!' : 'Copy'}
            </button>
          </div>
        )}

        {/* Primary action: Try Demo Contract */}
        <div className="flex flex-col gap-3 mb-6">
          {hasDemoContract ? (
            <Link
              href={`/listing/${id}/interact`}
              className="w-full flex items-center justify-center gap-2 bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-4 rounded-2xl hover:bg-neutral-700 transition-colors text-sm"
            >
              Try Demo Contract →
            </Link>
          ) : (
            <div className="w-full text-center text-sm text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 py-4 rounded-2xl">
              No demo deployed by seller — review with AI or buy directly.
            </div>
          )}

          {/* Secondary actions */}
          <div className="flex gap-3">
            <button
              onClick={() => { setShowJudge((v) => !v); setVerdict(null); setJudgeError(null); }}
              className={`flex-1 text-sm font-medium py-3 rounded-2xl border transition-colors ${
                showJudge
                  ? 'bg-purple-50 border-purple-200 text-purple-800'
                  : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-500'
              }`}
            >
              {showJudge ? 'Hide AI Judge ↑' : 'Review with AI Judge ✦'}
            </button>
            <button
              onClick={() => setShowPayment(true)}
              className="flex-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 font-semibold py-3 rounded-2xl hover:border-neutral-900 dark:hover:border-neutral-400 transition-colors text-sm"
            >
              Buy Source · {formatGEN(listing.price)}
            </button>
          </div>
        </div>

        {/* AI Judge — expandable */}
        {showJudge && (
          <div className="flex flex-col gap-4 border border-purple-200 bg-purple-50/60 rounded-2xl p-5 mb-6">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-neutral-900 dark:text-neutral-100">AI Review</h2>
              <span className="text-xs text-purple-600 bg-purple-100 border border-purple-200 px-2 py-1 rounded-full">GenLayer Judge</span>
            </div>
            <label className="text-sm text-neutral-600 dark:text-neutral-400 font-medium">
              Describe what you need this contract to do
            </label>
            <textarea
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              rows={3}
              placeholder="e.g. I need a contract that lets users stake tokens and earn rewards…"
              className="border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 rounded-xl px-4 py-3 text-sm text-neutral-900 dark:text-neutral-100 placeholder-neutral-400 dark:placeholder-neutral-500 resize-none focus:outline-none focus:border-neutral-900 dark:focus:border-neutral-400 transition-colors"
            />
            <button
              onClick={handleEvaluate}
              disabled={evaluating || !requirement.trim() || connecting}
              className="bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3 rounded-xl hover:bg-neutral-700 transition-colors disabled:opacity-50 text-sm"
            >
              {connecting ? 'Connecting wallet…' : evaluating ? 'Waiting for GenLayer…' : writeClient ? 'Evaluate with AI' : 'Connect wallet to evaluate'}
            </button>
            {judgeError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{judgeError}</p>
            )}
            <VerdictCard verdict={verdict} loading={evaluating} />
            {verdict && (
              <div className="flex gap-3">
                <button
                  onClick={() => setShowPayment(true)}
                  className="flex-1 bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3 rounded-xl text-sm"
                >
                  Buy Source · {formatGEN(listing.price)}
                </button>
                {hasDemoContract && (
                  <Link
                    href={`/listing/${id}/interact`}
                    className="flex-1 text-center border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium py-3 rounded-xl text-sm hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors"
                  >
                    Try demo too →
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

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
