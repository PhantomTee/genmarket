'use client';

import { useState } from 'react';
import { useWallet } from '../lib/wallet-context';
import { buy, confirmPurchase } from '../lib/genlayer';
import { fetchFromIPFS } from '../lib/ipfs';
import { decryptToBuffer, formatGEN } from '../lib/encryption';

interface Props {
  listingId: string;
  price: number;        // wei
  ipfsCid: string;
  listingTitle: string;
  onClose: () => void;
}

type Step = 'escrow' | 'confirm' | 'download';

export default function PaymentModal({ listingId, price, ipfsCid, listingTitle, onClose }: Props) {
  const { address, writeClient } = useWallet();
  const [step, setStep] = useState<Step>('escrow');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const escrowId = address ? `${listingId}_${address.toLowerCase()}` : '';

  async function handleLockEscrow() {
    if (!writeClient || !address) {
      setError('Connect your wallet first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await buy(writeClient, listingId, BigInt(price));
      setStep('confirm');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPurchase() {
    if (!writeClient || !address) return;
    setBusy(true);
    setError(null);
    try {
      // 1. Get decryption key from backend (verifies escrow is locked on-chain)
      const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'}/api/payments/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, buyer_address: address }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Failed to confirm purchase');
      }
      const { encryption_key_base64, ipfs_cid } = await res.json();

      // 2. Fetch encrypted source from IPFS and decrypt in browser
      const encryptedSource = await fetchFromIPFS(ipfs_cid ?? ipfsCid);
      const { decryptToBuffer: dtb } = await import('../lib/encryption');
      const plainBuffer = dtb(encryptedSource, encryption_key_base64);

      // 3. Build a blob URL for download
const arrayBuffer = plainBuffer.buffer.slice(
  plainBuffer.byteOffset,
  plainBuffer.byteOffset + plainBuffer.byteLength
) as ArrayBuffer;

const blob = new Blob([arrayBuffer], { type: "text/x-python" });
      setDownloadUrl(URL.createObjectURL(blob));

      // 4. Buyer calls confirm_purchase on-chain (releases funds to seller)
      await confirmPurchase(writeClient, escrowId);

      // 5. Persist purchase in localStorage so the dashboard buying tab survives refreshes
      try {
        const stored = JSON.parse(localStorage.getItem('purchases') ?? '[]');
        const updated = [
          ...stored.filter((p: any) => p.listing_id !== listingId),
          {
            listing_id: listingId,
            title: listingTitle,
            price,
            ipfs_cid: ipfs_cid ?? ipfsCid,
            escrow_id: escrowId,
            encryption_key_base64,
          },
        ];
        localStorage.setItem('purchases', JSON.stringify(updated));
      } catch { /* non-fatal */ }

      setStep('download');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-[#F7F4EF] border border-neutral-200 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-200">
          <div className="flex items-center gap-3">
            {(['escrow', 'confirm', 'download'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  step === s
                    ? 'bg-neutral-900 text-[#F7F4EF]'
                    : (['escrow', 'confirm', 'download'].indexOf(step) > i)
                    ? 'bg-emerald-500 text-white'
                    : 'bg-neutral-200 text-neutral-400'
                }`}>
                  {(['escrow', 'confirm', 'download'].indexOf(step) > i) ? '✓' : i + 1}
                </div>
                {i < 2 && <div className="w-6 h-px bg-neutral-200" />}
              </div>
            ))}
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900 transition-colors text-xl leading-none">
            ×
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col gap-5">

          {/* Step 1 — Lock escrow */}
          {step === 'escrow' && (
            <>
              <div>
                <h2 className="text-lg font-bold text-neutral-900 mb-1">Lock payment in escrow</h2>
                <p className="text-sm text-neutral-500">
                  Your payment is held in a smart contract. You keep control: if the code doesn&apos;t deliver, you can refund.
                </p>
              </div>
              <div className="bg-white border border-neutral-200 rounded-2xl p-4 flex items-center justify-between">
                <span className="text-sm text-neutral-500">Amount</span>
                <span className="text-xl font-bold text-neutral-900">{formatGEN(price)}</span>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}
              <button
                onClick={handleLockEscrow}
                disabled={busy}
                className="w-full bg-neutral-900 text-[#F7F4EF] font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                {busy ? 'Waiting for wallet…' : 'Lock in escrow'}
              </button>
            </>
          )}

          {/* Step 2 — Confirm purchase */}
          {step === 'confirm' && (
            <>
              <div>
                <h2 className="text-lg font-bold text-neutral-900 mb-1">Confirm your purchase</h2>
                <p className="text-sm text-neutral-500">
                  Payment is locked. Confirming releases funds to the seller and gives you the source code.
                </p>
              </div>
              <div className="bg-white border border-neutral-200 rounded-2xl p-4">
                <p className="text-xs text-neutral-400 mb-1">Escrow ID</p>
                <p className="font-mono text-xs text-neutral-700 break-all">{escrowId}</p>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{error}</p>}
              <button
                onClick={handleConfirmPurchase}
                disabled={busy}
                className="w-full bg-neutral-900 text-[#F7F4EF] font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                {busy ? 'Confirming…' : 'Confirm purchase'}
              </button>
            </>
          )}

          {/* Step 3 — Download */}
          {step === 'download' && (
            <>
              <div>
                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-2xl mb-4">✓</div>
                <h2 className="text-lg font-bold text-neutral-900 mb-1">Purchase complete</h2>
                <p className="text-sm text-neutral-500">
                  Your source code has been decrypted in your browser. Download it below.
                </p>
              </div>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={`listing-${listingId}.py`}
                  className="block w-full text-center bg-emerald-600 text-white font-semibold py-3.5 rounded-2xl hover:bg-emerald-700 transition-colors"
                >
                  Download source (.py)
                </a>
              )}
              <button
                onClick={onClose}
                className="w-full text-center text-sm text-neutral-500 hover:text-neutral-900 transition-colors py-2"
              >
                Close
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
