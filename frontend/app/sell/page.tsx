'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import WalletConnect from '../../components/WalletConnect';
import { useWallet } from '../../lib/wallet-context';
import { encryptFile, parseGEN } from '../../lib/encryption';
import { createListing, deployContract } from '../../lib/genlayer';
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
  const [encryptedSource, setEncryptedSource] = useState<string | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<string | null>(null);
  const [ipfsCid, setIpfsCid] = useState<string | null>(null);
  const [listingId, setListingId] = useState<string | null>(null);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [lintStatus, setLintStatus] = useState<LintStatus>('idle');
  const [lintOutput, setLintOutput] = useState<string>('');
  const [parsedErrors, setParsedErrors] = useState<ParsedLintError[]>([]);

  const [deployingDemo, setDeployingDemo] = useState(false);
  const [demoDeployError, setDemoDeployError] = useState<string | null>(null);

  const formSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore form draft on mount
  useEffect(() => {
    setForm(loadFormDraft());
  }, []);

  // Prefill source from editor (sessionStorage) and persist to localStorage
  useEffect(() => {
    const pending = sessionStorage.getItem('pending_source');
    if (pending && !sourceFile) {
      const blob = new Blob([pending], { type: 'text/x-python' });
      const file = new File([blob], 'contract.py', { type: 'text/x-python' });
      setSourceFile(file);
      setSourceCode(pending);
      localStorage.setItem(DRAFT_KEY, pending);
      sessionStorage.removeItem('pending_source');
    }
  }, []);

  // When a real file is selected, read + normalize + persist
  useEffect(() => {
    if (!sourceFile) return;
    sourceFile.text().then((raw) => {
      const clean = normalizePythonSource(raw);
      setSourceCode(clean);
      localStorage.setItem(DRAFT_KEY, clean);
    });
  }, [sourceFile]);

  // Auto-save form fields to localStorage (debounced)
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

      // Always normalize before sending — strips hidden chars, mixed indent
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
      try {
        data = JSON.parse(text);
      } catch {
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
        ? 'Cannot reach lint server. Check that NEXT_PUBLIC_BACKEND_URL is set in Vercel, or upload directly without lint.'
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
      // Clear all drafts only after successful publish
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(FORM_DRAFT_KEY);
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
              <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold text-neutral-900">Listing details</h1>
                {(form.title || form.description || form.priceGEN) && (
                  <button
                    onClick={clearDraft}
                    className="text-xs text-neutral-400 hover:text-red-500 transition-colors"
                  >
                    Clear draft
                  </button>
                )}
              </div>
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

          {/* Step 2 — Upload + optional lint + optional deploy demo */}
          {step === 2 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900">Upload source code</h1>
              <p className="text-sm text-neutral-500">
                Code is encrypted in your browser — we never see the plaintext.
                Run lint to validate, or upload directly.
              </p>
              <p className="text-xs text-neutral-400">
                Don&apos;t have your contract ready?{' '}
                <Link href="/editor" className="text-neutral-600 underline hover:text-neutral-900 transition-colors">
                  Write it in the editor →
                </Link>
              </p>

              {/* File upload */}
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
                    setParsedErrors([]);
                    setDemoDeployError(null);
                  }}
                />
              </label>

              {/* Download button — shown when file is loaded */}
              {sourceFile && (
                <button
                  onClick={() => {
                    const blob = new Blob([sourceCode || ''], { type: 'text/x-python' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = sourceFile.name ?? 'contract.py';
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="inline-flex items-center gap-2 text-sm text-neutral-600 bg-neutral-50 border border-neutral-200 hover:border-neutral-400 hover:text-neutral-900 px-4 py-2.5 rounded-xl transition-colors self-start"
                >
                  ⬇ Download {sourceFile.name}
                </button>
              )}

              {/* Lint passed */}
              {lintStatus === 'passed' && (
                <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3">
                  <span className="font-bold">✓</span> Contract passed GenVM lint
                </div>
              )}

              {/* Lint failed — structured error panel */}
              {lintStatus === 'failed' && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex flex-col gap-2">
                  <p className="font-semibold">Lint failed — fix errors before uploading</p>

                  {parsedErrors.length > 0 && (
                    <ul className="flex flex-col gap-2 mt-1">
                      {parsedErrors.map((err, i) => (
                        <li key={i} className="flex flex-col gap-0.5">
                          <div className="flex items-start gap-2">
                            {err.line != null && (
                              <span className="font-mono text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded shrink-0">
                                L{err.line}
                              </span>
                            )}
                            <span className="text-xs font-mono text-red-800 break-words">{err.message}</span>
                          </div>
                          {err.hint && (
                            <p className="text-xs text-red-600 pl-0.5 italic">{err.hint}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Raw output fallback when parser found nothing new */}
                  {parsedErrors.length === 0 && lintOutput && (
                    <pre className="text-xs whitespace-pre-wrap font-mono mt-1 max-h-36 overflow-y-auto text-red-800">
                      {lintOutput}
                    </pre>
                  )}

                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <button
                      onClick={() => handleEditContract(parsedErrors[0]?.line)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-white border border-red-300 hover:border-red-500 hover:text-red-900 px-3 py-1.5 rounded-lg transition-colors"
                    >
                      ← Edit contract
                    </button>
                    {parsedErrors[0]?.line != null && (
                      <button
                        onClick={() => handleEditContract(parsedErrors[0].line)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-white border border-red-300 hover:border-red-500 hover:text-red-900 px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Go to line {parsedErrors[0].line} →
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Deploy Demo section — shown after lint passes */}
              {lintStatus === 'passed' && (
                <div className="border border-neutral-200 rounded-2xl px-4 py-4 flex flex-col gap-3 bg-white">
                  <div>
                    <p className="text-sm font-semibold text-neutral-800">Deploy Demo Contract <span className="font-normal text-neutral-400 text-xs">(optional)</span></p>
                    <p className="text-xs text-neutral-500 mt-0.5">
                      Deploy to Studionet so buyers can test your contract before purchasing.
                      You can also enter the address manually in the next step.
                    </p>
                  </div>

                  {form.demo_contract_address ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg font-mono break-all flex-1">
                        {form.demo_contract_address}
                      </span>
                      <button
                        onClick={() => { const n = { ...form, demo_contract_address: '' }; setForm(n); localStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(n)); }}
                        className="text-xs text-neutral-400 hover:text-red-500 shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={handleDeployDemo}
                        disabled={deployingDemo || connecting}
                        className="inline-flex items-center gap-2 text-sm font-medium text-neutral-900 bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 px-4 py-2.5 rounded-xl transition-colors disabled:opacity-50 self-start"
                      >
                        {deployingDemo ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-neutral-500 border-t-transparent rounded-full animate-spin" />
                            Deploying…
                          </>
                        ) : connecting ? 'Connecting wallet…' : '⬆ Deploy Demo Contract'}
                      </button>
                      {!address && (
                        <p className="text-xs text-amber-600">Connect your wallet to deploy.</p>
                      )}
                    </>
                  )}

                  {demoDeployError && (
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      Deploy failed: {demoDeployError}
                    </p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 border border-neutral-200 text-neutral-700 font-medium py-3 rounded-2xl hover:border-neutral-400 transition-colors text-sm"
                >
                  Back
                </button>
                <button
                  onClick={handleLint}
                  disabled={!sourceFile || lintStatus === 'linting'}
                  className={`flex-1 text-sm font-medium py-3 rounded-2xl border transition-colors disabled:opacity-50 ${
                    lintStatus === 'passed'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-white border-neutral-200 text-neutral-700 hover:border-neutral-400'
                  }`}
                >
                  {lintStatus === 'linting' ? 'Checking…' : lintStatus === 'passed' ? '✓ Lint passed' : 'Check contract'}
                </button>
              </div>
              <button
                onClick={handleFileEncryptAndUpload}
                disabled={uploading || !address || !sourceFile}
                className="w-full bg-neutral-900 text-[#F7F4EF] font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                {uploading ? 'Encrypting & uploading…' : 'Encrypt & upload →'}
              </button>
              {!address && (
                <p className="text-xs text-amber-600 text-center">Connect your wallet to upload</p>
              )}
            </div>
          )}

          {/* Step 3 — Demo address */}
          {step === 3 && (
            <div className="flex flex-col gap-5">
              <h1 className="text-2xl font-bold text-neutral-900">Demo contract address</h1>
              <p className="text-sm text-neutral-500">
                Paste the address of your deployed demo contract. Buyers can test it live before purchasing.
                {form.demo_contract_address && ' (Pre-filled from your deploy above.)'}
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
