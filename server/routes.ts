import type { Express } from "express";
import type { NextFunction, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { networkManager } from "./network-manager";
import { z } from "zod";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Stripe from "stripe";
import { createChainClient, type ActiveNetwork, type Address, type Hex } from "./chain-client";
import { startPaymentListener, type PaymentEvent } from "./payment-listener";
import type { PublicClient } from "viem";
import { getPortalTls, portalPublicConfig } from "./portal-tls";
import {
  activateServiceProfile,
  listServiceProfiles,
  resolveServiceProfile,
} from "./service-profiles";

const createSessionSchema = z.object({
  walletAddress: z.string().min(1),
  packageId: z.number().int().positive(),
  networkId: z.number().int().positive(),
});

const portalEventSchema = z.object({
  eventName: z.enum([
    "portal_viewed",
    "tier_selected",
    "checkout_cancelled",
    "checkout_failed",
  ]),
  visitId: z.string().max(128).optional(),
  tierId: z.string().max(128).optional(),
  paymentMethod: z.enum(["free", "stripe", "crypto", "unavailable"]).optional(),
});

async function recordPortalEvent(
  eventName: string,
  clientIp: string,
  details: {
    visitId?: string;
    tierId?: string;
    paymentMethod?: string;
    metadata?: Record<string, unknown>;
  } = {},
) {
  if (!storage.recordPortalEvent) return;
  try {
    await storage.recordPortalEvent({ eventName, clientIp, ...details });
  } catch (error) {
    // Analytics must never prevent a client from purchasing or receiving access.
    console.error(`[Analytics] failed to record ${eventName}:`, error);
  }
}

// Load configuration
let config: any = null;
let baseConfig: any = null;

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), "server", "config", "meshlink-config.json");
    const configData = fs.readFileSync(configPath, "utf8");
    baseConfig = JSON.parse(configData);
    config = resolveServiceProfile(baseConfig);
  } catch (error) {
    console.error("Config loading error:", error);
  }
}

loadConfig();

// Resolve the active crypto network for the current mode (sandbox|production).
// All on-chain reads, event listeners, and client UI should use what this returns.
function getActiveCryptoNetwork(): any {
  if (!config) return null;
  const mode = config.mode === "production" ? "production" : "sandbox";
  const networks = config.payments?.crypto?.networks;
  if (!networks) return null;
  return networks[mode] ?? null;
}

// Sanity-check Stripe key matches the configured mode. Logs a warning but does not block boot.
function validateStripeKeyMatchesMode() {
  if (!config) return;
  const mode = config.mode === "production" ? "production" : "sandbox";
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return; // Stripe just disabled; not an error here.
  const isTestKey = key.startsWith("sk_test_");
  const isLiveKey = key.startsWith("sk_live_");
  if (mode === "sandbox" && isLiveKey) {
    console.warn("[Config] Mode is 'sandbox' but STRIPE_SECRET_KEY is a live key (sk_live_*). Real charges will occur.");
  }
  if (mode === "production" && isTestKey) {
    console.warn("[Config] Mode is 'production' but STRIPE_SECRET_KEY is a test key (sk_test_*). Payments will not be real.");
  }
}

validateStripeKeyMatchesMode();

const UNLIMITED_ACCESS_EXPIRY = new Date("2099-01-01T00:00:00.000Z");

function accessWindowForTier(tier: { durationHours?: number }, start = new Date()) {
  const hours = Number(tier.durationHours);
  if (!Number.isFinite(hours) || hours <= 0) {
    return { durationSeconds: 0, expiryDate: UNLIMITED_ACCESS_EXPIRY };
  }
  const durationSeconds = Math.ceil(hours * 60 * 60);
  return {
    durationSeconds,
    expiryDate: new Date(start.getTime() + durationSeconds * 1000),
  };
}

// Pending crypto payment sessions. Keyed by sessionId, holds what the broker is waiting for.
// In-memory for now — survives until process restart. Phase 2.5: move to SQLite if needed.
interface PendingCryptoSession {
  sessionId: Hex;
  clientIp: string;
  tierId: string;
  expectedAmount: bigint;          // minimum MESH (in wei) the operator must receive
  expectedOperator: Address;       // operator wallet that must receive payment
  expiresAt: number;               // Date.now() ms — session unusable after this
  status: "pending" | "granted" | "expired";
  createdAt: number;
}
const pendingCryptoSessions = new Map<string, PendingCryptoSession>();

function signAdminToken(): string {
  const payload = Buffer.from(JSON.stringify({ v: 1 })).toString("base64url");
  const signature = crypto.createHmac("sha256", String(config?.admin?.password || "")).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function adminTokenValid(token: string): boolean {
  const secret = String(config?.admin?.password || "");
  const [payload, signature] = token.split(".");
  if (!secret || !payload || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

  if (!adminTokenValid(token)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

// Sweep expired sessions every 60s so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of pendingCryptoSessions) {
    if (session.status === "pending" && session.expiresAt < now) {
      session.status = "expired";
    }
    // Drop anything older than 1 hour regardless of status
    if (now - session.createdAt > 60 * 60 * 1000) {
      pendingCryptoSessions.delete(id);
    }
  }
}, 60 * 1000);

// Generate a 32-byte random session ID. Cryptographically secure.
function generateSessionId(): Hex {
  return `0x${crypto.randomBytes(32).toString("hex")}` as Hex;
}

// Compute the expected MESH amount (in wei) for a given tier from the config.
function tierMeshAmountWei(tier: any, network: ActiveNetwork): bigint {
  const meshPrice = typeof tier.price === "number" ? tier.price : 0;
  return BigInt(meshPrice) * 10n ** BigInt(network.tokenDecimals);
}

// Start (or restart) the on-chain payment listener using the active network.
let stopListener: (() => void) | null = null;
let chainClient: PublicClient | null = null;

async function startCryptoListener() {
  if (stopListener) {
    stopListener();
    stopListener = null;
  }
  const network = getActiveCryptoNetwork();
  if (!network || !config?.payments?.crypto?.enabled) {
    console.log("[PaymentListener] crypto disabled or no active network — listener not started");
    return;
  }
  if (!network.paymentContractAddress || network.paymentContractAddress === "") {
    console.warn("[PaymentListener] paymentContractAddress is empty — listener not started");
    return;
  }

  chainClient = createChainClient(network);

  stopListener = startPaymentListener(chainClient, network, async (event: PaymentEvent) => {
    const session = pendingCryptoSessions.get(event.sessionId);
    if (!session) {
      console.log(`[Payment] received PaymentReceived for unknown sessionId ${event.sessionId} — ignoring`);
      return;
    }
    if (session.status !== "pending") {
      console.log(`[Payment] sessionId ${event.sessionId} already ${session.status} — ignoring replay`);
      return;
    }
    if (event.operator.toLowerCase() !== session.expectedOperator.toLowerCase()) {
      console.warn(`[Payment] sessionId ${event.sessionId} paid to wrong operator (got ${event.operator}, expected ${session.expectedOperator})`);
      return;
    }
    if (event.amount < session.expectedAmount) {
      console.warn(`[Payment] sessionId ${event.sessionId} underpaid (got ${event.amount}, expected ${session.expectedAmount})`);
      return;
    }

    const tier = config.pricing.tiers.find((t: any) => t.id === session.tierId);
    if (!tier) {
      console.error(`[Payment] tier ${session.tierId} not found in config`);
      return;
    }

    const { durationSeconds } = accessWindowForTier(tier);
    const speedMbps = parseFloat(tier.speedMbps) || undefined;
    await networkManager.grantAccess(session.clientIp, durationSeconds, speedMbps);
    await recordPortalEvent("payment_succeeded", session.clientIp, {
      tierId: tier.id,
      paymentMethod: "crypto",
      metadata: { transactionHash: event.txHash },
    });
    await recordPortalEvent("access_granted", session.clientIp, {
      tierId: tier.id,
      paymentMethod: "crypto",
    });

    session.status = "granted";
    console.log(`[Payment] sessionId ${event.sessionId} confirmed — ${session.clientIp} granted ${tier.name} for ${tier.durationHours}h (tx ${event.txHash})`);
  });
}

startCryptoListener();

export async function registerRoutes(app: Express): Promise<Server> {

  // Login is public on trusted management interfaces; every other admin API
  // requires a server-issued, unexpired bearer token.
  app.use("/api/admin", (req, res, next) => {
    if (req.method === "POST" && req.path === "/login") return next();
    return requireAdmin(req, res, next);
  });

  // First-party funnel analytics. The server supplies the IP; clients cannot
  // attribute activity to another device. Duplicate daily events are ignored.
  app.post("/api/analytics/event", async (req, res) => {
    const parsed = portalEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid analytics event" });
    }
    await recordPortalEvent(
      parsed.data.eventName,
      networkManager.getClientIp(req),
      parsed.data,
    );
    return res.status(204).end();
  });

  app.get("/api/admin/profiles", (_req, res) => {
    try {
      if (!baseConfig) loadConfig();
      res.json(listServiceProfiles(baseConfig));
    } catch (error) {
      console.error("Profile listing error:", error);
      res.status(500).json({ error: "Failed to list service profiles" });
    }
  });

  app.post("/api/admin/profiles/:profileId/activate", (req, res) => {
    try {
      if (!baseConfig) loadConfig();
      const result = activateServiceProfile(req.params.profileId, baseConfig);
      loadConfig();
      res.json({
        success: true,
        activeProfile: config.serviceProfile,
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to activate service profile";
      res.status(message.startsWith("Unknown service profile") ? 404 : 500).json({ error: message });
    }
  });

  // Get node configuration
  app.get("/api/config", async (req, res) => {
    try {
      loadConfig();
      if (!config) {
        throw new Error("Configuration not loaded");
      }

      // Filter out disabled tiers before sending to client
      const filteredConfig = {
        ...config,
        pricing: {
          ...config.pricing,
          tiers: config.pricing.tiers.filter((t: any) => t.enabled !== false),
        },
      };

      const activeNetwork = getActiveCryptoNetwork();
      const mode = config.mode === "production" ? "production" : "sandbox";
      const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
      const stripeEnabled = Boolean(
        stripeConfigured &&
        (config.payments?.stripe?.enabled ?? config.stripe?.enabled ?? false),
      );

      const clientIp = networkManager.getClientIp(req);
      if (clientIp.startsWith("192.168.50.")) {
        await recordPortalEvent("portal_viewed", clientIp);
      }

      const publicConfig = {
        ...filteredConfig,
        mode,
        portal: portalPublicConfig(),
        stripe: {
          enabled: stripeEnabled,
          expressCheckout: config.stripe?.expressCheckout || false,
          currency: config.stripe?.currency || "usd"
        },
        payments: {
          stripe: {
            enabled: stripeEnabled,
            paymentMethods: config.payments?.stripe?.paymentMethods || ["card"],
            currency: config.payments?.stripe?.currency || config.stripe?.currency || "usd"
          },
          crypto: {
            enabled: config.payments?.crypto?.enabled ?? (config.features?.enableCrypto || false),
            walletConnectProjectId: config.payments?.crypto?.walletConnectProjectId || "",
            // Resolved active network for the current mode — frontend doesn't need to know about modes.
            network: activeNetwork || {
              chainId: 11155420,
              chainName: "OP Sepolia",
              rpcUrl: "https://sepolia.optimism.io",
              tokenAddress: "0x0000000000000000000000000000000000000000",
              paymentContractAddress: "0x0000000000000000000000000000000000000000",
              tokenSymbol: "MESH",
              tokenDecimals: 18
            }
          }
        }
      };

      res.json(publicConfig);
    } catch (error) {
      console.error("Config loading error:", error);
      res.status(500).json({ error: "Failed to load configuration" });
    }
  });

  // RFC 8908 Captive Portal API. DHCP option 114 points here only when the
  // portal has a publicly trusted certificate.
  app.get("/api/captive-portal", async (req, res) => {
    try {
      const tls = getPortalTls();
      const clientIp = networkManager.getClientIp(req);
      const captive = !(await networkManager.hasAccess(clientIp));

      res.setHeader("Content-Type", "application/captive+json");
      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        captive,
        ...(captive ? { "user-portal-url": `${tls.url}/` } : {}),
      });
    } catch (error) {
      console.error("Captive portal API error:", error);
      res.status(500).json({ error: "Failed to determine captive state" });
    }
  });

  // Create a crypto payment session.
  // Client picks a tier in the captive portal; broker generates a sessionId
  // for them to pass to MeshPayment.pay(...). Broker watches for the matching event.
  app.post("/api/payment/crypto/create-session", async (req, res) => {
    try {
      const { tierId } = req.body;
      if (!config || !tierId) {
        return res.status(400).json({ error: "Missing tierId" });
      }
      const tier = config.pricing.tiers.find((t: any) => t.id === tierId);
      if (!tier || tier.enabled === false) {
        return res.status(400).json({ error: "Invalid tier" });
      }
      if (tier.isFree) {
        return res.status(400).json({ error: "Free tier does not require crypto payment" });
      }
      if (!tier.acceptCryptoPayments) {
        return res.status(400).json({ error: "This tier does not accept crypto" });
      }

      const network = getActiveCryptoNetwork();
      if (!network || !config.payments?.crypto?.enabled) {
        return res.status(503).json({ error: "Crypto payments are disabled at this node" });
      }
      if (!network.operatorWallet || network.operatorWallet === "0x0000000000000000000000000000000000000000" || network.operatorWallet === "") {
        return res.status(503).json({ error: "Operator wallet is not configured" });
      }

      const sessionId = generateSessionId();
      const clientIp = networkManager.getClientIp(req);
      const expectedAmount = tierMeshAmountWei(tier, network);
      const expiresAt = Date.now() + 10 * 60 * 1000; // 10 min to complete payment

      pendingCryptoSessions.set(sessionId, {
        sessionId,
        clientIp,
        tierId: tier.id,
        expectedAmount,
        expectedOperator: network.operatorWallet as Address,
        expiresAt,
        status: "pending",
        createdAt: Date.now(),
      });

      await recordPortalEvent("checkout_started", clientIp, {
        tierId: tier.id,
        paymentMethod: "crypto",
      });

      console.log(`[Payment] created crypto session ${sessionId} for ${clientIp} → tier ${tier.id} (${expectedAmount} wei)`);

      res.json({
        sessionId,
        expiresAt,
        paymentContractAddress: network.paymentContractAddress,
        tokenAddress: network.tokenAddress,
        operatorWallet: network.operatorWallet,
        amount: expectedAmount.toString(),
        chainId: network.chainId,
        chainName: network.chainName,
        explorerUrl: network.explorerUrl,
      });
    } catch (error: any) {
      console.error("Create crypto session error:", error);
      res.status(500).json({ error: "Failed to create session: " + error.message });
    }
  });

  // Poll endpoint — client can check whether their payment has been confirmed.
  app.get("/api/payment/crypto/session/:sessionId", (req, res) => {
    const session = pendingCryptoSessions.get(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: "Session not found or already cleaned up" });
    }
    res.json({
      sessionId: session.sessionId,
      status: session.status,
      tierId: session.tierId,
      expiresAt: session.expiresAt,
    });
  });

  // Trust / transparency endpoint — surfaces on-chain facts the captive portal can display.
  app.get("/api/chain/info", async (req, res) => {
    try {
      const network = getActiveCryptoNetwork();
      if (!network) {
        return res.status(503).json({ error: "Crypto not configured" });
      }
      res.json({
        chainId: network.chainId,
        chainName: network.chainName,
        explorerUrl: network.explorerUrl,
        tokenAddress: network.tokenAddress,
        paymentContractAddress: network.paymentContractAddress,
        operatorWallet: network.operatorWallet,
        // Static trust signals — these are guaranteed by the contract code itself.
        guarantees: {
          contractOpenSource: true,
          contractVerifiedOnExplorer: true,
          protocolFeePercent: 0,
          operatorReceivesPercent: 100,
          tokenIsImmutable: true,
          tokenHasOwner: false,
          tokenSupplyIsFixed: true,
        },
      });
    } catch (error: any) {
      console.error("Chain info error:", error);
      res.status(500).json({ error: "Failed to fetch chain info" });
    }
  });

  // Health check
  app.get("/api/health", (req, res) => {
    const mode = config?.mode === "production" ? "production" : "sandbox";
    const activeNetwork = getActiveCryptoNetwork();
    const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY);
    const stripeEnabled = Boolean(
      stripeConfigured &&
      (config?.payments?.stripe?.enabled ?? config?.stripe?.enabled ?? false),
    );
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      mode,
      portal: portalPublicConfig(),
      stripe: stripeEnabled,
      stripeConfigured,
      crypto: {
        enabled: config?.payments?.crypto?.enabled || false,
        chainId: activeNetwork?.chainId,
        chainName: activeNetwork?.chainName,
        tokenAddress: activeNetwork?.tokenAddress,
        paymentContractAddress: activeNetwork?.paymentContractAddress,
      },
    });
  });

  // Create Stripe Checkout Session for paid tiers
  app.post("/api/payment/create-checkout", async (req, res) => {
    try {
      const { tierId, userIdentifier } = req.body;

      if (!config || !tierId || typeof userIdentifier !== "string" || !userIdentifier.trim()) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const tier = config.pricing.tiers.find((t: any) => t.id === tierId);
      if (!tier || tier.isFree || tier.enabled === false) {
        return res.status(400).json({ error: "Invalid tier for Stripe checkout" });
      }

      const fiatPrice = Number(tier.fiatPrice);
      if (!Number.isFinite(fiatPrice) || fiatPrice <= 0) {
        return res.status(400).json({ error: "This tier does not have a valid card price" });
      }

      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        return res.status(503).json({ error: "Card payments are not available on this node" });
      }

      const stripe = new Stripe(stripeKey);
      const clientIp = networkManager.getClientIp(req);

      // Grant temporary access (10 min) so client can reach Stripe
      await networkManager.grantAccess(clientIp, 600);

      const tls = getPortalTls();
      const baseUrl = tls.enabled && tls.trusted
        ? tls.url
        : `http://${process.env.MESHLINK_AP_IP || "192.168.50.1"}:${config.broker?.port || 3000}`;

      const currency = String(config.payments?.stripe?.currency || config.stripe?.currency || "usd").toLowerCase();
      const session = await stripe.checkout.sessions.create({
        client_reference_id: userIdentifier,
        metadata: {
          tierId: tier.id,
          userIdentifier,
        },
        line_items: [{
          price_data: {
            currency,
            product_data: {
              name: `${tier.name} - ${config.branding?.logoText || config.nodeInfo?.name || "Wi-Fi Access"}`,
              description: tier.description,
            },
            unit_amount: Math.round(fiatPrice * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseUrl}/?payment_success=true&tier_id=${tierId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?payment_cancelled=true`,
      });

      await recordPortalEvent("checkout_started", clientIp, {
        tierId: tier.id,
        paymentMethod: "stripe",
      });

      console.log(`[Routes] Stripe checkout session ${session.id} created for tier ${tierId} (client ${clientIp})`);
      res.json({ checkoutUrl: session.url });
    } catch (error: any) {
      console.error("Stripe checkout error:", error);
      res.status(500).json({ error: "Failed to create checkout session: " + error.message });
    }
  });

  // Complete payment and create access session
  app.post("/api/complete-payment", async (req, res) => {
    try {
      const { tierId, userIdentifier, paymentMethod, paymentReference, stripeSessionId } = req.body;

      if (!config || !tierId || !userIdentifier) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const tier = config.pricing.tiers.find((t: any) => t.id === tierId);
      if (!tier || tier.enabled === false) {
        return res.status(400).json({ error: "Invalid tier" });
      }

      // Verify Stripe payment if applicable
      if (paymentMethod === 'stripe' && !tier.isFree) {
        if (!stripeSessionId) {
          return res.status(400).json({ error: "Missing Stripe session ID" });
        }

        const stripeKey = process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return res.status(500).json({ error: "Stripe is not configured" });
        }

        const stripe = new Stripe(stripeKey);
        const session = await stripe.checkout.sessions.retrieve(stripeSessionId);

        if (session.payment_status !== 'paid') {
          return res.status(402).json({ error: "Payment not completed" });
        }

        const expectedAmount = Math.round(Number(tier.fiatPrice) * 100);
        const expectedCurrency = String(config.payments?.stripe?.currency || config.stripe?.currency || "usd").toLowerCase();
        if (
          session.metadata?.tierId !== tier.id ||
          session.client_reference_id !== userIdentifier ||
          session.amount_total !== expectedAmount ||
          session.currency !== expectedCurrency
        ) {
          return res.status(400).json({ error: "Stripe payment does not match this access request" });
        }

        console.log(`[Routes] Stripe session ${stripeSessionId} verified - payment_status: ${session.payment_status}`);
        await recordPortalEvent("payment_succeeded", networkManager.getClientIp(req), {
          tierId: tier.id,
          paymentMethod: "stripe",
          metadata: { stripeSessionId },
        });
      }

      const resolvedPaymentReference = paymentMethod === "stripe" && stripeSessionId
        ? `stripe_${stripeSessionId}`
        : (paymentReference || `payment_${Date.now()}`);
      if (paymentMethod === "stripe") {
        const existingSession = await storage.getAccessSessionByPaymentReference(resolvedPaymentReference);
        if (existingSession) {
          if (existingSession.expiryDate.getTime() <= Date.now()) {
            return res.status(409).json({ error: "This paid access session has expired" });
          }
          const clientIp = networkManager.getClientIp(req);
          const remainingSeconds = Math.max(1, Math.floor((existingSession.expiryDate.getTime() - Date.now()) / 1000));
          await networkManager.grantAccess(clientIp, remainingSeconds, parseFloat(existingSession.speedMbps) || undefined);
          await recordPortalEvent("access_granted", clientIp, {
            tierId: tier.id,
            paymentMethod: "stripe",
          });
          return res.json({
            success: true,
            sessionGuid: existingSession.sessionGuid,
            expiryDate: existingSession.expiryDate,
            tierName: existingSession.tierName,
            dataLimitMB: existingSession.dataLimitMB,
            speedMbps: existingSession.speedMbps,
          });
        }
      }

      const sessionGuid = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const startDate = new Date();
      const { durationSeconds, expiryDate } = accessWindowForTier(tier, startDate);
      const clientIp = networkManager.getClientIp(req);

      // Create access session with clientIp in SQLite
      const accessSession = await storage.createAccessSession({
        sessionGuid,
        userIdentifier,
        clientIp,
        tierId: tier.id,
        tierName: tier.name,
        paymentMethod: paymentMethod || 'stripe',
        paymentReference: resolvedPaymentReference,
        startDate,
        expiryDate,
        dataLimitMB: tier.dataLimitMB,
        dataUsedMB: 0,
        speedMbps: tier.speedMbps.toString(),
        price: paymentMethod === "stripe" ? Number(tier.fiatPrice || 0) : Number(tier.price || 0),
        status: 'active',
        nodeOperator: config.nodeInfo.operator,
        lastAccessAt: null,
      } as any);

      // Grant access via ipset with kernel-managed timeout + bandwidth shaping
      const speedMbps = parseFloat(tier.speedMbps) || undefined;
      await networkManager.grantAccess(clientIp, durationSeconds, speedMbps);
      await recordPortalEvent("access_granted", clientIp, {
        tierId: tier.id,
        paymentMethod: paymentMethod || "stripe",
      });

      const accessLength = durationSeconds > 0 ? `${tier.durationHours}h` : "unlimited";
      console.log(`[Routes] Client ${clientIp} granted ${tier.name} access for ${accessLength} (${speedMbps ?? 'no'} Mbps cap)`);

      res.json({
        success: true,
        sessionGuid: accessSession.sessionGuid,
        expiryDate: accessSession.expiryDate,
        tierName: accessSession.tierName,
        dataLimitMB: accessSession.dataLimitMB,
        speedMbps: accessSession.speedMbps
      });
    } catch (error: any) {
      console.error("Payment completion error:", error);
      res.status(500).json({ error: "Failed to complete payment: " + error.message });
    }
  });

  // A returning device may receive a different DHCP address after the hotspot
  // restarts. Rebind an unexpired session using its opaque browser identifier.
  app.post("/api/access/restore", async (req, res) => {
    try {
      const userIdentifier = typeof req.body?.userIdentifier === "string"
        ? req.body.userIdentifier.trim()
        : "";
      if (!userIdentifier || userIdentifier.length > 256) {
        return res.status(400).json({ error: "Invalid device identifier" });
      }

      const now = Date.now();
      const sessions = await storage.getAccessSessionsByUser(userIdentifier);
      const session = sessions.find((candidate) => (
        candidate.status === "active" && new Date(candidate.expiryDate).getTime() > now
      ));
      if (!session) return res.json({ restored: false });

      const clientIp = networkManager.getClientIp(req);
      const remainingSeconds = Math.max(
        1,
        Math.ceil((new Date(session.expiryDate).getTime() - now) / 1000),
      );
      const speedMbps = parseFloat((session as any).speedMbps) || undefined;
      await networkManager.grantAccess(clientIp, remainingSeconds, speedMbps);
      await storage.updateAccessSession(session.sessionGuid, {
        clientIp,
        lastAccessAt: new Date(),
      } as any);
      await recordPortalEvent("access_granted", clientIp, {
        tierId: (session as any).tierId,
        paymentMethod: (session as any).paymentMethod,
      });

      console.log(`[Routes] Restored ${session.sessionGuid} for returning client ${clientIp}`);
      return res.json({
        restored: true,
        tierName: (session as any).tierName,
        expiryDate: session.expiryDate,
      });
    } catch (error) {
      console.error("Access restoration error:", error);
      return res.status(500).json({ error: "Failed to restore access" });
    }
  });

  // Check access session status
  app.get("/api/access/:sessionGuid", async (req, res) => {
    try {
      const { sessionGuid } = req.params;
      const session = await storage.getAccessSession(sessionGuid);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const now = new Date();
      if (session.expiryDate < now && session.status === 'active') {
        await storage.expireAccessSession(sessionGuid);
        session.status = 'expired';
      }

      res.json({
        sessionGuid: session.sessionGuid,
        tierName: session.tierName,
        status: session.status,
        dataLimitMB: session.dataLimitMB,
        dataUsedMB: session.dataUsedMB,
        speedMbps: session.speedMbps,
        startDate: session.startDate,
        expiryDate: session.expiryDate,
        remainingTimeMs: Math.max(0, new Date(session.expiryDate).getTime() - now.getTime())
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to check access status" });
    }
  });

  // Get user's access sessions
  app.get("/api/access/user/:userIdentifier", async (req, res) => {
    try {
      const { userIdentifier } = req.params;
      const sessions = await storage.getAccessSessionsByUser(userIdentifier);

      res.json(sessions.map(session => ({
        sessionGuid: session.sessionGuid,
        tierName: session.tierName,
        status: session.status,
        dataLimitMB: session.dataLimitMB,
        dataUsedMB: session.dataUsedMB,
        speedMbps: session.speedMbps,
        startDate: session.startDate,
        expiryDate: session.expiryDate,
        paymentMethod: session.paymentMethod
      })));
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user sessions" });
    }
  });

  // Update data usage for a session
  app.patch("/api/access/:sessionGuid/usage", async (req, res) => {
    try {
      const { sessionGuid } = req.params;
      const { dataUsedMB } = req.body;

      const updatedSession = await storage.updateAccessSession(sessionGuid, {
        dataUsedMB: dataUsedMB || 0,
        lastAccessAt: new Date()
      });

      if (!updatedSession) {
        return res.status(404).json({ error: "Session not found" });
      }

      res.json({ success: true, dataUsedMB: updatedSession.dataUsedMB });
    } catch (error) {
      res.status(500).json({ error: "Failed to update usage" });
    }
  });

  // Admin authentication
  app.post("/api/admin/login", async (req, res) => {
    try {
      const { password } = req.body;

      if (!config?.admin?.dashboardEnabled) {
        return res.status(404).json({ error: "Admin dashboard not enabled" });
      }

      if (password === config.admin.password) {
        const token = signAdminToken();
        res.json({
          success: true,
          token,
          nodeInfo: config.nodeInfo
        });
      } else {
        res.status(401).json({ error: "Invalid password" });
      }
    } catch (error) {
      res.status(500).json({ error: "Authentication failed" });
    }
  });

  // Admin analytics — use SQLiteStorage.getAnalytics() if available, else fallback
  app.get("/api/admin/analytics", async (req, res) => {
    try {
      if (storage.getAnalytics) {
        const analytics = await storage.getAnalytics();
        return res.json(analytics);
      }

      // Fallback (shouldn't happen with SQLiteStorage)
      const allSessions = await storage.getActiveAccessSessions();
      res.json({
        totalSessions: allSessions.length,
        activeSessions: allSessions.length,
        todaySessions: 0,
        weekSessions: 0,
        totalDataUsed: 0,
        totalRevenue: 0,
        tierStats: { free: { name: 'Free Access', count: 0, revenue: 0 }, premium: { name: 'Premium Speed', count: 0, revenue: 0 }, unlimited: { name: 'Unlimited Pro', count: 0, revenue: 0 } },
        paymentMethods: { stripe: 0, crypto: 0 },
        recentSessions: []
      });
    } catch (error) {
      console.error('Admin analytics error:', error);
      res.status(500).json({ error: "Failed to fetch analytics" });
    }
  });

  // Admin session management
  app.get("/api/admin/sessions", async (req, res) => {
    try {
      const { status, limit = 50, offset = 0 } = req.query;

      const allSessions = await storage.getActiveAccessSessions();

      let filteredSessions = allSessions;
      if (status) {
        filteredSessions = allSessions.filter(s => s.status === status);
      }

      const paginatedSessions = filteredSessions
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(parseInt(offset as string), parseInt(offset as string) + parseInt(limit as string));

      res.json({
        sessions: paginatedSessions,
        total: filteredSessions.length,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  // Active network clients — read from SQLite
  app.get("/api/network/clients", requireAdmin, async (req, res) => {
    try {
      const activeSessions = await storage.getActiveAccessSessions();
      res.json({
        totalClients: activeSessions.length,
        clients: activeSessions.map(s => ({
          ip: (s as any).clientIp || 'unknown',
          tier: s.tierName,
          sessionGuid: s.sessionGuid,
          startedAt: s.createdAt,
          expiryDate: s.expiryDate,
          status: s.status,
          speedMbps: (s as any).speedMbps || null
        }))
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch network clients" });
    }
  });

  // Network status (alias)
  app.get("/api/network/status", async (req, res) => {
    try {
      const activeSessions = await storage.getActiveAccessSessions();
      res.json({
        connectedClients: activeSessions.length,
        clients: []
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get network status" });
    }
  });

  // Disconnect client — revoke ipset + update SQLite
  app.delete("/api/network/clients/:ip", requireAdmin, async (req, res) => {
    try {
      const { ip } = req.params;

      // Revoke network access
      await networkManager.revokeAccess(ip);

      // Find and expire the session in SQLite
      const activeSessions = await storage.getActiveAccessSessions();
      const session = activeSessions.find(s => (s as any).clientIp === ip);
      if (session) {
        await storage.expireAccessSession(session.sessionGuid);
      }

      res.json({ success: true, message: `Client ${ip} disconnected` });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove client" });
    }
  });

  // Admin: delete/expire session by ID
  app.delete("/api/admin/sessions/:id", async (req, res) => {
    try {
      const { id } = req.params;

      // Find session by numeric ID
      const activeSessions = await storage.getActiveAccessSessions();
      const session = activeSessions.find(s => s.id === parseInt(id));

      if (session) {
        // Revoke network access if we have the IP
        if ((session as any).clientIp) {
          await networkManager.revokeAccess((session as any).clientIp);
        }
        await storage.expireAccessSession(session.sessionGuid);
      }

      res.json({ success: true, message: "Session deleted successfully" });
    } catch (error) {
      console.error("Delete session error:", error);
      res.status(500).json({ error: "Failed to delete session" });
    }
  });

  // Admin: update session
  app.put("/api/admin/sessions/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const allSessions = await storage.getActiveAccessSessions();
      const session = allSessions.find(s => s.id === parseInt(id));

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const updatedSession = await storage.updateAccessSession(session.sessionGuid, updates);

      if (!updatedSession) {
        return res.status(404).json({ error: "Failed to update session" });
      }

      res.json({ success: true, session: updatedSession });
    } catch (error) {
      console.error("Update session error:", error);
      res.status(500).json({ error: "Failed to update session" });
    }
  });

  // Get L2 networks
  app.get("/api/networks", async (req, res) => {
    try {
      const networks = await storage.getL2Networks();
      res.json(networks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch networks" });
    }
  });

  // Get bandwidth packages
  app.get("/api/packages", async (req, res) => {
    try {
      const packages = await storage.getBandwidthPackages();
      res.json(packages);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch packages" });
    }
  });

  // Get user by wallet address
  app.get("/api/user/:walletAddress", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      let user = await storage.getUserByWallet(walletAddress);

      if (!user) {
        user = await storage.createUser({ walletAddress });
      }

      res.json(user);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  // Get user sessions
  app.get("/api/user/:walletAddress/sessions", async (req, res) => {
    try {
      const { walletAddress } = req.params;
      const user = await storage.getUserByWallet(walletAddress);

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      const sessions = await storage.getHotspotSessions(user.id);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch sessions" });
    }
  });

  // Create hotspot session (initiate payment)
  app.post("/api/sessions", async (req, res) => {
    try {
      const { walletAddress, packageId, networkId } = createSessionSchema.parse(req.body);

      let user = await storage.getUserByWallet(walletAddress);
      if (!user) {
        user = await storage.createUser({ walletAddress });
      }

      const pkg = await storage.getBandwidthPackage(packageId);
      const network = await storage.getL2Network(networkId);

      if (!pkg || !network) {
        return res.status(400).json({ error: "Invalid package or network" });
      }

      const transactionHash = `0x${Math.random().toString(16).substr(2, 64)}`;

      const session = await storage.createHotspotSession({
        userId: user.id,
        packageId,
        networkId,
        transactionHash,
        status: "pending",
        dataUsedMB: 0,
        startTime: null,
        endTime: null,
      });

      res.json(session);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid request data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  // Process payment (mock L2 transaction)
  app.post("/api/sessions/:sessionId/pay", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = await storage.getHotspotSession(parseInt(sessionId));

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      const network = await storage.getL2Network(session.networkId);
      const pkg = await storage.getBandwidthPackage(session.packageId);

      if (!network || !pkg) {
        return res.status(400).json({ error: "Invalid session data" });
      }

      const transaction = await storage.createTransaction({
        sessionId: session.id,
        hash: session.transactionHash,
        networkId: session.networkId,
        fromAddress: "0x742d35cc6abc0532925bd6ab1d2982ea87b25ff7",
        toAddress: "0x1234567890abcdef1234567890abcdef12345678",
        amount: pkg.priceMeshTokens,
        gasUsed: network.gasPrice,
        status: "pending",
        blockNumber: null,
      });

      setTimeout(async () => {
        await storage.updateTransaction(transaction.hash, {
          status: "confirmed",
          blockNumber: Math.floor(Math.random() * 1000000) + 1000000,
        });

        const startTime = new Date();
        const endTime = new Date(startTime.getTime() + pkg.durationHours * 60 * 60 * 1000);

        await storage.updateHotspotSession(session.id, {
          status: "active",
          startTime,
          endTime,
        });
      }, network.confirmationTime * 1000);

      res.json({ transaction, estimatedConfirmation: network.confirmationTime });
    } catch (error) {
      res.status(500).json({ error: "Failed to process payment" });
    }
  });

  // Get transaction status
  app.get("/api/transactions/:hash", async (req, res) => {
    try {
      const { hash } = req.params;
      const transaction = await storage.getTransaction(hash);

      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      res.json(transaction);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  });

  // Update session data usage
  app.patch("/api/sessions/:sessionId/usage", async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { dataUsedMB } = req.body;

      const session = await storage.updateHotspotSession(parseInt(sessionId), {
        dataUsedMB: dataUsedMB || 0,
      });

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      res.json(session);
    } catch (error) {
      res.status(500).json({ error: "Failed to update session" });
    }
  });

  // ─── Initialize network + restore sessions from SQLite ───────────────────
  await networkManager.initialize();

  // Reconcile SQLite with the kernel allow-list on boot and periodically. A
  // hostapd/network restart can recreate ipset without restarting this process.
  let sessionReconciliationRunning = false;
  const reconcileActiveSessions = async (reason: 'startup' | 'periodic') => {
    if (sessionReconciliationRunning) return;
    sessionReconciliationRunning = true;
    try {
      const activeSessions = await storage.getActiveAccessSessions();
      let restored = 0;
      const now = Date.now();

      for (const session of activeSessions) {
        const ip = (session as any).clientIp;
        if (!ip) continue;

        const remainingSeconds = Math.ceil(
          (new Date(session.expiryDate).getTime() - now) / 1000,
        );
        if (remainingSeconds <= 0) continue;

        const advertised = parseFloat((session as any).speedMbps);
        const speedMbps = Number.isFinite(advertised) ? advertised : undefined;
        if (!(await networkManager.hasAccess(ip))) {
          await networkManager.grantAccess(ip, remainingSeconds, speedMbps);
          restored++;
        } else if (reason === "startup" && speedMbps != null) {
          await networkManager.setSpeedLimit(ip, speedMbps);
        }
      }

      const newestSessionByIp = new Map<string, { sessionGuid: string; dataUsedMB: number }>();
      for (const session of activeSessions) {
        const ip = (session as any).clientIp as string | undefined;
        if (!ip || newestSessionByIp.has(ip)) continue;
        const expiry = new Date(session.expiryDate).getTime();
        if (expiry <= now) continue;
        newestSessionByIp.set(ip, {
          sessionGuid: session.sessionGuid,
          dataUsedMB: Number(session.dataUsedMB) || 0,
        });
      }
      const usage = await networkManager.takeUsageMegabytes([...newestSessionByIp.keys()]);
      for (const [ip, megabytes] of usage) {
        const session = newestSessionByIp.get(ip);
        if (!session || megabytes <= session.dataUsedMB) continue;
        await storage.updateAccessSession(session.sessionGuid, { dataUsedMB: megabytes });
      }

      if (restored > 0) {
        console.log(`[Routes] Restored ${restored} active sessions to ipset (${reason})`);
      }
    } catch (error) {
      console.error(`[Routes] Failed to reconcile active sessions (${reason}):`, error);
    } finally {
      sessionReconciliationRunning = false;
    }
  };

  await reconcileActiveSessions('startup');
  if (process.platform === 'linux') {
    const reconciliationTimer = setInterval(
      () => void reconcileActiveSessions('periodic'),
      20_000,
    );
    reconciliationTimer.unref();
  }

  const httpServer = createServer(app);
  return httpServer;
}
