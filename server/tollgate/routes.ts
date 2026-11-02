import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import express, { type Express, type Request, type Response } from "express";
import type { Server } from "http";
import { isIP } from "net";
import { networkManager } from "../network-manager";
import {
  createAdvertisement,
  createErrorNotice,
  createSessionNotice,
} from "./advertisement";
import { CashuReceiver } from "./cashu";
import { loadTollgateConfig, type TollgateConfig } from "./config";
import { loadIdentity, type TollgateIdentity } from "./identity";
import { TollgateStore } from "./store";

const execFileAsync = promisify(execFile);

interface RateState {
  count: number;
  resetAt: number;
}

const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;

function normalizeIp(ip: string): string | null {
  const value = ip.replace(/^::ffff:/, "");
  return isIP(value) === 4 ? value : null;
}

function clientIp(req: Request): string {
  return normalizeIp(req.socket.remoteAddress || "") || "127.0.0.1";
}

async function resolveMac(ip: string): Promise<string | null> {
  const commands: Array<[string, string[]]> = [
    ["/usr/sbin/ip", ["neigh", "show", "to", ip]],
    ["/usr/sbin/arp", ["-n", ip]],
    ["arp", ["-n", ip]],
  ];

  for (const [command, args] of commands) {
    try {
      const { stdout } = await execFileAsync(command, args);
      const match = stdout.match(/\b([0-9a-f]{2}(?::[0-9a-f]{2}){5})\b/i);
      if (match && match[1] !== "00:00:00:00:00:00" && match[1].toLowerCase() !== "ff:ff:ff:ff:ff:ff") {
        return match[1].toLowerCase();
      }
    } catch {
      // Try the next resolver.
    }
  }
  return null;
}

function isRateLimited(state: Map<string, RateState>, ip: string): boolean {
  const now = Date.now();
  const current = state.get(ip);
  if (!current || current.resetAt <= now) {
    state.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  current.count += 1;
  return current.count > RATE_MAX_REQUESTS;
}

function sendNotice(
  res: Response,
  identity: TollgateIdentity,
  status: number,
  code: string,
  message: string,
  level = "error",
) {
  return res
    .status(status)
    .type("application/json")
    .json(createErrorNotice(identity, code, message, level));
}

function grantSeconds(config: TollgateConfig, allotment: number): number {
  if (config.metric === "milliseconds") {
    return Math.max(1, Math.ceil(allotment / 1000));
  }
  // MeshLink has no byte-quota enforcer yet. Open the gate for a bounded
  // window; the upstream usage poller can tighten this once byte accounting
  // exists.
  return 3600;
}

export function registerTollgateRoutes(
  app: Express,
  config: TollgateConfig,
  identity: TollgateIdentity,
  store: TollgateStore,
  receiver: CashuReceiver,
) {
  const rate = new Map<string, RateState>();

  app.get("/", (_req, res) => {
    res.type("application/json").send(JSON.stringify(createAdvertisement(config, identity)));
  });

  app.get("/whoami", async (req, res) => {
    const mac = await resolveMac(clientIp(req));
    if (!mac) return res.type("text/plain").send("mac=unknown");
    return res.type("text/plain").send(`mac=${mac}`);
  });

  app.get("/usage", async (req, res) => {
    const mac = await resolveMac(clientIp(req));
    if (!mac) return res.type("text/plain").send("-1/-1");

    const session = store.latestSession(mac);
    if (!session) return res.type("text/plain").send("-1/-1");

    const used =
      session.metric === "milliseconds"
        ? Math.min(session.allotment, Math.max(0, Date.now() - session.createdAt))
        : 0;
    return res.type("text/plain").send(`${used}/${session.allotment}`);
  });

  app.post(
    "/",
    express.text({ type: () => true, limit: "256kb" }),
    async (req, res) => {
      const ip = clientIp(req);
      if (isRateLimited(rate, ip)) {
        return sendNotice(res, identity, 429, "mint-rate-limited", "too many payment attempts");
      }

      const mac = await resolveMac(ip);
      if (!mac) {
        return sendNotice(res, identity, 400, "device-unresolved", "could not resolve client MAC");
      }

      const token = typeof req.body === "string" ? req.body.trim() : "";
      if (!token.startsWith("cashu")) {
        return sendNotice(res, identity, 400, "payment-error-invalid-token", "body is not a Cashu token");
      }

      let inspected: { amount: number; mint: string };
      try {
        inspected = await receiver.inspect(token);
      } catch (error) {
        console.error("[Tollgate] token decode failed:", error instanceof Error ? error.message : "unknown");
        return sendNotice(
          res,
          identity,
          400,
          "payment-error-mint-unreachable",
          "could not load mint keys or decode token",
        );
      }

      if (inspected.mint !== config.mintUrl) {
        return sendNotice(res, identity, 400, "payment-error-invalid-token", "token was issued by another mint");
      }

      const steps = Math.floor(inspected.amount / config.pricePerStep);
      if (steps < config.minSteps) {
        return sendNotice(
          res,
          identity,
          400,
          "payment-error-below-swap-fee",
          `token pays ${steps} step(s); minimum is ${config.minSteps}`,
        );
      }

      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      if (!store.reserveToken(tokenHash)) {
        return sendNotice(res, identity, 400, "payment-error-token-spent", "token was already redeemed");
      }

      let received;
      try {
        received = await receiver.receive(token);
      } catch (error) {
        store.dropToken(tokenHash);
        console.error("[Tollgate] mint receive failed:", error instanceof Error ? error.message : "unknown");
        return sendNotice(res, identity, 400, "payment-error-mint-unreachable", "mint rejected or did not answer");
      }

      const grantSteps = Math.min(steps, config.maxSteps);
      const allotment = grantSteps * config.stepSize;

      let session;
      try {
        session = store.recordPayment({
          tokenHash,
          amount: received.amount,
          mac,
          ip,
          allotment,
          metric: config.metric,
          proofs: received.proofs,
        });
      } catch (error) {
        console.error("[Tollgate] payment persistence failed:", error);
        return sendNotice(res, identity, 500, "payment-outcome-unknown", "payment accepted but session was not recorded");
      }

      try {
        await networkManager.grantAccess(ip, grantSeconds(config, allotment));
      } catch (error) {
        console.error("[Tollgate] grant failed:", error);
        return sendNotice(res, identity, 500, "payment-received-grant-pending", "payment accepted but access grant failed");
      }

      console.log(
        `[Tollgate] granted ${mac} (${ip}) session=${session.id} allotment=${allotment}${config.metric}`,
      );
      return res
        .status(200)
        .type("application/json")
        .json(
          createSessionNotice(identity, {
            mac,
            allotment,
            metric: config.metric,
            mintUrl: config.mintUrl,
          }),
        );
    },
  );
}

export async function startTollgateServer(): Promise<Server | null> {
  const config = loadTollgateConfig();
  if (!config.enabled) {
    console.log("[Tollgate] disabled by configuration");
    return null;
  }

  const identity = loadIdentity(config.dataDir);
  const store = new TollgateStore(config.dataDir);
  const receiver = new CashuReceiver(config.mintUrl);
  const app = express();
  app.disable("x-powered-by");
  registerTollgateRoutes(app, config, identity, store, receiver);

  return new Promise((resolve, reject) => {
    const server = app.listen(config.port, "0.0.0.0", () => {
      console.log(
        `[Tollgate] merchant ${identity.pubkey.slice(0, 12)}… listening on :${config.port}`,
      );
      resolve(server);
    });
    server.on("error", reject);
  });
}
