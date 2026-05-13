'use client';

import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { connectWallet } from './genlayer';

const STUDIONET_CHAIN_ID = 61999; // 0xF22F

interface WalletContextValue {
  address: `0x${string}` | null;
  writeClient: ReturnType<typeof createClient> | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  connecting: boolean;
  chainId: number | null;
  isWrongNetwork: boolean;
  switchNetwork: () => Promise<void>;
}

const WalletContext = createContext<WalletContextValue>({
  address: null,
  writeClient: null,
  connect: async () => {},
  disconnect: () => {},
  connecting: false,
  chainId: null,
  isWrongNetwork: false,
  switchNetwork: async () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [writeClient, setWriteClient] = useState<ReturnType<typeof createClient> | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [chainId, setChainId] = useState<number | null>(null);

  const isWrongNetwork = address !== null && chainId !== null && chainId !== STUDIONET_CHAIN_ID;

  const switchNetwork = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0xF22F' }],
      });
    } catch (switchErr: any) {
      // Chain not added yet — add it
      if (switchErr.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0xF22F',
            chainName: 'Genlayer Studio Network',
            nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
            rpcUrls: ['https://studio.genlayer.com/api'],
          }],
        });
      }
    }
  }, []);

  // Auto-reconnect on mount using already-granted permissions (no popup)
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;

    eth.request({ method: 'eth_chainId' }).then((hex: string) => {
      setChainId(parseInt(hex, 16));
    }).catch(() => {});

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

    const onChainChanged = (hex: string) => {
      setChainId(parseInt(hex, 16));
    };

    eth.on('accountsChanged', onAccountsChanged);
    eth.on('chainChanged', onChainChanged);
    return () => {
      eth.removeListener('accountsChanged', onAccountsChanged);
      eth.removeListener('chainChanged', onChainChanged);
    };
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
    <WalletContext.Provider value={{ address, writeClient, connect, disconnect, connecting, chainId, isWrongNetwork, switchNetwork }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
