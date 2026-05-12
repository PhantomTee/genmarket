'use client';

import { WalletProvider } from '../lib/wallet-context';
import { ToastProvider } from '../components/Toast';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WalletProvider>
      <ToastProvider>{children}</ToastProvider>
    </WalletProvider>
  );
}
