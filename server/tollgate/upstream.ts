import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { Wallet, getEncodedToken } from "@cashu/cashu-ts";
import { installUpstreamRoute, removeUpstreamRoute, DEFAULT_ROUTE_TABLE } from "./upstream-route";

const execFileAsync = promisify(execFile);

export interface UpstreamConfig {
  enabled: boolean;
  url: string;
  unit: string;
  steps: number;
  maxPricePerStep: number;
  maxCostPerMinute: number;
  dailyBudget: number;
  renewAtPercent: number;
  autoMint: boolean;
  pollIntervalMs: number;
  routeThrough: boolean;
  routeTable: number;
  routeNexthop: string;
  guestInterface: string;
  dataDir: string;
}

export interface UpstreamOffer {
  gateway: string;
  metric: "milliseconds" | "bytes";
  stepSize: number;
  unit: string;
  pricePerStep: number;
  mintUrl: string;
  minSteps: number;
}

export interface UpstreamGrant {
  allotment: number;
  metric: string;
  deviceIdentifier?: string;
  code?: string;
}

function amountNumber(value: any): number {
  if (value && typeof value.toNumber === "function") return value.toNumber();
  return Number(value || 0);
}

const REFUSED_CODES = new Set([
  "invalid-mac-address",
  "payment-error-invalid-token",
  "payment-error-below-swap-fee",
  "payment-processing-failed",
  "session-error",
]);
const RETRYABLE_CODES = new Set([
  "device-unresolved",
  "client-not-registered",
  "mint-rate-limited",
  "payment-error-mint-unreachable",
  "service-unavailable",
  "starting",
]);
const LOST_CODES = new Set(["payment-error-token-spent", "payment-error-keyset-expired"]);

export function loadUpstreamConfig(dataDir: string): UpstreamConfig {
  let file: any = {};
  try {
    const configPath = path.join(process.cwd(), "server", "config", "meshlink-config.json");
    file = JSON.parse(fs.readFileSync(configPath, "utf8")).upstream ?? {};
  } catch {
    // Defaults below.
  }
  return {
    enabled: String(process.env.MESHLINK_UPSTREAM_ENABLED ?? file.enabled ?? false) === "true",
    url: String(process.env.MESHLINK_UPSTREAM_URL || file.url || ""),
    unit: String(file.unit || "sat"),
    steps: Math.max(1, Number(file.steps) || 1),
    maxPricePerStep: Math.max(1, Number(file.maxPricePerStep) || 10),
    maxCostPerMinute: Math.max(0, Number(file.maxCostPerMinute) || 2),
    dailyBudget: Math.max(1, Number(file.dailyBudget) || 100),
    renewAtPercent: Math.min(95, Math.max(50, Number(file.renewAtPercent) || 80)),
    autoMint: String(process.env.MESHLINK_UPSTREAM_AUTO_MINT ?? file.autoMint ?? false) === "true",
    pollIntervalMs: Math.max(10_000, (Number(file.pollIntervalMs) || 60) * 1000),
    routeThrough: String(process.env.MESHLINK_UPSTREAM_ROUTE_THROUGH ?? file.routeThrough ?? false) === "true",
    routeTable: Math.max(1, Number(file.routeTable) || DEFAULT_ROUTE_TABLE),
    routeNexthop: String(process.env.MESHLINK_UPSTREAM_ROUTE_NEXTHOP ?? file.routeNexthop ?? ""),
    guestInterface: String(file.guestInterface || "br-guest"),
    dataDir,
  };
}

export function parseAdvertisement(event: any, gateway: string): UpstreamOffer {
  if (!event || event.kind !== 10021 || !Array.isArray(event.tags)) {
    throw new Error("not a TollGate kind:10021 advertisement");
  }
  let metric: UpstreamOffer["metric"] | null = null;
  let stepSize = 0;
  const offers: UpstreamOffer[] = [];

  for (const tag of event.tags) {
    const name = Array.isArray(tag) ? tag[0] : "";
    if (name === "metric") {
      if (tag[1] === "milliseconds" || tag[1] === "bytes") metric = tag[1];
    } else if (name === "step_size") {
      stepSize = Number.parseInt(tag[1], 10) || 0;
    } else if (name === "price_per_step" && tag.length >= 6 && tag[1] === "cashu") {
      const price = Number.parseInt(tag[2], 10) || 0;
      const unit = tag[3] === "sats" ? "sat" : String(tag[3] || "");
      const mintUrl = String(tag[4] || "").trim().replace(/\/+$/, "");
      const minSteps = Math.max(1, Number.parseInt(tag[5], 10) || 1);
      if (price > 0 && unit && mintUrl) {
        offers.push({ gateway, metric: metric || "milliseconds", stepSize, unit, pricePerStep: price, mintUrl, minSteps });
      }
    }
  }
  if (!metric || stepSize <= 0 || offers.length === 0) {
    throw new Error("advertisement has no usable Cashu offer");
  }
  return offers[0];
}

async function defaultGateway(): Promise<string> {
  try {
    const { stdout } = await execFileAsync("/usr/sbin/ip", ["route", "show", "default"]);
    const match = stdout.match(/default via (\S+)/);
    if (match) return match[1];
  } catch {
    // Fall through.
  }
  throw new Error("could not find a default gateway for TollGate discovery");
}

function safeRead<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"), (key, value) =>
      key === "amount" && typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value,
    ) as T;
  } catch {
    return fallback;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(
    file,
    JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item), 2) + "\n",
    { mode: 0o600 },
  );
}

export class UpstreamWallet {
  private wallet: Wallet;
  private proofs: any[] = [];
  private readonly proofsPath: string;
  private readonly statePath: string;
  private readonly config: UpstreamConfig;
  private loaded = false;

  constructor(config: UpstreamConfig, mintUrl: string) {
    this.config = config;
    this.wallet = new Wallet(mintUrl);
    const dir = path.resolve(process.cwd(), config.dataDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.proofsPath = path.join(dir, "upstream-proofs.json");
    this.statePath = path.join(dir, "upstream-state.json");
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.wallet.loadMint();
    this.proofs = safeRead<any[]>(this.proofsPath, []);
    this.loaded = true;
  }

  balance(): number {
    return this.proofs.reduce((sum, proof) => sum + amountNumber(proof.amount), 0);
  }

  private saveProofs(): void {
    writeJson(this.proofsPath, this.proofs);
  }

  private spendState(): { day: string; spent: number } {
    const today = new Date().toISOString().slice(0, 10);
    const state = safeRead<{ day: string; spent: number }>(this.statePath, { day: today, spent: 0 });
    return state.day === today ? state : { day: today, spent: 0 };
  }

  spentToday(): number {
    return this.spendState().spent;
  }

  private recordSpend(amount: number): void {
    const state = this.spendState();
    writeJson(this.statePath, { day: state.day, spent: state.spent + amount });
  }

  async fund(amount: number): Promise<void> {
    await this.ensureLoaded();
    let missing = amount - this.balance();
    if (missing <= 0) return;
    if (!this.config.autoMint) {
      throw new Error(`insufficient upstream wallet balance: need ${amount}, have ${this.balance()}`);
    }

    const quote = await this.wallet.createMintQuoteBolt11(missing);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const status = await this.wallet.checkMintQuoteBolt11(quote.quote);
      if (status.state === "PAID") break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const fresh = await this.wallet.mintProofsBolt11(missing, quote);
    this.proofs.push(...fresh);
    this.saveProofs();
  }

  async makeToken(amount: number): Promise<{ token: string; sentProofs: any[] }> {
    await this.fund(amount);
    const { send, keep } = await this.wallet.send(amount, this.proofs, { includeFees: true });
    this.proofs = keep;
    this.saveProofs();
    this.recordSpend(amount);
    return {
      token: getEncodedToken({ mint: this.wallet.mint.mintUrl, proofs: send, unit: this.config.unit }),
      sentProofs: send,
    };
  }

  async proofsSpent(proofs: any[]): Promise<boolean | null> {
    try {
      const states = await this.wallet.checkProofsStates(proofs);
      if (states.some((state: any) => state.state === "SPENT")) return true;
      if (states.every((state: any) => state.state === "UNSPENT")) return false;
      return null;
    } catch {
      return null;
    }
  }
}

async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function discover(url: string, config: UpstreamConfig): Promise<UpstreamOffer> {
  const base = (url || `http://${await defaultGateway()}:2121`).replace(/\/+$/, "");
  const response = await fetchJson(`${base}/`, {}, 5000);
  if (!response.ok) throw new Error(`advert probe answered HTTP ${response.status}`);
  return parseAdvertisement(await response.json(), base);
}

export class UpstreamClient {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly config: UpstreamConfig;
  private wallet: UpstreamWallet | null = null;
  private offer: UpstreamOffer | null = null;
  status: any = { state: "idle", purchases: 0 };

  constructor(config: UpstreamConfig) {
    this.config = config;
  }

  async discover(): Promise<UpstreamOffer> {
    this.offer = await discover(this.config.url, this.config);
    return this.offer;
  }

  private async walletFor(offer: UpstreamOffer): Promise<UpstreamWallet> {
    if (!this.wallet) this.wallet = new UpstreamWallet(this.config, offer.mintUrl);
    await this.wallet.ensureLoaded();
    return this.wallet;
  }

  async buy(steps?: number): Promise<UpstreamGrant> {
    const offer = this.offer || (await this.discover());
    if (offer.unit !== this.config.unit) throw new Error(`unsupported upstream unit ${offer.unit}`);
    if (offer.pricePerStep > this.config.maxPricePerStep) {
      throw new Error(`price ${offer.pricePerStep} exceeds cap ${this.config.maxPricePerStep}`);
    }

    const wanted = Math.max(offer.minSteps, steps || this.config.steps);
    const cost = wanted * offer.pricePerStep;
    const wallet = await this.walletFor(offer);
    if (wallet.spentToday() + cost > this.config.dailyBudget) {
      throw new Error(`daily budget ${this.config.dailyBudget} sat would be exceeded`);
    }
    if (offer.metric === "milliseconds") {
      const costPerMinute = (cost * 60_000) / offer.stepSize;
      if (costPerMinute > this.config.maxCostPerMinute) {
        throw new Error(`cost ${costPerMinute.toFixed(2)} sat/min exceeds cap ${this.config.maxCostPerMinute}`);
      }
    }

    const { token, sentProofs } = await wallet.makeToken(cost);
    let response: Response;
    try {
      response = await fetchJson(
        `${offer.gateway}/`,
        { method: "POST", headers: { "content-type": "text/plain" }, body: token },
        20_000,
      );
    } catch (error) {
      const spent = await wallet.proofsSpent(sentProofs);
      this.status = { state: spent ? "ambiguous-spent" : "ambiguous-unspent", error: String(error) };
      if (spent === false) throw new Error("payment outcome unknown, note is unspent; retry is safe");
      throw new Error("payment outcome unknown, note may be spent; refusing to retry");
    }

    const body = await response.text();
    let event: any = null;
    try {
      event = JSON.parse(body);
    } catch {
      // Unclassifiable body: reconcile before retrying.
    }

    if (response.status === 200 && event?.kind === 1022) {
      const tags = Object.fromEntries((event.tags || []).map((tag: string[]) => [tag[0], tag.slice(1)]));
      const grant: UpstreamGrant = {
        allotment: Number(tags.allotment?.[0] || 0),
        metric: tags.metric?.[0] || offer.metric,
        deviceIdentifier: tags["device-identifier"]?.[0],
      };
      let route: string | undefined;
      let routeError: string | undefined;
      if (this.config.routeThrough) {
        try {
          await installUpstreamRoute(offer.gateway, this.config.guestInterface, this.config.routeTable, this.config.routeNexthop);
          route = "installed";
        } catch (error) {
          route = "error";
          routeError = String(error);
          console.error("[Upstream] route install failed:", routeError);
        }
      }
      this.status = {
        state: "granted", ...grant, gateway: offer.gateway, cost, route, routeError,
        purchases: Number(this.status.purchases || 0) + 1,
        lastGrantAt: new Date().toISOString(),
      };
      this.scheduleRenewal(grant);
      return grant;
    }

    const code = event?.tags?.find((tag: string[]) => tag[0] === "code")?.[1] || "unknown";
    if (REFUSED_CODES.has(code)) throw new Error(`gate refused: ${code}`);
    if (RETRYABLE_CODES.has(code)) throw new Error(`gate retryable: ${code}`);
    if (LOST_CODES.has(code)) throw new Error(`value lost: ${code}`);

    const spent = await wallet.proofsSpent(sentProofs);
    this.status = { state: spent ? "ambiguous-spent" : "ambiguous-unspent", code, httpStatus: response.status };
    throw new Error(`payment outcome unknown (${code}); spent=${spent}`);
  }

  private scheduleRenewal(grant: UpstreamGrant): void {
    if (this.timer) clearInterval(this.timer);
    if (!grant.allotment) return;
    if (grant.metric === "milliseconds") {
      const delay = (grant.allotment * this.config.renewAtPercent) / 100;
      this.timer = setTimeout(() => {
        this.runOnce().catch((error) => {
          this.status = { ...this.status, state: "renewal-failed", error: String(error) };
        });
      }, Math.max(10_000, delay));
      this.timer.unref();
      return;
    }

    this.timer = setInterval(async () => {
      if (this.running || this.status.state !== "granted" || !this.status.gateway) return;
      try {
        const response = await fetchJson(`${this.status.gateway}/usage`, {}, 5000);
        if (!response.ok) return;
        const [used, allotment] = (await response.text()).trim().split("/").map(Number);
        if (!Number.isFinite(used) || !Number.isFinite(allotment) || allotment <= 0) return;
        this.status = { ...this.status, used, allotment };
        if (used * 100 >= allotment * this.config.renewAtPercent) await this.runOnce();
      } catch {
        // Transient usage errors never trigger a purchase.
      }
    }, this.config.pollIntervalMs);
    this.timer.unref();
  }

  async runOnce(): Promise<UpstreamGrant> {
    if (this.running) throw new Error("upstream purchase already in flight");
    this.running = true;
    try {
      return await this.buy();
    } finally {
      this.running = false;
    }
  }

  start(): void {
    if (!this.config.enabled) {
      console.log("[Upstream] disabled by configuration");
      return;
    }
    this.status = { state: "starting" };
    if (this.config.routeThrough) {
      removeUpstreamRoute(this.config.guestInterface, this.config.routeTable).catch(() => undefined);
    }
    this.runOnce()
      .then(() => console.log("[Upstream] initial purchase granted"))
      .catch((error) => {
        this.status = { state: "failed", error: String(error) };
        console.error("[Upstream] initial purchase failed:", String(error));
      });
    setInterval(() => {
      if (this.status.state === "failed") {
        this.runOnce().catch(() => {});
      }
    }, this.config.pollIntervalMs).unref();
  }
}

let singleton: UpstreamClient | null = null;

export function startUpstream(dataDir: string): UpstreamClient | null {
  const config = loadUpstreamConfig(dataDir);
  if (!config.enabled) return null;
  singleton = new UpstreamClient(config);
  singleton.start();
  return singleton;
}

export function upstreamStatus(): unknown {
  return singleton?.status ?? { state: "disabled" };
}
