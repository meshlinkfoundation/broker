import { createPublicClient, http, type PublicClient, type Address, type Hex } from "viem";
import { optimism, optimismSepolia } from "viem/chains";

export interface ActiveNetwork {
  chainId: number;
  chainName: string;
  rpcUrl: string;
  tokenAddress: Address;
  paymentContractAddress: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  explorerUrl?: string;
  operatorWallet?: Address;
}

// The only event we need from MeshPayment — we listen for this to confirm payments.
export const meshPaymentAbi = [
  {
    type: "event",
    name: "PaymentReceived",
    inputs: [
      { name: "client", type: "address", indexed: true },
      { name: "operator", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "sessionId", type: "bytes32", indexed: true },
    ],
  },
] as const;

// Minimal ERC-20 ABI for things like reading token symbol/decimals if we want them later.
export const meshTokenAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

function pickChain(chainId: number) {
  if (chainId === optimism.id) return optimism;
  if (chainId === optimismSepolia.id) return optimismSepolia;
  // Unknown — let viem build a generic client from the RPC URL.
  return undefined;
}

export function createChainClient(network: ActiveNetwork): PublicClient {
  const chain = pickChain(network.chainId);
  return createPublicClient({
    chain,
    transport: http(network.rpcUrl),
  });
}

export type { Address, Hex };
