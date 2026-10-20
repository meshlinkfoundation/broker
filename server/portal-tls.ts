import fs from "fs";
import type { NextFunction, Request, RequestHandler, Response } from "express";

export interface PortalTlsConfig {
  enabled: boolean;
  trusted: boolean;
  host: string;
  port: number;
  certPath: string;
  keyPath: string;
  url: string;
  credentials?: { cert: Buffer; key: Buffer };
}

let cached: PortalTlsConfig | null = null;

export function loadPortalTls(): PortalTlsConfig {
  const certPath = process.env.MESHLINK_TLS_CERT || "/etc/meshlink/tls/portal.crt";
  const keyPath = process.env.MESHLINK_TLS_KEY || "/etc/meshlink/tls/portal.key";
  const host = process.env.MESHLINK_PORTAL_HOST || "portal.meshlink";
  const port = Number(process.env.MESHLINK_TLS_PORT || 3443);
  const trusted = process.env.MESHLINK_TLS_TRUSTED === "1";

  let credentials: PortalTlsConfig["credentials"];
  let enabled = false;
  try {
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      credentials = {
        cert: fs.readFileSync(certPath),
        key: fs.readFileSync(keyPath),
      };
      enabled = true;
    }
  } catch (error) {
    console.warn("[TLS] failed to load portal certificates:", error);
  }

  return {
    enabled,
    trusted,
    host,
    port,
    certPath,
    keyPath,
    url: `https://${host}`,
    credentials,
  };
}

export function getPortalTls(): PortalTlsConfig {
  if (!cached) {
    cached = loadPortalTls();
  }
  return cached;
}

export function portalPublicConfig() {
  const tls = getPortalTls();
  return {
    https: {
      enabled: tls.enabled,
      trusted: tls.trusted,
      host: tls.host,
      url: tls.url,
    },
  };
}

function requestHost(req: Request): string {
  return (req.headers.host || "").split(":")[0].toLowerCase();
}

function isPortalHostname(host: string, tls: PortalTlsConfig): boolean {
  const apIp = (process.env.MESHLINK_AP_IP || "192.168.50.1").toLowerCase();
  return host === tls.host.toLowerCase() || host === apIp;
}

/**
 * Send browsers that asked for the portal hostname to HTTPS.
 * Leave captive-portal probe hosts (captive.apple.com, etc.) on HTTP so
 * iOS/Android detection still works.
 */
export function portalHttpsRedirect(): RequestHandler {
  const tls = getPortalTls();
  return (req: Request, res: Response, next: NextFunction) => {
    if (!tls.enabled || !tls.trusted) return next();
    if (req.secure) return next();
    if (!isPortalHostname(requestHost(req), tls)) return next();
    res.redirect(302, `${tls.url}${req.originalUrl}`);
  };
}

function isGuestClient(req: Request): boolean {
  const remoteIp = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
  const apIp = process.env.MESHLINK_AP_IP || "192.168.50.1";
  const apPrefix = apIp.split(".").slice(0, 3).join(".");
  return remoteIp.startsWith(`${apPrefix}.`);
}

function isAdminSurface(path: string): boolean {
  return path === "/admin" ||
    path.startsWith("/admin/") ||
    path === "/api/admin" ||
    path.startsWith("/api/admin/") ||
    path === "/api/network/clients" ||
    path.startsWith("/api/network/clients/");
}

/** Keep the operator dashboard and its privileged APIs off the public AP. */
export function guestAdminGuard(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Demo/field mode: let an operator manage the node while connected to the
    // public AP. Privileged API calls still require the dashboard login token.
    if (process.env.MESHLINK_ALLOW_GUEST_ADMIN === "1") return next();
    if (isGuestClient(req) && isAdminSurface(req.path)) {
      return res.status(404).json({ error: "Not found" });
    }
    next();
  };
}

/** Add browser protections to responses served over the TLS listener. */
export function portalSecurityHeaders(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Frame-Options", "DENY");
    }
    next();
  };
}
