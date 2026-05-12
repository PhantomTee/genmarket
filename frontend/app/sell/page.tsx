'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import WalletConnect from '../../components/WalletConnect';
import { useWallet } from '../../lib/wallet-context';
import { encryptFile, parseGEN } from '../../lib/encryption';
import { createListing } from '../../lib/genlayer';

const CATEGORIES = ['DeFi', 'NFT', 'DAO', 'Oracle', 'Identity', 'Utility'];

type Step = 1 | 2 | 3 | 4 | 5 | 6;

interface FormData {
  title: string;
  description: string;
  category: string;
  priceGEN: string;
  demo_contract_address: string;
}

export default function SellPage() {
  const router = useRouter();
  const { address, writeClient } = useWallet();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>({
    title: '',
    description: '',
    category: 'DeFi',
    priceGEN: '',
    demo_contract_address: '',
  });

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [encryptedSource, setEncryptedSource] = useState<string | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [ipfsCid, setIpfsCid] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // GenVM lint gate
  type LintStatus = 'idle' | 'linting' | 'passed' | 'failed';
  const [lintStatus, setLintStatus] = useState<LintStatus>('idle');
  const [lintOutput, setLintOutput] = useState<string>('');

  // Prefill source from /editor if available
  useEffect(() => {
    const pending = sessionStorage.getItem('pending_source');
    if (pending && !sourceFile) {
      const blob = new Blob([pending], { type: 'text/x-python' });
      const file = new File([blob], 'contract.py', { type: 'text/x-python' });
      setSourceFile(file);
      sessionStorage.removeItem('pending_source');
    }
  }, []);

  function update(field: keyof FormData, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleLint() {
    if (!sourceFile) return;
    setLintStatus('linting');
    setLintOutput('');
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
      if (!backendUrl) throw new Error('NEXT_PUBLIC_BACKEND_URL is not set');
      const sourceCode = await sourceFile.text();
      const res = await fetch(`${backendUrl}/api/contracts/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode }),
      });
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Backend did not return JSON. Response: ${text.slice(0, 200)}`);
      }
      if (data.passed) {
        setLintStatus('passed');
      } else {
        setLintStatus('failed');
        setLintOutput(data.stdout || data.stderr || data.summary || data.error || 'Lint failed - check server logs');
      }
    } catch (e: any) {
      setLintStatus('failed');
      setLintOutput(e.message);
    }
  }

  async function handleFileEncryptAndUpload() {
    if (!sourceFile || !address) return;
    setUploading(true);
    setError(null);
    try {
      const buffer = new Uint8Array(await sourceFile.arrayBuffer());
      const { encryptedBase64, keyBase64 } = encryptFile(buffer);

      const res = await fetch('/api/listings/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          price: Number(parseGEN(form.priceGEN)),
          category: form.category,
          demo_contract_address: form.demo_contract_address || 'pending',
          encrypted_source_base64: encryptedBase64,
          seller_public_key: address,
          encryption_key_base64: keyBase64,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');

      setEncryptedSource(encryptedBase64);
      setEncryptionKey(keyBase64);
      setIpfsCid(data.ipfs_cid);
      setListingId(data.listing_id);
      setStep(3);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateListing() {
    if (!writeClient || !ipfsCid) return;
    setSubmitting(true);
    setError(null);
    try {
      await createListing(writeClient, {
        title: form.title,
        description: form.description,
        price: parseGEN(form.priceGEN),
        category: form.category,
        demo_contract_address: form.demo_contract_address,
        ipfs_cid: ipfsCid,
      });
      setStep(6);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels = ['Details', 'Source', 'Demo', 'Review', 'Publish', 'Done'];

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200">
        <Link href="/" className="text-xl font-bold tracking-tight text-neutral-900">
          GenMarket<span className="text-neutral-400">.</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/editor" className="text-sm text-neutral-500 hover:text-neutral-900 transition-colors hidden sm:block">
            ← Editor
          </Link>
          <WalletConnect />
        </div>
      </nav>

      <main className="flex-1 flex flex-col items-center px-6 py-12">
        <div className="w-full max-w-lg">
          {/* Progress */}
          <div className="flex items-center gap-2 mb-10">
            {stepLabels.map((label, i) => {
              const s = (i + 1) as Step;
              return (
                <div key={s} className="flex items-center gap-2 flex-1 last:flex-none">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    step === s ? 'bg-neutral-900 text-[#F7F4EF]'
                    : step > s ? 'bg-emerald-500 text-white'
                    : 'bg-neutral-100 text-neutral-400'
                  }`}>
                    {step > s ? '✓' : s}
                  </div>
                  <span className={`text-xs hidden sm:block ${step === s ? 'text-neutral-900 font-medium' : 'text-neutral-400'}`}>
                    {label}
                  </span>
                  {i < stepLabels.length - 1 && <div className="flex-1 h-px bg-neutral-200" />}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
              {error}
            </div>
          )}

          {/* Step 1 — Details */}
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900">Listing details</h1>
              <div className="flex flex-col gap-4">
                <Field label="Title">
                  <input value={form.title} onChange={(e) => update('title', e.target.value)}
                    placeholder="e.g. Multi-sig Escrow Contract"
                    className="input" />
                </Field>
                <Field label="Description">
                  <textarea value={form.description} onChange={(e) => update('description', e.target.value)}
                    rows={3} placeholder="What does your contract do?"
                    className="input resize-none" />
                </Field>
                <Field label="Category">
                  <select value={form.category} onChange={(e) => update('category', e.target.value)} className="input">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Price (GEN)">
                  <input type="number" step="0.0001" min="0" value={form.priceGEN}
                    onChange={(e) => update('priceGEN', e.target.value)}
                    placeholder="e.g. 1.5"
                    className="input" />
                </Field>
              </div>
              <button
                onClick={() => setStep(2)}
                disabled={!form.title || !form.description || !form.priceGEN}
                className="w-full bg-neutral-900 text-[#F7F4EF] font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                Continue →
              </button>
            </div>
          )}

          {/* Step 2 — Lint check + encrypt source */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900">Upload source code</h1>
              <p className="text-sm text-neutral-500">
                Your contract is validated with GenVM lint before upload. Code is encrypted in
                your browser. We never see the plaintext.
              </p>
              <p className="text-xs text-neutral-400">
                Don&apos;t have your contract ready?{' '}
                <Link href="/editor" className="text-neutral-600 underline hover:text-neutral-900 transition-colors">
                  Write it in the editor →
                </Link>
              </p>
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-neutral-200 rounded-2xl p-10 cursor-pointer hover:border-neutral-400 transition-colors bg-white">
                <span className="text-3xl mb-3">📄</span>
                <span className="text-sm font-medium text-neutral-700">
                  {sourceFile ? sourceFile.name : 'Click to upload .py file'}
                </span>
                <span className="text-xs text-neutral-400 mt-1">Python files only</span>
                <input
                  type="file"
                  accept=".py"
                  className="hidden"
                  onChange={(e) => {
                    setSourceFile(e.target.files?.[0] ?? null);
                    setLintStatus('idle');
                    setLintOutput('');
                  }}
                />
              </label>

              {/* Lint feedback */}
              {lintStatus === 'passed' && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <span className="font-bold">✓</span> Contract passed GenVM lint
                </div>
              )}
              {lintStatus === 'failed' && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <p className="font-semibold mb-1">Lint failed - fix errors before uploading</p>
                  {lintOutput && (
                    <pre className="text-xs whitespace-pre-wrap font-mono mt-2 max-h-48 overflow-y-auto text-red-800">
                      {lintOutput}
                    </pre>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 border border-neutral-200 text-neutral-700 font-medium py-3 rounded-2xl hover:border-neutral-400 transition-colors text-sm"
                >
                  Back
                </button>
                {lintStatus !== 'passed' ? (
                  <button
                    onClick={handleLint}
                    disabled={!sourceFile || lintStatus === 'linting'}
                    className="flex-1 bg-neutral-900 text-[#F7F4EF] font-semibold py-3 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    {lintStatus === 'linting' ? 'Checking contract…' : 'Check contract'}
                  </button>
                ) : (
                  <button
                    onClick={handleFileEncryptAndUpload}
                    disabled={uploading || !address}
                    className="flex-1 bg-neutral-900 text-[#F7F4EF] font-semibold py-3 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
                  >
                    {uploading ? 'Encrypting & uploading…' : 'Encrypt & upload'}
                  </button>
                )}
              </div>
              {!address && <p className="text-xs text-amber-600 text-center">Connect your wallet first</p>}
            </div>
          )}

          {/* Step 3 — Demo address */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900">Demo contract address</h1>
              <p className="text-sm text-neutral-500">
                Deploy your demo contract separately, then paste its address here. Buyers can test it live before purchasing.
              </p>
              <Field label="Demo contract address">
                <input value={form.demo_contract_address}
                  onChange={(e) => update('demo_contract_address', e.target.value)}
                  placeholder="0x..."
                  className="input font-mono" />
              </Field>
              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="flex-1 border border-neutral-200 text-neutral-700 font-medium py-3 rounded-2xl text-sm">Back</button>
                <button onClick={() => setStep(4)} disabled={!form.demo_contract_address}
                  className="flex-1 bg-neutral-900 text-[#F7F4EF] font-semibold py-3 rounded-2xl disabled:opacity-50">
                  Continue →
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Review */}
          {step === 4 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900">Review listing</h1>
              <div className="bg-white border border-neutral-200 rounded-2xl divide-y divide-neutral-100">
                {[
                  ['Title', form.title],
                  ['Category', form.category],
                  ['Price', `${form.priceGEN} GEN`],
                  ['IPFS CID', ipfsCid ?? '(pending)'],
                  ['Demo contract', form.demo_contract_address],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between items-start px-4 py-3 gap-4">
                    <span className="text-sm text-neutral-400 shrink-0">{label}</span>
                    <span className="text-sm text-neutral-900 font-mono text-right break-all">{value}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(3)} className="flex-1 border border-neutral-200 text-neutral-700 font-medium py-3 rounded-2xl text-sm">Back</button>
                <button onClick={() => setStep(5)} className="flex-1 bg-neutral-900 text-[#F7F4EF] font-semibold py-3 rounded-2xl">
                  Looks good →
                </button>
              </div>
            </div>
          )}

          {/* Step 5 — Publish on-chain */}
          {step === 5 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900">Publish to GenLayer</h1>
              <p className="text-sm text-neutral-500">
                This will call <code className="font-mono text-xs bg-neutral-100 px-1 py-0.5 rounded">create_listing()</code> on the Marketplace contract from your wallet. No funds are required for this step.
              </p>
              {!writeClient && (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  Connect your wallet to publish.
                </p>
              )}
              <button
                onClick={handleCreateListing}
                disabled={submitting || !writeClient}
                className="w-full bg-neutral-900 text-[#F7F4EF] font-semibold py-3.5 rounded-2xl disabled:opacity-50"
              >
                {submitting ? 'Waiting for wallet…' : 'Publish listing'}
              </button>
            </div>
          )}

          {/* Step 6 — Success */}
          {step === 6 && (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center text-3xl">✓</div>
              <h1 className="text-2xl font-bold text-neutral-900">Listing published!</h1>
              <p className="text-sm text-neutral-500">Your contract is now live on GenMarket.</p>
              {listingId && (
                <Link href={`/listing/${listingId}`}
                  className="bg-neutral-900 text-[#F7F4EF] font-semibold px-8 py-3 rounded-full hover:bg-neutral-700 transition-colors text-sm">
                  View your listing →
                </Link>
              )}
              <Link href="/dashboard" className="text-sm text-neutral-400 hover:text-neutral-900 transition-colors">
                Go to dashboard
              </Link>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium text-neutral-700">{label}</label>
      {children}
    </div>
  );
}
