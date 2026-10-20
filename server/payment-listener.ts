import type { PublicClient, Address, Hex } from "viem";
import { meshPaymentAbi, type ActiveNetwork } from "./chain-client";

export interface PaymentEvent {
  client: Address;
  operator: Address;
  amount: bigint;
  sessionId: Hex;
  txHash: Hex;
  blockNumber: bigint;
}

export type PaymentHandler = (event: PaymentEvent) => Promise<void> | void;

// Watches the configured MeshPayment contract for PaymentReceived events.
// Uses viem's watchContractEvent which polls under the hood with HTTP transports.
export function startPaymentListener(
  client: PublicClient,
  network: ActiveNetwork,
  onPayment: PaymentHandler,
): () => void {
  console.log(
    `[PaymentListener] Watching ${network.chainName} ` +
      `MeshPayment ${network.paymentContractAddress} for PaymentReceived events`,
  );

  const unwatch = client.watchContractEvent({
    address: network.paymentContractAddress,
    abi: meshPaymentAbi,
    eventName: "PaymentReceived",
    onLogs: async (logs) => {
      for (const log of logs) {
        const { client: payer, operator, amount, sessionId } = log.args as {
          client: Address;
          operator: Address;
          amount: bigint;
          sessionId: Hex;
        };

        const event: PaymentEvent = {
          client: payer,
          operator,
          amount,
          sessionId,
          txHash: log.transactionHash!,
          blockNumber: log.blockNumber!,
        };

        try {
          await onPayment(event);
        } catch (err) {
          console.error(`[PaymentListener] handler error for tx ${event.txHash}:`, err);
        }
      }
    },
    onError: (err) => {
      console.error("[PaymentListener] watch error:", err);
    },
  });

  return unwatch;
}
