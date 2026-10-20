import { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { initAppKit, getWagmiConfig } from "./wagmi-config";

interface Web3ProviderProps {
  projectId: string;
  mode: "sandbox" | "production";
  children: ReactNode;
}

export function Web3Provider({ projectId, mode, children }: Web3ProviderProps) {
  // Initialize synchronously on first render. The adapter is a singleton
  // so subsequent renders / Strict Mode double-invocation are idempotent.
  initAppKit({ projectId, mode });

  return <WagmiProvider config={getWagmiConfig()}>{children}</WagmiProvider>;
}
