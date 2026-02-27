import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { networkManager } from "./network-manager";
import { z } from "zod";
import fs from "fs";
import path from "path";
import Stripe from "stripe";

const createSessionSchema = z.object({
  walletAddress: z.string().min(1),
  packageId: z.number().int().positive(),
  networkId: z.number().int().positive(),
});

// Load configuration
let config: any = null;

function loadConfig() {
  try {
    const configPath = path.join(process.cwd(), "server", "config", "meshlink-config.json");
    const configData = fs.readFileSync(configPath, "utf8");
    config = JSON.parse(configData);
  } catch (error) {
    console.error("Config loading error:", error);
  }
}

loadConfig();

export async function registerRoutes(app: Express): Promise<Server> {

  // Get node configuration
  app.get("/api/config", async (req, res) => {
    try {
      loadConfig();
      if (!config) {
        throw new Error("Configuration not loaded");
      }

      const publicConfig = {
        ...config,
        stripe: {
          enabled: config.stripe?.enabled || false,
          expressCheckout: config.stripe?.expressCheckout || false,
          currency: config.stripe?.currency || "usd"
        },
        payments: config.payments || {
          stripe: {
            enabled: config.stripe?.enabled || false,
            paymentMethods: ["card"],
            currency: config.stripe?.currency || "usd"
          },
          crypto: {
            enabled: config.features?.enableCrypto || false,
            network: config.network || {
              chainId: 10,
              chainName: "Optimism",
              rpcUrl: "https://mainnet.optimism.io",
              contractAddress: "0x0000000000000000000000000000000000000000",
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

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      stripe: config?.stripe?.enabled || false
    });
  });

  // Create Stripe Checkout Session for paid tiers
  app.post("/api/payment/create-checkout", async (req, res) => {
    try {
      const { tierId } = req.body;

      if (!config || !tierId) {
        return res.status(400).json({ error: "Missing required parameters" });
      }

      const tier = config.pricing.tiers.find((t: any) => t.id === tierId);
      if (!tier || tier.isFree) {
        return res.status(400).json({ error: "Invalid tier for Stripe checkout" });
      }

      const stripeKey = process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) {
        return res.status(500).json({ error: "Stripe is not configured" });
      }

      const stripe = new Stripe(stripeKey);
      const clientIp = networkManager.getClientIp(req);

      // Grant temporary access (10 min) so client can reach Stripe
      await networkManager.grantAccess(clientIp, 600);

      const host = req.headers.host || `192.168.50.1:${config.broker?.port || 3000}`;
      const baseUrl = `http://${host}`;

      const session = await stripe.checkout.sessions.create({
        line_items: [{
          price_data: {
            currency: config.payments?.stripe?.currency || config.stripe?.currency || 'usd',
            product_data: {
              name: `${tier.name} - MeshLink WiFi`,
              description: tier.description,
            },
            unit_amount: Math.round(tier.fiatPrice * 100),
          },
          quantity: 1,
        }],
        mode: 'payment',
        success_url: `${baseUrl}/?payment_success=true&tier_id=${tierId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/?payment_cancelled=true`,
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
      if (!tier) {
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

        console.log(`[Routes] Stripe session ${stripeSessionId} verified - payment_status: ${session.payment_status}`);
      }

      const sessionGuid = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const startDate = new Date();
      const durationSeconds = tier.durationHours * 60 * 60;
      const expiryDate = new Date(startDate.getTime() + durationSeconds * 1000);
      const clientIp = networkManager.getClientIp(req);

      // Create access session with clientIp in SQLite
      const accessSession = await storage.createAccessSession({
        sessionGuid,
        userIdentifier,
        clientIp,
        tierId: tier.id,
        tierName: tier.name,
        paymentMethod: paymentMethod || 'stripe',
        paymentReference: paymentReference || `payment_${Date.now()}`,
        startDate,
        expiryDate,
        dataLimitMB: tier.dataLimitMB,
        dataUsedMB: 0,
        speedMbps: tier.speedMbps.toString(),
        status: 'active',
        nodeOperator: config.nodeInfo.operator,
        lastAccessAt: null,
      } as any);

      // Grant access via ipset with kernel-managed timeout
      await networkManager.grantAccess(clientIp, durationSeconds);

      console.log(`[Routes] Client ${clientIp} granted ${tier.name} access for ${tier.durationHours}h`);

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
        const token = `admin_token_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
      const { authorization } = req.headers;

      if (!authorization || !authorization.startsWith('Bearer admin_token_')) {
        return res.status(401).json({ error: "Unauthorized" });
      }

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
      const { authorization } = req.headers;

      if (!authorization || !authorization.startsWith('Bearer admin_token_')) {
        return res.status(401).json({ error: "Unauthorized" });
      }

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
  app.get("/api/network/clients", async (req, res) => {
    try {
      const activeSessions = await storage.getActiveAccessSessions();
      res.json({
        totalClients: activeSessions.length,
        clients: activeSessions.map(s => ({
          ip: (s as any).clientIp || 'unknown',
          tier: s.tierName,
          sessionGuid: s.sessionGuid,
          expiryDate: s.expiryDate,
          status: s.status
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
        clients: activeSessions.map(s => ({
          ip: (s as any).clientIp || 'unknown',
          tier: s.tierName,
          expiryDate: s.expiryDate
        }))
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get network status" });
    }
  });

  // Disconnect client — revoke ipset + update SQLite
  app.delete("/api/network/clients/:ip", async (req, res) => {
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

  // Boot restoration: re-add active sessions to ipset
  try {
    const activeSessions = await storage.getActiveAccessSessions();
    let restored = 0;
    const now = Date.now();

    for (const session of activeSessions) {
      const ip = (session as any).clientIp;
      if (!ip) continue;

      const remainingMs = new Date(session.expiryDate).getTime() - now;
      const remainingSeconds = Math.ceil(remainingMs / 1000);

      if (remainingSeconds > 0) {
        await networkManager.grantAccess(ip, remainingSeconds);
        restored++;
      } else {
        await storage.expireAccessSession(session.sessionGuid);
      }
    }

    if (restored > 0) {
      console.log(`[Routes] Restored ${restored} active sessions from SQLite to ipset`);
    }
  } catch (error) {
    console.error('[Routes] Failed to restore sessions from SQLite:', error);
  }

  const httpServer = createServer(app);
  return httpServer;
}
