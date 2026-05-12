'use client';

import { WalletProvider } from '../lib/wallet-context';
import { ToastProvider } from '../components/Toast';
import { ThemeProvider } from '../lib/theme-context';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <WalletProvider>
        <ToastProvider>{children}</ToastProvider>
      </WalletProvider>
    </ThemeProvider>
  );
}
