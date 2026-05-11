'use client';

import { useWallet } from '../lib/wallet-context';

function truncate(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function WalletConnect() {
  const { address, connect, disconnect, connecting } = useWallet();

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs bg-stone-100 border border-stone-200 px-3 py-1.5 rounded-full text-stone-700">
          {truncate(address)}
        </span>
        <button
          onClick={disconnect}
          className="text-xs text-stone-400 hover:text-stone-700 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={connecting}
      className="bg-neutral-900 text-[#F7F4EF] text-sm font-medium px-4 py-2 rounded-full hover:bg-neutral-700 transition-colors disabled:opacity-50"
    >
      {connecting ? 'Connecting…' : 'Connect Wallet'}
    </button>
  );
}
