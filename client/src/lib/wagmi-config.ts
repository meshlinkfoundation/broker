import { createAppKit } from "@reown/appkit/react";
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi";
import { optimism, optimismSepolia } from "@reown/appkit/networks";

// Pulled from /api/config at runtime so the captive portal can switch modes
// without a frontend rebuild. We initialize AppKit lazily after we read the
// active network from the broker.

let appKitInitialized = false;
let wagmiAdapter: WagmiAdapter | null = null;

export interface AppKitInitOptions {
  projectId: string;
  mode: "sandbox" | "production";
}

export function initAppKit(opts: AppKitInitOptions) {
  if (appKitInitialized) return wagmiAdapter!;

  // Always include both mainnet + testnet so users can switch chains in their wallet
  // if needed. The captive portal nudges them to the correct one based on mode.
  const networks = [optimism, optimismSepolia] as const;

  wagmiAdapter = new WagmiAdapter({
    networks: [...networks],
    projectId: opts.projectId,
    ssr: false,
  });

  createAppKit({
    adapters: [wagmiAdapter],
    networks: [...networks],
    projectId: opts.projectId,
    metadata: {
      name: "meshlink Wi-Fi Access Portal",
      description: "Decentralized WiFi powered by MESH on Optimism",
      url: typeof window !== "undefined" ? window.location.origin : "https://localhost",
      icons: [],
    },
    defaultNetwork: opts.mode === "production" ? optimism : optimismSepolia,
    // Show the wallets portal customers are most likely to have at the top of the modal.
    // The QR code option will appear prominently for any other WalletConnect-compatible wallet.
    featuredWalletIds: [
      // Rainbow
      "1ae92b26df02f0abca6304df07debccd18262fdf5fe82daa81593582dac9a369",
      // MetaMask
      "c57ca95b47569778a828d19178114f4db188b89b763c899ba0be274e97267d96",
      // Coinbase Wallet
      "fd20dc426fb37566d803205b19bbc1d4096b248ac04548e3cfb6b3a38bd033aa",
      // Trust Wallet
      "4622a2b2d6af1c9844944291e5e7351a6aa24cd7b23099efac1b2fd875da31a0",
    ],
    features: {
      analytics: false,
      email: false,
      socials: [],
    },
  });

  appKitInitialized = true;
  return wagmiAdapter;
}

export function getWagmiConfig() {
  if (!wagmiAdapter) {
    throw new Error("AppKit not initialized — call initAppKit() first");
  }
  return wagmiAdapter.wagmiConfig;
}
