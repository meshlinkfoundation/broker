import { Wallet, getEncodedToken } from "@cashu/cashu-ts";
import { randomBytes } from "crypto";

async function main() {
  const mint = process.argv[2] || "http://10.99.98.2:8383";
  const amount = Number(process.argv[3] || 1);
  const encodedMint = process.argv[4] || mint;
  const wallet = new Wallet(mint, {
    unit: "sat",
    bip39seed: new Uint8Array(randomBytes(32)),
  });
  await wallet.loadMint();
  const quote = await wallet.createMintQuoteBolt11(amount);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const status = await wallet.checkMintQuoteBolt11(quote.quote);
    if (status.state === "PAID") break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const proofs = await wallet.mintProofsBolt11(amount, quote.quote);
  process.stdout.write(getEncodedToken({ mint: encodedMint, proofs, unit: "sat" }) + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
