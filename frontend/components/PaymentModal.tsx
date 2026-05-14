'use client';

import { useState } from 'react';
import { useWallet } from '../lib/wallet-context';
import { buy, confirmPurchase, voteSeller, getEscrow } from '../lib/genlayer';
import { formatGEN } from '../lib/encryption';

interface Props {
  listingId: string;
  onchainListingId?: string;
  price: number;
  ipfsCid: string;
  listingTitle: string;
  onClose: () => void;
}

type Step = 'escrow' | 'confirm' | 'download';

interface HashInfo {
  sourceHash: string;
  verifiedHash: string;
  hashMatch: boolean | null;
}

export default function PaymentModal({
  listingId,
  onchainListingId,
  price,
  ipfsCid,
  listingTitle,
  onClose,
}: Props) {
  const { address, writeClient } = useWallet();

  const [step, setStep] = useState<Step>('escrow');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [hashInfo, setHashInfo] = useState<HashInfo | null>(null);
  const [escrowId, setEscrowId] = useState<string>('');

  const [voting, setVoting] = useState(false);
  const [voted, setVoted] = useState<'up' | 'down' | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);

  function escrowStorageKey() {
    return `genmarket_escrow_${listingId}`;
  }

  // New Marketplace contract: escrow_id === listing_id (no address guessing needed)
  async function verifyEscrowDirect(escrowId: string, buyerAddress: string): Promise<boolean> {
    if (!escrowId || !escrowId.trim()) return false;
    try {
      const escrow = await getEscrow(escrowId.trim());
      if (!escrow) return false;
      if (String(escrow.buyer).toLowerCase() !== String(buyerAddress).toLowerCase()) return false;
      if (escrow.status !== 'locked') return false;
      return true;
    } catch {
      return false;
    }
  }

  async function handlePayIntoEscrow() {
    if (!writeClient || !address) {
      setError('Connect your wallet first.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const chainId =
        onchainListingId || (/^[0-9]+$/.test(listingId) ? listingId : '');

      if (!chainId) {
        throw new Error('Listing is not linked to an on-chain id yet.');
      }

      localStorage.removeItem(escrowStorageKey());
      setEscrowId('');

      const returnedEscrowId = await buy(writeClient, chainId, BigInt(price), address);

      // New contract: escrow_id === on-chain listing_id === chainId.
      // Do NOT use returnedEscrowId — extractReturnValue reads receipt metadata
      // (e.g. tx nonce) that can be mistaken for the return value.
      // chainId is authoritative: we sent it to buy(), contract echoes it back.
      const finalEscrowId = chainId;

      setEscrowId(finalEscrowId);
      localStorage.setItem(escrowStorageKey(), finalEscrowId);
      setStep('confirm');
    } catch (e: any) {
      setError(e.message || 'Failed to pay into escrow');
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmPurchase() {
    if (!writeClient || !address) {
      setError('Connect your wallet first.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const savedEscrowId =
        escrowId || localStorage.getItem(escrowStorageKey()) || '';

      if (!savedEscrowId) {
        throw new Error('No verified escrow found. Pay into escrow first.');
      }

      // Verify the escrow directly — new contract uses listing_id as escrow_id
      const escrow = await getEscrow(savedEscrowId);

      if (!escrow) {
        localStorage.removeItem(escrowStorageKey());
        setEscrowId('');
        setStep('escrow');
        throw new Error('Escrow not found on-chain. Please pay into escrow again.');
      }

      if (String(escrow.buyer).toLowerCase() !== String(address).toLowerCase()) {
        throw new Error('This escrow belongs to a different buyer wallet.');
      }

      if (escrow.status !== 'locked') {
        throw new Error(`Escrow is not locked. Current status: ${escrow.status}`);
      }

      // ── Step 1: Confirm on-chain first ──────────────────────────────────
      // The escrow transitions locked → released on-chain. The backend will
      // refuse to decrypt until it sees 'locked' or 'released' on-chain.
      await confirmPurchase(writeClient, savedEscrowId);

      // ── Step 2: Backend delivers source only after on-chain proof ────────
      const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL;

      if (!backendUrl) {
        throw new Error('NEXT_PUBLIC_BACKEND_URL is not configured');
      }

      const res = await fetch(`${backendUrl}/api/payments/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listing_id: listingId,
          onchain_listing_id: onchainListingId,
          escrow_id: savedEscrowId,
          buyer_address: address,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to confirm purchase');
      }

      const { sourceCode, sourceHash, verifiedHash, hashMatch } = await res.json();

      const blob = new Blob([sourceCode], { type: 'text/x-python' });
      setDownloadUrl(URL.createObjectURL(blob));
      setHashInfo({ sourceHash, verifiedHash, hashMatch });

      try {
        const storedRaw = JSON.parse(localStorage.getItem('purchases') ?? '[]');
        const stored = Array.isArray(storedRaw) ? storedRaw : [];

        const updated = [
          ...stored.filter((p: any) => p.listing_id !== listingId),
          {
            listing_id: listingId,
            title: listingTitle,
            price,
            ipfs_cid: ipfsCid,
            escrow_id: savedEscrowId,
            source_hash: sourceHash,
            // Store the decrypted source so the dashboard can re-download it
            // without needing to call the backend again.
            sourceCode,
          },
        ];

        localStorage.setItem('purchases', JSON.stringify(updated));
      } catch {
        // Non-fatal
      }

      setEscrowId(savedEscrowId);
      setStep('download');
    } catch (e: any) {
      setError(e.message || 'Failed to confirm purchase');
    } finally {
      setBusy(false);
    }
  }

  async function handleVote(isUpvote: boolean) {
    if (!writeClient) return;

    setVoting(true);
    setVoteError(null);

    try {
      const savedEscrowId =
        escrowId || localStorage.getItem(escrowStorageKey()) || '';

      if (!savedEscrowId) {
        throw new Error('No escrow found for this purchase.');
      }

      await voteSeller(writeClient, savedEscrowId, isUpvote);
      setVoted(isUpvote ? 'up' : 'down');
    } catch (e: any) {
      setVoteError(e.message || 'Failed to vote');
    } finally {
      setVoting(false);
    }
  }

  const shownEscrowId = escrowId || 'Verified after payment';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-[#F7F4EF] dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-t-3xl sm:rounded-3xl w-full sm:max-w-md shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-200 dark:border-neutral-700">
          <div className="flex items-center gap-2">
            {(['escrow', 'confirm', 'download'] as Step[]).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    step === s
                      ? 'bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900'
                      : (['escrow', 'confirm', 'download'].indexOf(step) > i)
                        ? 'bg-emerald-500 text-white'
                        : 'bg-neutral-200 dark:bg-neutral-700 text-neutral-400 dark:text-neutral-500'
                  }`}
                >
                  {(['escrow', 'confirm', 'download'].indexOf(step) > i) ? '✓' : i + 1}
                </div>
                {i < 2 && <div className="w-6 h-px bg-neutral-200 dark:bg-neutral-700" />}
              </div>
            ))}
          </div>

          <button
            onClick={onClose}
            className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-6 flex flex-col gap-5">
          {step === 'escrow' && (
            <>
              <div>
                <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-1">
                  Pay into escrow
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  This calls the buy function and locks your payment in the marketplace contract.
                </p>
              </div>

              <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-4 flex items-center justify-between">
                <span className="text-sm text-neutral-500 dark:text-neutral-400">Amount</span>
                <span className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                  {formatGEN(price)}
                </span>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                  {error}
                </p>
              )}

              <button
                onClick={handlePayIntoEscrow}
                disabled={busy}
                className="w-full bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                {busy ? 'Waiting for wallet…' : 'Pay into escrow'}
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <div>
                <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-1">
                  Release payment & download
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  This releases escrow to the seller and delivers the source code to you.
                </p>
              </div>

              <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-4">
                <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-1">
                  Verified Escrow ID
                </p>
                <p className="font-mono text-xs text-neutral-700 dark:text-neutral-300 break-all">
                  {shownEscrowId}
                </p>
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">
                  {error}
                </p>
              )}

              <button
                onClick={handleConfirmPurchase}
                disabled={busy}
                className="w-full bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 font-semibold py-3.5 rounded-2xl hover:bg-neutral-700 transition-colors disabled:opacity-50"
              >
                {busy ? 'Confirming…' : 'Release payment & download'}
              </button>
            </>
          )}

          {step === 'download' && (
            <>
              <div>
                <div className="w-12 h-12 bg-emerald-100 rounded-2xl flex items-center justify-center text-2xl mb-4">
                  ✓
                </div>
                <h2 className="text-lg font-bold text-neutral-900 dark:text-neutral-100 mb-1">
                  Purchase complete
                </h2>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                  Source code delivered. Download it below.
                </p>
              </div>

              {hashInfo && (
                <div
                  className={`rounded-xl p-3 border text-xs font-mono break-all ${
                    hashInfo.hashMatch === true
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : hashInfo.hashMatch === false
                        ? 'bg-red-50 border-red-200 text-red-800'
                        : 'bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  <p className="font-sans font-semibold mb-1">
                    {hashInfo.hashMatch === true
                      ? '✓ Hash verified'
                      : hashInfo.hashMatch === false
                        ? '⚠ Hash mismatch'
                        : 'SHA-256'}
                  </p>
                  <p className="opacity-75 break-all">{hashInfo.verifiedHash}</p>
                </div>
              )}

              {downloadUrl && (
                <a
                  href={downloadUrl}
                  download={`listing-${listingId}.py`}
                  className="block w-full text-center bg-emerald-600 text-white font-semibold py-3.5 rounded-2xl hover:bg-emerald-700 transition-colors"
                >
                  Download source (.py)
                </a>
              )}

              <div className="border-t border-neutral-200 dark:border-neutral-700 pt-4">
                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-3">
                  Did the full source match the preview?
                </p>

                {voted ? (
                  <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                    {voted === 'up'
                      ? '👍 Thanks for your feedback!'
                      : '👎 Thanks — your vote helps future buyers.'}
                  </p>
                ) : (
                  <div className="flex gap-3">
                    <button
                      onClick={() => handleVote(true)}
                      disabled={voting}
                      className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:border-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-neutral-700 dark:text-neutral-300 font-medium py-3 rounded-2xl transition-colors disabled:opacity-50 text-sm"
                    >
                      👍 Yes, it matched
                    </button>

                    <button
                      onClick={() => handleVote(false)}
                      disabled={voting}
                      className="flex-1 flex items-center justify-center gap-2 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 hover:border-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 text-neutral-700 dark:text-neutral-300 font-medium py-3 rounded-2xl transition-colors disabled:opacity-50 text-sm"
                    >
                      👎 No, it didn&apos;t
                    </button>
                  </div>
                )}

                {voteError && <p className="mt-2 text-xs text-red-600">{voteError}</p>}
              </div>

              <button
                onClick={onClose}
                className="w-full text-center text-sm text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 transition-colors py-2"
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