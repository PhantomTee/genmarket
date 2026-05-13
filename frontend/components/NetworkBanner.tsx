'use client';

import { useWallet } from '../lib/wallet-context';

export default function NetworkBanner() {
  const { isWrongNetwork, switchNetwork } = useWallet();

  if (!isWrongNetwork) return null;

  return (
    <div className="w-full bg-amber-500 text-white text-sm flex items-center justify-center gap-3 px-4 py-2.5">
      <span>⚠ Wrong network — GenMarket requires <strong>GenLayer Studionet</strong></span>
      <button
        onClick={switchNetwork}
        className="bg-white text-amber-700 font-semibold px-3 py-1 rounded-full text-xs hover:bg-amber-50 transition-colors"
      >
        Switch network
      </button>
    </div>
  );
}
