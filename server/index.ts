import "dotenv/config";
import { createServer as createHttpsServer } from "https";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import {
  getPortalTls,
  guestAdminGuard,
  portalHttpsRedirect,
  portalSecurityHeaders,
} from "./portal-tls";

const app = express();
app.use(guestAdminGuard());
app.use(portalHttpsRedirect());
app.use(portalSecurityHeaders());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const server = await registerRoutes(app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // HTTP stays on 3000 for captive-portal detection (iptables REDIRECT :80).
  const port = Number(process.env.PORT || 3000);
  server.listen({
    port,
    host: "0.0.0.0",
  }, () => {
    log(`serving on port ${port}`);
  });

  const tls = getPortalTls();
  if (tls.enabled && tls.credentials) {
    const httpsServer = createHttpsServer(tls.credentials, app);
    httpsServer.listen({
      port: tls.port,
      host: "0.0.0.0",
    }, () => {
      const trust = tls.trusted ? "trusted cert" : "self-signed";
      log(`serving https on port ${tls.port} (${tls.host}, ${trust})`);
    });
  }
})();
