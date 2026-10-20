import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { useAppKit } from "@reown/appkit/react";

// Drop-in replacement for the previous mock useWallet().
// All consumers should keep working with the same shape — just wired to real wagmi now.
export function useWallet() {
  const { address, isConnected, isConnecting } = useAccount();
  const chainId = useChainId();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { open } = useAppKit();

  return {
    wallet: {
      address: address ?? null,
      isConnected,
      chainId: chainId ?? null,
    },
    isConnecting,
    error: null as string | null,
    connectWallet: async () => {
      // Opens the AppKit modal — handles QR, deep links, browser extensions.
      await open();
      return address ?? null;
    },
    disconnectWallet: async () => {
      disconnect();
    },
    switchNetwork: async (targetChainId: number) => {
      switchChain({ chainId: targetChainId });
    },
    getCurrentNetwork: () => {
      if (!chainId) return null;
      if (chainId === 10) return { chainId: 10, name: "Optimism", gasPrice: "0.000005", confirmationTime: 3 };
      if (chainId === 11155420) return { chainId: 11155420, name: "OP Sepolia", gasPrice: "0.000005", confirmationTime: 3 };
      return { chainId, name: `Chain ${chainId}`, gasPrice: "?", confirmationTime: 3 };
    },
    getAvailableNetworks: () => [
      { chainId: 10, name: "Optimism", gasPrice: "0.000005", confirmationTime: 3 },
      { chainId: 11155420, name: "OP Sepolia", gasPrice: "0.000005", confirmationTime: 3 },
    ],
  };
}
