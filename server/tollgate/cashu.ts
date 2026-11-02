import { Wallet, getDecodedToken } from "@cashu/cashu-ts";

export interface ReceivedPayment {
  amount: number;
  proofs: unknown[];
}

function amountNumber(value: any): number {
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Number(value || 0);
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export class CashuReceiver {
  private wallet: Wallet;
  private loaded = false;
  private readonly mintUrl: string;

  constructor(mintUrl: string) {
    this.mintUrl = normalizeUrl(mintUrl);
    this.wallet = new Wallet(this.mintUrl);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.wallet.loadMint();
    this.loaded = true;
  }

  private decode(token: string) {
    const keysetIds = this.wallet.keyChain.getAllKeysetIds();
    return getDecodedToken(token.trim(), keysetIds);
  }

  async inspect(token: string): Promise<{ amount: number; mint: string }> {
    await this.ensureLoaded();
    const decoded = this.decode(token);
    if (!Array.isArray(decoded.proofs) || decoded.proofs.length === 0) {
      throw new Error("token has no proofs");
    }
    const amount = decoded.proofs.reduce(
      (sum, proof) => sum + amountNumber((proof as any).amount),
      0,
    );
    return { amount, mint: normalizeUrl(decoded.mint) };
  }

  async receive(token: string): Promise<ReceivedPayment> {
    await this.ensureLoaded();
    const decoded = this.decode(token);

    if (normalizeUrl(decoded.mint) !== this.mintUrl) {
      throw new Error("token mint does not match this merchant");
    }
    if (!Array.isArray(decoded.proofs) || decoded.proofs.length === 0) {
      throw new Error("token has no proofs");
    }

    const amount = decoded.proofs.reduce(
      (sum, proof) => sum + amountNumber((proof as any).amount),
      0,
    );
    const proofs = await this.wallet.receive(decoded);
    return { amount, proofs };
  }
}
