import { useState, useEffect } from "react";
import { web3Provider, type MockWallet } from "@/lib/web3-mock";

export function useWallet() {
  const [wallet, setWallet] = useState<MockWallet>(web3Provider.getWallet());
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectWallet = async () => {
    try {
      setIsConnecting(true);
      setError(null);
      
      const address = await web3Provider.connectWallet();
      setWallet(web3Provider.getWallet());
      
      return address;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to connect wallet";
      setError(errorMessage);
      throw err;
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnectWallet = async () => {
    try {
      await web3Provider.disconnectWallet();
      setWallet(web3Provider.getWallet());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to disconnect wallet";
      setError(errorMessage);
    }
  };

  const switchNetwork = async (chainId: number) => {
    try {
      setError(null);
      await web3Provider.switchNetwork(chainId);
      setWallet(web3Provider.getWallet());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to switch network";
      setError(errorMessage);
      throw err;
    }
  };

  const getCurrentNetwork = () => {
    return web3Provider.getCurrentNetwork();
  };

  const getAvailableNetworks = () => {
    return web3Provider.getNetworks();
  };

  // Update wallet state when provider changes
  useEffect(() => {
    const interval = setInterval(() => {
      const currentWallet = web3Provider.getWallet();
      setWallet(prevWallet => {
        if (JSON.stringify(prevWallet) !== JSON.stringify(currentWallet)) {
          return currentWallet;
        }
        return prevWallet;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return {
    wallet,
    isConnecting,
    error,
    connectWallet,
    disconnectWallet,
    switchNetwork,
    getCurrentNetwork,
    getAvailableNetworks,
  };
}
