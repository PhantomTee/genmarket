'use client';

import { useWallet } from '../lib/wallet-context';
import ThemeToggle from './ThemeToggle';

function truncate(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function WalletConnect() {
  const { address, connect, disconnect, connecting } = useWallet();

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <span className="font-mono text-xs bg-stone-100 dark:bg-neutral-800 border border-stone-200 dark:border-neutral-700 px-3 py-1.5 rounded-full text-stone-700 dark:text-stone-300">
          {truncate(address)}
        </span>
        <button
          onClick={disconnect}
          className="text-xs text-stone-400 dark:text-stone-500 hover:text-stone-700 dark:hover:text-stone-300 transition-colors"
          title="Disconnect wallet"
        >
          <span className="hidden sm:inline">Disconnect</span>
          <span className="sm:hidden text-base leading-none">×</span>
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <ThemeToggle />
      <button
        onClick={connect}
        disabled={connecting}
        className="bg-neutral-900 text-[#F7F4EF] dark:bg-neutral-100 dark:text-neutral-900 text-sm font-medium px-4 py-2 rounded-full hover:bg-neutral-700 dark:hover:bg-neutral-200 transition-colors disabled:opacity-50"
      >
        {connecting ? 'Connecting…' : 'Connect Wallet'}
      </button>
    </div>
  );
}
