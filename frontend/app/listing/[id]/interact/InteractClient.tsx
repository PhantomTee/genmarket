'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import WalletConnect from '../../../../components/WalletConnect';
import PaymentModal from '../../../../components/PaymentModal';
import { useWallet } from '../../../../lib/wallet-context';
import {
  getContractABI,
  callContractMethod,
  callWriteMethod,
  getListing,
  ABI,
  ABIMethod,
  Listing,
} from '../../../../lib/genlayer';
import { formatGEN } from '../../../../lib/encryption';

interface Props { id: string }

interface CallResult {
  output: unknown;
  txHash?: string;
  error?: string;
}

interface DemoSession {
  timestamp: number;
  method: string;
  success: boolean;
}

function demoSessionKey(id: string) { return `genmarket_demo_test_${id}`; }

function saveSession(id: string, method: string, success: boolean) {
  try {
    sessionStorage.setItem(demoSessionKey(id), JSON.stringify({
      timestamp: Date.now(),
      method,
      success,
    } satisfies DemoSession));
  } catch {}
}

// ─── Input component ────────────────────────────────────────────────────────

function ArgInput({
  param,
  value,
  onChange,
}: {
  param: { name: string; type: string };
  value: string;
  onChange: (v: string) => void;
}) {
  const t = param.type.toLowerCase();
  if (t === 'bool') {
    return (
      <label className="flex items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={value === 'true'}
          onChange={(e) => onChange(e.target.checked ? 'true' : 'false')}
        />
        <span>{param.name} <span className="text-neutral-400 text-xs">({param.type})</span></span>
      </label>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
        {param.name} <span className="normal-case font-normal text-neutral-400">({param.type})</span>
      </label>
      <input
        type={t.includes('int') ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={param.type}
        className="border border-neutral-200 rounded-lg px-3 py-2 text-sm font-mono text-neutral-900 bg-white focus:outline-none focus:border-neutral-900 transition-colors"
      />
    </div>
  );
}

// ─── Result panel ────────────────────────────────────────────────────────────

function ResultPanel({ result, calling }: { result: CallResult | null; calling: boolean }) {
  if (calling) {
    return (
      <div className="flex items-center gap-2 text-xs text-neutral-400 p-4 border border-neutral-100 rounded-xl bg-neutral-50">
        <span className="w-3 h-3 border-2 border-neutral-300 border-t-neutral-600 rounded-full animate-spin" />
        Calling…
      </div>
    );
  }
  if (!result) return null;

  if (result.error) {
    return (
      <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-4 font-mono whitespace-pre-wrap break-all">
        {result.error}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {result.txHash && (
        <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <span className="font-medium shrink-0">Tx:</span>
          <span className="font-mono break-all">{result.txHash}</span>
        </div>
      )}
      <pre className="text-xs font-mono bg-neutral-900 text-emerald-300 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap break-all">
        {result.output !== undefined && result.output !== null
          ? JSON.stringify(result.output, null, 2)
          : '(no return value)'}
      </pre>
    </div>
  );
}

// ─── Method section ──────────────────────────────────────────────────────────

function MethodSection({
  title,
  badge,
  badgeColor,
  methods,
  contractAddress,
  listingId,
  writeClient,
  connectWallet,
  walletAddress,
  onSuccess,
}: {
  title: string;
  badge: string;
  badgeColor: string;
  methods: ABIMethod[];
  contractAddress: string;
  listingId: string;
  writeClient: any;
  connectWallet: () => Promise<void>;
  walletAddress: string | null;
  onSuccess: () => void;
}) {
  const [selected, setSelected] = useState<ABIMethod | null>(methods[0] ?? null);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [genValue, setGenValue] = useState('');
  const [calling, setCalling] = useState(false);
  const [result, setResult] = useState<CallResult | null>(null);
  const isWrite = !methods[0]?.readonly;

  function selectMethod(m: ABIMethod) {
    setSelected(m);
    setArgs({});
    setGenValue('');
    setResult(null);
  }

  async function handleCall() {
    if (!selected) return;
    if (isWrite && !writeClient) { await connectWallet(); return; }
    setCalling(true);
    setResult(null);

    const parsedArgs = selected.inputs.map((p) => {
      const raw = args[p.name] ?? '';
      const t = p.type.toLowerCase();
      if (t === 'bool') return raw === 'true';
      if (t.includes('int')) return Number(raw);
      return raw;
    });

    try {
      if (!isWrite) {
        const output = await callContractMethod(contractAddress, selected.name, parsedArgs);
        const r = { output };
        setResult(r);
        saveSession(listingId, selected.name, true);
        onSuccess();
      } else {
        const value = genValue ? BigInt(Math.round(parseFloat(genValue) * 1e18)) : 0n;
        const { txHash, result: output } = await callWriteMethod(
          writeClient, contractAddress, selected.name, parsedArgs, value
        );
        const r = { output, txHash };
        setResult(r);
        saveSession(listingId, selected.name, true);
        onSuccess();
      }
    } catch (e: any) {
      const r = { output: null, error: e.message };
      setResult(r);
      saveSession(listingId, selected.name, false);
    } finally {
      setCalling(false);
    }
  }

  if (methods.length === 0) return null;

  return (
    <div className="border border-neutral-200 rounded-2xl overflow-hidden bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-100 bg-neutral-50">
        <span className="text-sm font-semibold text-neutral-800">{title}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>{badge}</span>
        <span className="ml-auto text-xs text-neutral-400">{methods.length} method{methods.length > 1 ? 's' : ''}</span>
      </div>

      {/* Method pills */}
      <div className="flex flex-wrap gap-2 px-4 py-3 border-b border-neutral-100">
        {methods.map((m) => (
          <button
            key={m.name}
            onClick={() => selectMethod(m)}
            className={`text-xs font-mono px-3 py-1.5 rounded-full border transition-colors ${
              selected?.name === m.name
                ? 'bg-neutral-900 text-[#F7F4EF] border-neutral-900'
                : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-400'
            }`}
          >
            {m.name}()
          </button>
        ))}
      </div>

      {/* Inputs */}
      {selected && (
        <div className="p-5 flex flex-col gap-4">
          {selected.inputs.length > 0 && (
            <div className="flex flex-col gap-3">
              {selected.inputs.map((p) => (
                <ArgInput
                  key={p.name}
                  param={p}
                  value={args[p.name] ?? ''}
                  onChange={(v) => setArgs((prev) => ({ ...prev, [p.name]: v }))}
                />
              ))}
            </div>
          )}

          {/* GEN value input for write methods (payable) */}
          {isWrite && (
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-neutral-500 uppercase tracking-wide">
                GEN Value <span className="normal-case font-normal">(optional, for payable)</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={genValue}
                onChange={(e) => setGenValue(e.target.value)}
                placeholder="0.0"
                className="border border-neutral-200 rounded-lg px-3 py-2 text-sm font-mono text-neutral-900 bg-white focus:outline-none focus:border-neutral-900 transition-colors w-36"
              />
            </div>
          )}

          {isWrite && !walletAddress && (
            <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              Connect your wallet to call write methods.
            </p>
          )}

          <button
            onClick={handleCall}
            disabled={calling}
            className={`text-sm font-medium py-2.5 rounded-xl transition-colors disabled:opacity-50 ${
              isWrite
                ? 'bg-neutral-900 text-[#F7F4EF] hover:bg-neutral-700'
                : 'bg-neutral-100 text-neutral-900 hover:bg-neutral-200 border border-neutral-200'
            }`}
          >
            {calling
              ? 'Calling…'
              : isWrite && !walletAddress
              ? 'Connect wallet to call'
              : `Call ${selected.name}()`}
          </button>

          <ResultPanel result={result} calling={calling} />
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function InteractClient({ id }: Props) {
  const { writeClient, connect, connecting, address } = useWallet();

  const [listing, setListing] = useState<Listing | null>(null);
  const [abi, setAbi] = useState<ABI | null>(null);
  const [loadingListing, setLoadingListing] = useState(true);
  const [loadingAbi, setLoadingAbi] = useState(false);
  const [listingError, setListingError] = useState<string | null>(null);
  const [abiError, setAbiError] = useState<string | null>(null);
  const [hasTested, setHasTested] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);

  const fetchListing = useCallback(async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? ''}/api/listings/${id}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setListing(data);
    } catch (e: any) {
      setListingError(e.message);
    } finally {
      setLoadingListing(false);
    }
  }, [id]);

  useEffect(() => { fetchListing(); }, [fetchListing]);

  // Load ABI once listing is available and has a demo address
  useEffect(() => {
    if (!listing?.demo_contract_address || listing.demo_contract_address === 'pending') return;
    setLoadingAbi(true);
    setAbiError(null);
    getContractABI(listing.demo_contract_address)
      .then(setAbi)
      .catch((e) => setAbiError(e.message))
      .finally(() => setLoadingAbi(false));
  }, [listing?.demo_contract_address]);

  // Check for prior demo session
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(demoSessionKey(id));
      if (raw) setHasTested(true);
    } catch {}
  }, [id]);

  const hasDemoContract = listing?.demo_contract_address &&
    listing.demo_contract_address !== 'pending';

  const readMethods = abi?.filter((m) => m.readonly) ?? [];
  const writeMethods = abi?.filter((m) => !m.readonly) ?? [];

  function copyAddress() {
    if (!listing?.demo_contract_address) return;
    navigator.clipboard.writeText(listing.demo_contract_address);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 1500);
  }

  if (loadingListing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin" />
      </div>
    );
  }

  if (listingError || !listing) {
    return (
      <div className="min-h-screen flex items-center justify-center flex-col gap-3">
        <p className="text-neutral-500">{listingError ?? 'Listing not found.'}</p>
        <Link href="/browse" className="text-sm text-neutral-400 hover:text-neutral-900">← Browse</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#F7F4EF]">
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200 sticky top-0 bg-[#F7F4EF] z-10">
        <Link href="/" className="text-xl font-bold tracking-tight text-neutral-900">
          GenMarket<span className="text-neutral-400">.</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href={`/listing/${id}`}
            className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            ← {listing.title}
          </Link>
          <WalletConnect />
        </div>
      </nav>

      <main className="flex-1 px-6 md:px-12 py-10 max-w-3xl mx-auto w-full">
        {/* Page header */}
        <div className="mb-8">
          <p className="text-xs font-medium text-neutral-400 uppercase tracking-wide mb-1">Contract Demo</p>
          <h1 className="text-2xl font-bold text-neutral-900 mb-1">{listing.title}</h1>
          <p className="text-sm text-neutral-500 mb-4">{listing.description}</p>

          {hasDemoContract && (
            <div className="flex items-center gap-3 bg-white border border-neutral-200 rounded-2xl px-4 py-3 text-xs">
              <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                <span className="font-medium text-neutral-400 uppercase tracking-wide text-[10px]">Demo contract</span>
                <span className="font-mono text-neutral-700 break-all">{listing.demo_contract_address}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={copyAddress}
                  className="text-neutral-400 hover:text-neutral-900 bg-neutral-50 border border-neutral-200 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  {copiedAddr ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <span className="hidden sm:flex items-center gap-1 text-neutral-400 shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Studionet
              </span>
            </div>
          )}
        </div>

        {/* Prior session banner */}
        {hasTested && (
          <div className="mb-6 flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
            <span className="font-bold">✓</span>
            You tested this demo earlier in this session.
          </div>
        )}

        {/* No demo contract */}
        {!hasDemoContract && (
          <div className="border border-neutral-200 rounded-2xl p-8 text-center text-sm text-neutral-500 bg-white mb-6">
            No demo contract deployed by the seller.
            <br />
            You can still purchase the source and review with the AI judge.
          </div>
        )}

        {/* ABI loading / error */}
        {hasDemoContract && loadingAbi && (
          <div className="border border-neutral-200 rounded-2xl p-6 animate-pulse bg-white mb-4">
            <div className="h-4 bg-neutral-100 rounded w-1/3 mb-3" />
            <div className="h-8 bg-neutral-100 rounded w-full" />
          </div>
        )}

        {hasDemoContract && abiError && (
          <div className="border border-red-200 bg-red-50 rounded-2xl p-4 text-sm text-red-700 mb-4">
            Could not load contract schema: {abiError}
          </div>
        )}

        {/* Method sections */}
        {hasDemoContract && abi && (
          <div className="flex flex-col gap-5 mb-8">
            {readMethods.length > 0 && (
              <MethodSection
                title="Read Methods"
                badge="Free · no wallet"
                badgeColor="text-blue-700 bg-blue-50 border border-blue-200"
                methods={readMethods}
                contractAddress={listing.demo_contract_address}
                listingId={id}
                writeClient={writeClient}
                connectWallet={connect}
                walletAddress={address}
                onSuccess={() => setHasTested(true)}
              />
            )}
            {writeMethods.length > 0 && (
              <MethodSection
                title="Write Methods"
                badge="Requires wallet"
                badgeColor="text-amber-700 bg-amber-50 border border-amber-200"
                methods={writeMethods}
                contractAddress={listing.demo_contract_address}
                listingId={id}
                writeClient={writeClient}
                connectWallet={connect}
                walletAddress={address}
                onSuccess={() => setHasTested(true)}
              />
            )}
            {abi.length === 0 && (
              <div className="text-sm text-neutral-500 text-center py-8">
                No public methods found in contract schema.
              </div>
            )}
          </div>
        )}

        {/* Buy CTA */}
        <div className={`border border-neutral-200 rounded-2xl p-6 bg-white flex flex-col gap-4 ${hasTested ? 'border-emerald-200 bg-emerald-50' : ''}`}>
          {hasTested ? (
            <div>
              <p className="text-sm font-semibold text-emerald-800 mb-0.5">Demo tested. Ready to buy?</p>
              <p className="text-xs text-emerald-600">Your payment is held in escrow until you confirm delivery.</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-semibold text-neutral-800 mb-0.5">Ready to purchase?</p>
              <p className="text-xs text-neutral-500">
                {hasDemoContract
                  ? 'Try the demo above before buying. Your payment is held in escrow.'
                  : 'Your payment is held in escrow until you confirm delivery.'}
              </p>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={() => setShowPayment(true)}
              className="flex-1 bg-neutral-900 text-[#F7F4EF] font-semibold py-3 rounded-2xl hover:bg-neutral-700 transition-colors text-sm"
            >
              Buy Source · {formatGEN(listing.price)}
            </button>
            <Link
              href={`/listing/${id}`}
              className="flex-1 text-center border border-neutral-200 text-neutral-700 font-medium py-3 rounded-2xl hover:border-neutral-400 transition-colors text-sm"
            >
              ← Back to listing
            </Link>
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
