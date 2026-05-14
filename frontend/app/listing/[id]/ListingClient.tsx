'use client';

import { useEffect, useCallback, useRef, useState } from 'react';
import Link from 'next/link';
import Navbar from '../../../components/Navbar';
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

const EXPLORER = 'https://studio.genlayer.com/transactions';

function normalizeVerdict(raw: any): Verdict {
  let value = raw;
  for (let i = 0; i < 3; i++) {
    if (typeof value !== 'string') break;
    try { value = JSON.parse(value); } catch { break; }
  }
  const verdictValue = String(value?.verdict || '').toLowerCase();
  const verdict =
    verdictValue === 'match' || verdictValue === 'partial' || verdictValue === 'mismatch'
      ? (verdictValue as Verdict['verdict'])
      : 'partial';
  const confidence = Number(value?.confidence);
  return {
    verdict,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(100, confidence)) : 50,
    explanation:
      typeof value?.explanation === 'string'
        ? value.explanation
        : 'The Judge returned an incomplete response.',
    caveats: Array.isArray(value?.caveats)
      ? value.caveats.filter((x: unknown) => typeof x === 'string')
      : [],
  };
}

// ── Feature 5: Seller reputation badge ─────────────────────────────────────
function SellerReputation({ listing }: { listing: Listing }) {
  const upvotes = Number(listing.seller_upvotes ?? 0);
  const downvotes = Number(listing.seller_downvotes ?? 0);
  const total = upvotes + downvotes;

  if (total === 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 px-2.5 py-1 rounded-full">
        ★ No ratings yet
      </span>
    );
  }

  const score = Math.round((upvotes / total) * 100);
  const cls =
    score >= 70
      ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950 dark:border-emerald-800'
      : score >= 40
      ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950 dark:border-amber-800'
      : 'text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-950 dark:border-red-800';

  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium border px-2.5 py-1 rounded-full ${cls}`}>
      ★ {score}% ({total} {total === 1 ? 'rating' : 'ratings'})
    </span>
  );
}

// ── Feature 1: Status badge ─────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    active:   { label: '🟢 Available',          cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800' },
    pending:  { label: '🟡 Purchase in progress', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400 border-amber-200 dark:border-amber-800' },
    sold:     { label: '✅ Sold',                cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400 border-blue-200 dark:border-blue-800' },
    removed:  { label: '⛔ Removed',             cls: 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400 border-neutral-200 dark:border-neutral-700' },
  };
  const { label, cls } = map[status] ?? { label: status, cls: 'bg-neutral-100 text-neutral-500 border-neutral-200' };
  return (
    <span className={`text-xs font-semibold px-3 py-1 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

export default function ListingClient({ id }: Props) {
  const { writeClient, connect, connecting } = useWallet();
  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showJudge, setShowJudge] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [judgeElapsed, setJudgeElapsed] = useState(0);   // seconds since evaluate started
  const judgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [judgeError, setJudgeError] = useState<string | null>(null);

  const [showPayment, setShowPayment] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);
  // Feature 9: share state
  const [copied, setCopied] = useState(false);
  const [demoSession, setDemoSession] = useState<DemoSession | null>(null);

  // "You already own this" — check localStorage purchases for this listing
  const [ownedPurchase, setOwnedPurchase] = useState<{
    sourceCode?: string;
    encryption_key_base64?: string;
    ipfs_cid?: string;
  } | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('purchases');
      if (!raw) return;
      const purchases: any[] = JSON.parse(raw);
      // Match by onchain_listing_id or listing_id against the URL id param
      const match = purchases.find(
        (p) =>
          String(p.onchain_listing_id ?? '') === String(id) ||
          String(p.listing_id ?? '') === String(id)
      );
      if (match) setOwnedPurchase(match);
    } catch {}
  }, [id]);

  const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? '';

  const fetchListing = useCallback(() => {
    fetch(`${BACKEND}/api/listings/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const listingData = data?.listing ?? data;
        if (!listingData || typeof listingData !== 'object' || !listingData.id) {
          throw new Error('Invalid listing response from backend');
        }
        setListing(listingData as Listing);
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

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`genmarket_demo_test_${id}`);
      if (raw) setDemoSession(JSON.parse(raw));
    } catch {}
  }, [id]);

  async function handleEvaluate() {
    if (!requirement.trim() || !listing) return;
    if (!writeClient) { await connect(); return; }
    if (!listing.preview_code) {
      setJudgeError('This listing has no public preview code. The seller must add a preview before AI evaluation is available.');
      return;
    }
    setEvaluating(true);
    setJudgeElapsed(0);
    setVerdict(null);
    setJudgeError(null);

    // Start elapsed timer so the buyer can see progress
    if (judgeTimerRef.current) clearInterval(judgeTimerRef.current);
    judgeTimerRef.current = setInterval(() => setJudgeElapsed((s) => s + 1), 1_000);

    try {
      const result = await evaluateWithJudge(writeClient, listing.preview_code, listing.description, requirement);
      setVerdict(normalizeVerdict(result));
    } catch (e: any) {
      setJudgeError(e.message);
    } finally {
      if (judgeTimerRef.current) { clearInterval(judgeTimerRef.current); judgeTimerRef.current = null; }
      setEvaluating(false);
    }
  }

  function copyAddress(addr: string) {
    navigator.clipboard.writeText(addr);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1500);
  }

  // Feature 9: share
  function handleShare() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleShareX() {
    if (!listing) return;
    const url = typeof window !== 'undefined' ? window.location.href : '';
    const text = encodeURIComponent(`Check out "${listing.title}" on GenMarket — ${formatGEN(listing.price)}\n${url}`);
    window.open(`https://x.com/intent/tweet?text=${text}`, '_blank');
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

  const hasDemoContract = listing.demo_contract_address && listing.demo_contract_address !== 'pending';
  const isAvailable = listing.status === 'active';
  // Feature 10: explorer link
  const createTxHash = (listing as any).create_tx_hash as string | null | undefined;
  const explorerUrl = createTxHash ? `${EXPLORER}/${createTxHash}` : null;

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F4EF] dark:bg-[#0c0c0c]">
      <Navbar />

      <main className="flex-1 px-6 md:px-12 py-10 max-w-3xl mx-auto w-full">

        {/* Listing header */}
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-xs font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 px-2.5 py-1 rounded-full">
              {listing.category}
            </span>
            {/* Feature 1: enhanced status badge */}
            <StatusBadge status={listing.status} />
          </div>

          <div className="flex items-start justify-between gap-4 mb-2">
            <h1 className="text-2xl sm:text-3xl font-bold text-neutral-900 dark:text-neutral-100 leading-tight">
              {listing.title}
            </h1>
            {/* Feature 9: Share buttons */}
            <div className="flex items-center gap-1 shrink-0 mt-1">
              <button
                onClick={handleShare}
                title="Copy link"
                className="text-xs px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors"
              >
                {copied ? '✓ Copied' : '🔗 Copy link'}
              </button>
              <button
                onClick={handleShareX}
                title="Share on X"
                className="text-xs px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-neutral-500 dark:text-neutral-400 hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors"
              >
                𝕏
              </button>
            </div>
          </div>

          <p className="text-neutral-500 dark:text-neutral-400 text-base mb-4">{listing.description}</p>

          {/* Feature 5: Seller reputation */}
          <div className="mb-3">
            <SellerReputation listing={listing} />
          </div>

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
            {/* Feature 10: on-chain explorer link */}
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full hover:bg-indigo-100 transition-colors"
              >
                ⛓ View on Explorer ↗
              </a>
            )}
          </div>
        </div>

        {/* Public preview code */}
        {listing.preview_code && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-semibold text-neutral-700 dark:text-neutral-300">Public Preview</h2>
              <span className="text-xs text-neutral-400 dark:text-neutral-500">Partial source — full code delivered after purchase</span>
            </div>
            <pre className="bg-neutral-900 dark:bg-black text-neutral-100 text-xs font-mono rounded-2xl p-4 overflow-x-auto max-h-64 leading-relaxed whitespace-pre-wrap break-all">
              {listing.preview_code}
            </pre>
            {listing.source_hash && (
              <p className="mt-2 text-xs text-neutral-400 dark:text-neutral-500 font-mono">
                SHA-256: <span className="break-all">{listing.source_hash}</span>
              </p>
            )}
          </div>
        )}

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

        {/* Feature 1: Non-available listing notice */}
        {!isAvailable && listing.status !== 'removed' && (
          <div className={`mb-5 px-4 py-3 rounded-xl border text-sm font-medium ${
            listing.status === 'sold'
              ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950 dark:border-blue-800 dark:text-blue-300'
              : 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-300'
          }`}>
            {listing.status === 'sold'
              ? '✅ This contract has been sold. It is no longer available for purchase.'
              : '🟡 A purchase is currently in progress. This listing will become available again if the buyer does not confirm.'}
          </div>
        )}

        {/* ── "You already own this" banner ── */}
        {ownedPurchase && (
          <div className="mb-5 flex flex-col gap-3 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-2xl px-4 py-4">
            <div className="flex items-center gap-2">
              <span className="text-lg">✅</span>
              <div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">You already own this contract</p>
                <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">Your purchase was confirmed on-chain. Access your source below.</p>
              </div>
            </div>
            {ownedPurchase.sourceCode ? (
              <button
                onClick={() => {
                  const blob = new Blob([ownedPurchase.sourceCode!], { type: 'text/x-python' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${listing?.title?.replace(/\s+/g, '_') ?? 'contract'}.py`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="w-full text-sm font-semibold py-3 rounded-xl bg-emerald-700 text-white hover:bg-emerald-800 transition-colors"
              >
                ⬇ Download Source Code
              </button>
            ) : (
              <p className="text-xs text-emerald-600 dark:text-emerald-500">
                Source code not found in this browser. Check your Dashboard → Buying tab to re-download.
              </p>
            )}
          </div>
        )}

        {/* Primary actions */}
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

            {/* Hide buy button if already owned */}
            {!ownedPurchase && (
              isAvailable ? (
                <button
                  onClick={() => setShowPayment(true)}
                  className="flex-1 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-neutral-100 font-semibold py-3 rounded-2xl hover:border-neutral-900 dark:hover:border-neutral-400 transition-colors text-sm"
                >
                  Buy Source · {formatGEN(listing.price)}
                </button>
              ) : (
                <div className="flex-1 text-center text-sm text-neutral-400 dark:text-neutral-500 bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 py-3 rounded-2xl cursor-not-allowed">
                  {listing.status === 'sold' ? 'Already sold' : 'Unavailable'}
                </div>
              )
            )}
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
              {connecting ? 'Connecting wallet…'
                : evaluating ? `Evaluating… (${judgeElapsed}s)`
                : writeClient ? 'Evaluate with AI'
                : 'Connect wallet to evaluate'}
            </button>

            {/* Live progress indicator while waiting for GenLayer consensus */}
            {evaluating && (
              <div className="flex items-center gap-3 text-xs text-purple-600 bg-purple-50 border border-purple-200 rounded-xl px-4 py-3">
                <div className="w-3.5 h-3.5 border-2 border-purple-300 border-t-purple-600 rounded-full animate-spin shrink-0" />
                <div>
                  <p className="font-medium">GenLayer Judge is evaluating…</p>
                  <p className="text-purple-500 tabular-nums">{judgeElapsed}s elapsed · typically 2–5 min</p>
                </div>
              </div>
            )}

            {judgeError && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{judgeError}</p>
            )}
            <VerdictCard verdict={verdict} loading={evaluating} />
            {verdict && isAvailable && (
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
          onchainListingId={listing.onchain_listing_id}
          price={Number(listing.price)}
          ipfsCid={listing.ipfs_cid}
          listingTitle={listing.title}
          onClose={() => setShowPayment(false)}
        />
      )}
    </div>
  );
}
