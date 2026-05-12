'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
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

  // Auto-reconnect on mount using already-granted permissions (no popup)
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;

    eth.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (!accounts[0]) return;
      const addr = accounts[0] as `0x${string}`;
      const client = createClient({ chain: studionet, account: addr, provider: eth });
      setAddress(addr);
      setWriteClient(client);
    }).catch(() => {});

    const onAccountsChanged = (accounts: string[]) => {
      if (accounts[0]) {
        const addr = accounts[0] as `0x${string}`;
        const client = createClient({ chain: studionet, account: addr, provider: eth });
        setAddress(addr);
        setWriteClient(client);
      } else {
        setAddress(null);
        setWriteClient(null);
      }
    };

    eth.on('accountsChanged', onAccountsChanged);
    return () => eth.removeListener('accountsChanged', onAccountsChanged);
  }, []);

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
