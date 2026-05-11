'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { createClient } from 'genlayer-js';
import { connectWallet } from './genlayer';

interface WalletContextValue {
  address: `0x${string}` | null;
  writeClient: ReturnType<typeof createClient> | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  connecting: boolean;
}

const WalletContext = createContext<WalletContextValue>({
  address: null,
  writeClient: null,
  connect: async () => {},
  disconnect: () => {},
  connecting: false,
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [writeClient, setWriteClient] = useState<ReturnType<typeof createClient> | null>(null);
  const [connecting, setConnecting] = useState(false);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const result = await connectWallet();
      setAddress(result.address);
      setWriteClient(result.writeClient);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setWriteClient(null);
  }, []);

  return (
    <WalletContext.Provider value={{ address, writeClient, connect, disconnect, connecting }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
