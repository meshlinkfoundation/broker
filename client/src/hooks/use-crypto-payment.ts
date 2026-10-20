import { useState } from "react";
import { useAccount, useSignTypedData, useWriteContract } from "wagmi";
import { createPublicClient, http } from "viem";
import { optimism, optimismSepolia } from "viem/chains";
import { parseSignature, type Address, type Hex } from "viem";

// Minimal ABIs for the calls we make from the captive portal.
const meshPaymentAbi = [
  {
    type: "function",
    name: "payWithPermit",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "sessionId", type: "bytes32" },
      { name: "deadline", type: "uint256" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
] as const;

const meshTokenAbi = [
  {
    type: "function",
    name: "nonces",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface PaymentNetwork {
  chainId: number;
  tokenAddress: Address;
  paymentContractAddress: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  explorerUrl?: string;
}

export interface PaymentStatus {
  step: "idle" | "signing" | "sending" | "confirming" | "granted" | "failed" | "expired";
  txHash?: Hex;
  error?: string;
  sessionId?: Hex;
}

export function useCryptoPayment() {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const [status, setStatus] = useState<PaymentStatus>({ step: "idle" });

  async function payForTier(tierId: string, network: PaymentNetwork) {
    if (!address) throw new Error("Wallet not connected");
    if (!network) throw new Error("Network not configured");

    setStatus({ step: "signing" });

    try {
      // 1. Ask the broker for a session — it generates sessionId + tells us how much to pay.
      const sessionRes = await fetch("/api/payment/crypto/create-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId }),
      });
      if (!sessionRes.ok) {
        const err = await sessionRes.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create session");
      }
      const session = (await sessionRes.json()) as {
        sessionId: Hex;
        amount: string;
        operatorWallet: Address;
        paymentContractAddress: Address;
        tokenAddress: Address;
        chainId: number;
        explorerUrl?: string;
      };
      const amount = BigInt(session.amount);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60); // 30 min validity

      // 2. Read the current nonce from the correct chain — not the wallet's active chain,
      //    which may be mainnet. Always use the network the contract is deployed on.
      const chain = network.chainId === optimism.id ? optimism : optimismSepolia;
      const readClient = createPublicClient({ chain, transport: http() });
      const nonce = (await readClient.readContract({
        address: network.tokenAddress,
        abi: meshTokenAbi,
        functionName: "nonces",
        args: [address],
      })) as bigint;

      // 3. EIP-712 permit signature — approves the payment contract to spend `amount` MESH.
      const signature = await signTypedDataAsync({
        domain: {
          name: "meshlink Wi-Fi Access Portal",
          version: "1",
          chainId: session.chainId,
          verifyingContract: session.tokenAddress,
        },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: {
          owner: address,
          spender: session.paymentContractAddress,
          value: amount,
          nonce,
          deadline,
        },
      });

      const { v, r, s } = parseSignature(signature);

      setStatus({ step: "sending", sessionId: session.sessionId });

      // 4. Submit payWithPermit — one transaction does approve+pay.
      const txHash = await writeContractAsync({
        address: session.paymentContractAddress,
        abi: meshPaymentAbi,
        functionName: "payWithPermit",
        args: [
          session.operatorWallet,
          amount,
          session.sessionId,
          deadline,
          Number(v),
          r,
          s,
        ],
      });

      setStatus({ step: "confirming", txHash, sessionId: session.sessionId });

      // 5. Poll the broker for grant confirmation. Broker confirms once it sees
      //    the PaymentReceived event AND grants ipset access.
      const startedAt = Date.now();
      while (Date.now() - startedAt < 60_000) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const r = await fetch(`/api/payment/crypto/session/${session.sessionId}`);
        if (!r.ok) continue;
        const sess = (await r.json()) as { status: string };
        if (sess.status === "granted") {
          setStatus({ step: "granted", txHash, sessionId: session.sessionId });
          return { txHash, sessionId: session.sessionId };
        }
        if (sess.status === "expired") {
          setStatus({ step: "expired", txHash, sessionId: session.sessionId, error: "Session expired" });
          throw new Error("Session expired before payment confirmation");
        }
      }
      throw new Error("Timed out waiting for confirmation");
    } catch (err: any) {
      setStatus((s) => ({ ...s, step: "failed", error: err.message || "Payment failed" }));
      throw err;
    }
  }

  return { status, payForTier };
}
