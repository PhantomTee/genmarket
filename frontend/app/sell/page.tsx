'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import WalletConnect from '../../components/WalletConnect';
import { useWallet } from '../../lib/wallet-context';
import { parseGEN } from '../../lib/encryption';
import { createListing, deployContract, createReadClient } from '../../lib/genlayer';
import { normalizePythonSource } from '../../lib/normalize';
import { parseLintOutput, ParsedLintError } from '../../lib/lint-parser';

const CATEGORIES = ['DeFi', 'NFT', 'DAO', 'Oracle', 'Identity', 'Utility'];
const DRAFT_KEY = 'genmarket_contract_draft';
const FORM_DRAFT_KEY = 'genmarket_sell_draft';

type Step = 1 | 2 | 3 | 4 | 5 | 6;
type LintStatus = 'idle' | 'linting' | 'passed' | 'failed';

interface FormData {
  title: string;
  description: string;
  category: string;
  priceGEN: string;
  demo_contract_address: string;
}

function loadFormDraft(): FormData {
  if (typeof window === 'undefined') return defaultForm();
  try {
    const raw = localStorage.getItem(FORM_DRAFT_KEY);
    if (raw) return { ...defaultForm(), ...JSON.parse(raw) };
  } catch {}
  return defaultForm();
}

function defaultForm(): FormData {
  return { title: '', description: '', category: 'DeFi', priceGEN: '', demo_contract_address: '' };
}

export default function SellPage() {
  const router = useRouter();
  const { address, writeClient, connect, connecting } = useWallet();

  const [step, setStep] = useState<Step>(1);
  const [form, setForm] = useState<FormData>(defaultForm);

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourceCode, setSourceCode] = useState<string>('');
  const [previewCode, setPreviewCode] = useState<string>('');

  const [ipfsCid, setIpfsCid] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string | null>(null);
  const [sourceHash, setSourceHash] = useState<string | null>(null);
  const [chainListingId, setChainListingId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lintStatus, setLintStatus] = useState<LintStatus>('idle');
  const [lintOutput, setLintOutput] = useState<string>('');
  const [parsedErrors, setParsedErrors] = useState<ParsedLintError[]>([]);

  const [deployingDemo, setDeployingDemo] = useState(false);
  const [demoDeployError, setDemoDeployError] = useState<string | null>(null);

  const formSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { setForm(loadFormDraft()); }, []);

  // Prefill source from editor sessionStorage
  useEffect(() => {
    const pending = sessionStorage.getItem('pending_source');
    if (pending && !sourceFile) {
      const file = new File([pending], 'contract.py', { type: 'text/x-python' });
      setSourceFile(file);
      setSourceCode(pending);
      localStorage.setItem(DRAFT_KEY, pending);
      sessionStorage.removeItem('pending_source');
    }
  }, []);

  useEffect(() => {
    if (!sourceFile) return;
    sourceFile.text().then((raw) => {
      const clean = normalizePythonSource(raw);
      setSourceCode(clean);
      localStorage.setItem(DRAFT_KEY, clean);
    });
  }, [sourceFile]);

  function update(field: keyof FormData, value: string) {
    const next = { ...form, [field]: value };
    setForm(next);
    if (formSaveRef.current) clearTimeout(formSaveRef.current);
    formSaveRef.current = setTimeout(() => {
      localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(next));
    }, 500);
  }

  function clearDraft() {
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(FORM_DRAFT_KEY);
    setForm(defaultForm());
    setSourceFile(null);
    setSourceCode('');
    setPreviewCode('');
    setLintStatus('idle');
    setLintOutput('');
    setParsedErrors([]);
  }

  async function handleLint() {
    if (!sourceFile) return;
    setLintStatus('linting');
    setLintOutput('');
    setParsedErrors([]);
    setDemoDeployError(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
      if (!backendUrl) throw new Error('NEXT_PUBLIC_BACKEND_URL is not set');
      const raw = await sourceFile.text();
      const src = normalizePythonSource(raw);
      setSourceCode(src);
      localStorage.setItem(DRAFT_KEY, src);
      const res = await fetch(`${backendUrl}/api/contracts/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceCode: src }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch {
        throw new Error(`Backend did not return JSON. Response: ${text.slice(0, 200)}`);
      }
      if (data.passed) {
        setLintStatus('passed');
      } else {
        setLintStatus('failed');
        setLintOutput(data.stdout || data.stderr || '');
        setParsedErrors(parseLintOutput(data.stdout ?? '', data.stderr ?? ''));
      }
    } catch (e: any) {
      setLintStatus('failed');
      const msg = e.message?.includes('Failed to fetch')
        ? 'Cannot reach lint server. Check NEXT_PUBLIC_BACKEND_URL in Vercel.'
        : e.message;
      setLintOutput(msg);
      setParsedErrors([{ line: null, column: null, message: msg }]);
    }
  }

  function handleEditContract(jumpLine?: number | null) {
    if (jumpLine) sessionStorage.setItem('genmarket_jump_to_line', String(jumpLine));
    router.push('/editor');
  }

  async function handleDeployDemo() {
    if (!writeClient) { await connect(); return; }
    if (!sourceCode) return;
    setDeployingDemo(true);
    setDemoDeployError(null);
    try {
      const addr = await deployContract(writeClient, sourceCode);
      const next = { ...form, demo_contract_address: addr };
      setForm(next);
      localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(next));
    } catch (e: any) {
      setDemoDeployError(e.message ?? 'Deployment failed');
    } finally {
      setDeployingDemo(false);
    }
  }

  function generatePreview() {
    if (!sourceCode) return;
    const lines = sourceCode.split('\n');
    const cutoff = Math.max(1, Math.floor(lines.length * 0.35));
    setPreviewCode(lines.slice(0, cutoff).join('\n'));
  }

  // Step 3 → 4: send fullSourceCode + previewCode to backend for encryption + IPFS upload
  async function handleUpload() {
    if (!sourceCode || !previewCode.trim() || !address) return;
    if (previewCode.trim() === sourceCode.trim()) {
      setError('Preview cannot be identical to full source. Choose a partial snippet.');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;
      if (!backendUrl) throw new Error('NEXT_PUBLIC_BACKEND_URL is not configured');
      const res = await fetch(`${backendUrl}/api/listings/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          price: parseGEN(form.priceGEN).toString(),
          category: form.category,
          demoContractAddress: form.demo_contract_address || 'pending',
          fullSourceCode: sourceCode,
          previewCode: previewCode.trim(),
          sellerAddress: address,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');
      setIpfsCid(data.ipfs_cid);
      setListingId(data.listing_id);
      setSourceHash(data.source_hash);
      setStep(4);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateListing() {
    if (!writeClient || !ipfsCid || !listingId || !sourceHash || !previewCode) return;
    setSubmitting(true);
    setError(null);
    try {
      let chainId = await createListing(writeClient, {
        title: form.title,
        description: form.description,
        price: parseGEN(form.priceGEN),
        category: form.category,
        demo_contract_address: form.demo_contract_address || 'pending',
        ipfs_cid: ipfsCid,
        preview_code: previewCode.trim(),
        source_hash: sourceHash,
      });

      // If the contract didn't return the listing ID, derive it from all listings
      if (!chainId) {
        const readClient = createReadClient();
        const rawListings = await readClient.readContract({
          address: (process.env.NEXT_PUBLIC_MARKETPLACE_CONTRACT_ADDRESS ?? '') as `0x${string}`,
          functionName: 'get_all_listings_json',
          args: [],
        });

        const parsedListings =
          typeof rawListings === 'string' ? JSON.parse(rawListings) : rawListings;

        const listings = Array.isArray(parsedListings) ? parsedListings : [];
        const newest = listings[listings.length - 1];

        chainId = newest?.id ? String(newest.id) : '';
      }

      if (chainId) {
        await fetch(
          `${process.env.NEXT_PUBLIC_BACKEND_URL ?? ''}/api/listings/${listingId}/chain-id`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ onchain_listing_id: chainId }),
          }
        );
        setChainListingId(chainId);
      }
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(FORM_DRAFT_KEY);
      setStep(6);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  const previewIsFull = previewCode.trim().length > 0 && previewCode.trim() === sourceCode.trim();
  const stepLabels = ['Details', 'Source', 'Preview', 'Review', 'Publish', 'Done'];

  return (
    <div className="min-h-screen flex flex-col">
      <nav className="flex items-center justify-between px-6 md:px-12 py-5 border-b border-neutral-200 dark:border-neutral-700">
        <Link href="/" className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
          GenMarket<span className="text-neutral-400 dark:text-neutral-500">.</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/editor" className="text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors hidden sm:block">
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
                    step === s ? 'bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900'
                    : step > s ? 'bg-emerald-500 text-white'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-500'
                  }`}>
                    {step > s ? '✓' : s}
                  </div>
                  <span className={`text-xs hidden sm:block ${step === s ? 'text-neutral-900 dark:text-neutral-100 font-medium' : 'text-neutral-400 dark:text-neutral-500'}`}>
                    {label}
                  </span>
                  {i < stepLabels.length - 1 && <div className="flex-1 h-px bg-neutral-200 dark:bg-neutral-700" />}
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</div>
          )}

          {/* Step 1 — Details */}
          {step === 1 && (
            <div className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Listing details</h1>
                {(form.title || form.description || form.priceGEN) && (
                  <button onClick={clearDraft} className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-red-500 transition-colors">
                    Clear draft
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-4">
                <Field label="Title">
                  <input value={form.title} onChange={(e) => update('title', e.target.value)}
                    placeholder="e.g. Multi-sig Escrow Contract" className="input" />
                </Field>
                <Field label="Description">
                  <textarea value={form.description} onChange={(e) => update('description', e.target.value)}
                    rows={3} placeholder="What does your contract do?" className="input resize-none" />
                </Field>
                <Field label="Category">
                  <select value={form.category} onChange={(e) => update('category', e.target.value)} className="input">
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </Field>
                <Field label="Price (GEN)">
                  <input type="number" step="0.0001" min="0" value={form.priceGEN}
                    onChange={(e) => update('priceGEN', e.target.value)} placeholder="e.g. 1.5" className="input" />
                </Field>
              </div>
              <button onClick={() => {
                if (parseFloat(form.priceGEN) <= 0 || isNaN(parseFloat(form.priceGEN))) {
                  setError('Price must be greater than 0');
                  return;
                }
                setError(null);
                setStep(2);
              }} disabled={!form.title || !form.description || !form.priceGEN}
                className="w-full bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50">
                Continue →
              </button>
            </div>
          )}

          {/* Step 2 — Full source upload + lint + optional demo deploy */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Full source code</h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                Upload your complete GenLayer contract. The full source is encrypted on our server — buyers only see the public preview you choose in the next step.
              </p>

              {/* File upload */}
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-neutral-200 dark:border-neutral-700 rounded-2xl p-10 cursor-pointer hover:border-neutral-400 dark:hover:border-neutral-500 transition-colors bg-white dark:bg-neutral-900">
                <span className="text-3xl mb-3">📄</span>
                <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                  {sourceFile ? sourceFile.name : 'Click to upload .py file'}
                </span>
                <span className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">Python files only</span>
                <input type="file" accept=".py" className="hidden"
                  onChange={(e) => {
                    setSourceFile(e.target.files?.[0] ?? null);
                    setLintStatus('idle'); setLintOutput(''); setParsedErrors([]); setDemoDeployError(null);
                  }} />
              </label>

              {lintStatus === 'passed' && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <span className="font-bold">✓</span> Contract passed GenVM lint
                </div>
              )}

              {lintStatus === 'failed' && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-col gap-2">
                  <p className="font-semibold">Lint failed — fix errors before continuing</p>
                  {parsedErrors.length > 0 && (
                    <ul className="flex flex-col gap-2 mt-1">
                      {parsedErrors.map((err, i) => (
                        <li key={i} className="flex flex-col gap-0.5">
                          <div className="flex items-start gap-2">
                            {err.line != null && (
                              <span className="font-mono text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded shrink-0">L{err.line}</span>
                            )}
                            <span className="text-xs font-mono text-red-800 break-words">{err.message}</span>
                          </div>
                          {err.hint && <p className="text-xs text-red-600 pl-0.5 italic">{err.hint}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {parsedErrors.length === 0 && lintOutput && (
                    <pre className="text-xs whitespace-pre-wrap font-mono mt-1 max-h-36 overflow-y-auto text-red-800">{lintOutput}</pre>
                  )}
                  <button onClick={() => handleEditContract(parsedErrors[0]?.line)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-white border border-red-300 hover:border-red-500 px-3 py-1.5 rounded-lg transition-colors self-start">
                    ← Edit contract
                  </button>
                </div>
              )}

              {/* Deploy demo — after lint passes */}
              {lintStatus === 'passed' && (
                <div className="border border-neutral-200 dark:border-neutral-700 rounded-2xl px-4 py-4 flex flex-col gap-3 bg-white dark:bg-neutral-900">
                  <div>
                    <p className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                      Deploy Demo Contract <span className="font-normal text-neutral-400 dark:text-neutral-500 text-xs">(optional)</span>
                    </p>
                    <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
                      Deploy to Studionet so buyers can test before purchasing.
                    </p>
                  </div>
                  {form.demo_contract_address ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg font-mono break-all flex-1">
                        {form.demo_contract_address}
                      </span>
                      <button onClick={() => { const n = { ...form, demo_contract_address: '' }; setForm(n); localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(n)); }}
                        className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-red-500 shrink-0">×</button>
                    </div>
                  ) : (
                    <>
                      <button onClick={handleDeployDemo} disabled={deployingDemo || connecting}
                        className="inline-flex items-center gap-2 text-sm font-medium text-neutral-900 dark:text-neutral-100 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 border border-neutral-200 dark:border-neutral-700 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 self-start">
                        {deployingDemo ? <><span className="w-3.5 h-3.5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />Deploying…</> : connecting ? 'Connecting…' : '⬆ Deploy Demo Contract'}
                      </button>
                      {!address && <p className="text-xs text-amber-600">Connect your wallet to deploy.</p>}
                    </>
                  )}
                  {demoDeployError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">Deploy failed: {demoDeployError}</p>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium py-3 rounded-2xl text-sm">Back</button>
                <button onClick={handleLint} disabled={!sourceFile || lintStatus === 'linting'}
                  className={`flex-1 text-sm font-medium py-3 rounded-2xl border transition-colors disabled:opacity-50 ${
                    lintStatus === 'passed' ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-500'
                  }`}>
                  {lintStatus === 'linting' ? 'Checking…' : lintStatus === 'passed' ? '✓ Lint passed' : 'Check contract'}
                </button>
              </div>
              <button onClick={() => { setError(null); setStep(3); }} disabled={!sourceFile || !sourceCode.trim()}
                className="w-full bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50">
                Continue → Choose Preview
              </button>
            </div>
          )}

          {/* Step 3 — Public preview code */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Public code preview</h1>
              <div className="text-sm text-neutral-500 dark:text-neutral-400 flex flex-col gap-1">
                <p>This snippet is <strong className="text-neutral-900 dark:text-neutral-100">public</strong> — visible to buyers, the AI Judge, and on-chain.</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Do not include secrets, credentials, or your entire proprietary implementation.</p>
              </div>

              <div className="flex gap-2">
                <button onClick={generatePreview}
                  className="text-xs bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 hover:border-neutral-400 dark:hover:border-neutral-500 px-3 py-2 rounded-lg transition-colors">
                  Generate from first 35%
                </button>
                {sourceCode && (
                  <button onClick={() => setPreviewCode('')}
                    className="text-xs text-neutral-400 dark:text-neutral-500 hover:text-red-500 transition-colors px-3 py-2">
                    Clear
                  </button>
                )}
              </div>

              <Field label={`Preview code (${previewCode.length} chars)`}>
                <textarea
                  value={previewCode}
                  onChange={(e) => setPreviewCode(e.target.value)}
                  rows={12}
                  placeholder="Paste or generate a partial snippet of your contract…"
                  className="input resize-y font-mono text-xs leading-relaxed"
                />
              </Field>

              {previewIsFull && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                  Preview cannot be identical to full source. Choose a partial snippet.
                </div>
              )}

              {previewCode.trim() && !previewIsFull && (
                <div className="text-xs text-neutral-400 dark:text-neutral-500 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 font-mono leading-relaxed line-clamp-4">
                  Preview: {previewCode.trim().slice(0, 120)}…
                </div>
              )}

              <div className="flex gap-3">
                <button onClick={() => setStep(2)} className="flex-1 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium py-3 rounded-2xl text-sm">Back</button>
                <button onClick={handleUpload}
                  disabled={uploading || !previewCode.trim() || previewIsFull || !address}
                  className="flex-1 bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3 rounded-2xl disabled:opacity-50 text-sm">
                  {uploading ? 'Uploading…' : 'Upload & Continue →'}
                </button>
              </div>
              {!address && <p className="text-xs text-amber-600 text-center">Connect your wallet to continue</p>}
            </div>
          )}

          {/* Step 4 — Review */}
          {step === 4 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Review listing</h1>
              <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl divide-y divide-neutral-100 dark:divide-neutral-800">
                {[
                  ['Title', form.title],
                  ['Category', form.category],
                  ['Price', `${form.priceGEN} GEN`],
                  ['IPFS CID', ipfsCid ?? '(pending)'],
                  ['Source hash', sourceHash ? sourceHash.slice(0, 16) + '…' : '(pending)'],
                  ['Demo contract', form.demo_contract_address || 'None'],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between items-start px-4 py-3 gap-4">
                    <span className="text-sm text-neutral-400 dark:text-neutral-500 shrink-0">{label}</span>
                    <span className="text-sm text-neutral-900 dark:text-neutral-100 font-mono text-right break-all">{value}</span>
                  </div>
                ))}
              </div>
              <details className="text-xs text-neutral-500 dark:text-neutral-400">
                <summary className="cursor-pointer hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors">Preview snippet</summary>
                <pre className="mt-2 bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all font-mono text-xs leading-relaxed max-h-48 overflow-y-auto">
                  {previewCode}
                </pre>
              </details>
              <div className="flex gap-3">
                <button onClick={() => setStep(3)} className="flex-1 border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-300 font-medium py-3 rounded-2xl text-sm">Back</button>
                <button onClick={() => setStep(5)} className="flex-1 bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3 rounded-2xl">
                  Looks good →
                </button>
              </div>
            </div>
          )}

          {/* Step 5 — Publish on-chain */}
          {step === 5 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Publish to GenLayer</h1>
              {!writeClient && (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-xl p-3">
                  Connect your wallet to publish.
                </p>
              )}
              <button onClick={handleCreateListing} disabled={submitting || !writeClient}
                className="w-full bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3.5 rounded-2xl disabled:opacity-50">
                {submitting ? 'Waiting for wallet…' : 'Publish listing'}
              </button>
            </div>
          )}

          {/* Step 6 — Done */}
          {step === 6 && (
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="w-16 h-16 bg-emerald-100 rounded-3xl flex items-center justify-center text-3xl">✓</div>
              <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Listing published!</h1>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">Your contract is live on GenMarket. Full source is encrypted; buyers see your preview until they purchase.</p>
              {chainListingId && (
                <Link href={`/listing/${chainListingId}`}
                  className="bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold px-8 py-3 rounded-full hover:bg-neutral-700 transition-colors text-sm">
                  View your listing →
                </Link>
              )}
              <Link href="/dashboard" className="text-sm text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors">
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
      <label className="text-sm font-medium text-neutral-700 dark:text-neutral-300">{label}</label>
      {children}
    </div>
  );
}
