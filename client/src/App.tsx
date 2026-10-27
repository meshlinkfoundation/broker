import { lazy, Suspense, useEffect, useState } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import BasicCaptivePortal from "@/pages/basic-captive-portal";
import { portalHttpsUpgradeUrl } from "@/lib/portal-https";

const PirateCaptivePortal = lazy(() => import("@/pages/pirate-captive-portal"));

const Dashboard = lazy(() => import("@/pages/dashboard"));
const AdminDashboard = lazy(() => import("@/pages/admin-dashboard"));
const WalletPortal = lazy(() => import("@/pages/captive-portal"));
const NotFound = lazy(() => import("@/pages/not-found"));
const Web3Provider = lazy(() =>
  import("@/lib/web3-provider").then((module) => ({ default: module.Web3Provider })),
);

function Router() {
  return (
    <Suspense fallback={<div className="portal-loading"><div><strong>meshlink</strong><span>Loading…</span></div></div>}>
      <Switch>
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/admin" component={AdminDashboard} />
        <Route path="/wallet" component={WalletPortal} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

interface BootConfig {
  mode: "sandbox" | "production";
  walletConnectProjectId: string;
  cryptoEnabled: boolean;
}

function ConfiguredApp() {
  const [bootConfig, setBootConfig] = useState<BootConfig | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        const upgradeTo = portalHttpsUpgradeUrl(c.portal?.https);
        if (upgradeTo) {
          window.location.replace(upgradeTo);
          return;
        }
        setBootConfig({
          mode: c.mode === "production" ? "production" : "sandbox",
          walletConnectProjectId: c.payments?.crypto?.walletConnectProjectId || "",
          cryptoEnabled: c.payments?.crypto?.enabled ?? false,
        });
      })
      .catch((err) => {
        console.error("Failed to load config:", err);
        setLoadError(err.message || "Failed to load config");
        // Render anyway so non-crypto flows still work
        setBootConfig({ mode: "sandbox", walletConnectProjectId: "", cryptoEnabled: false });
      });
  }, []);

  if (!bootConfig) {
    return null; // brief flash while we fetch /api/config
  }

  const useWeb3 = (window.location.pathname.startsWith("/dashboard") || window.location.pathname.startsWith("/wallet")) &&
    bootConfig.cryptoEnabled && bootConfig.walletConnectProjectId !== "";
  const inner = (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );

  return useWeb3 ? (
    <Suspense fallback={<div className="portal-loading"><div><strong>meshlink</strong><span>Loading dashboard…</span></div></div>}>
      <Web3Provider projectId={bootConfig.walletConnectProjectId} mode={bootConfig.mode}>
        {inner}
      </Web3Provider>
    </Suspense>
  ) : (
    inner
  );
}

function PublicPortal() {
  const [skin, setSkin] = useState<"pending" | "default" | "pirate">("pending");

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("config"))))
      .then((config) => {
        setSkin(config?.serviceProfile?.id === "pirate-net" ? "pirate" : "default");
      })
      .catch(() => setSkin("default"));
  }, []);

  if (skin === "pending") return null;
  if (skin === "pirate") {
    return (
      <Suspense fallback={null}>
        <PirateCaptivePortal />
      </Suspense>
    );
  }
  return <BasicCaptivePortal />;
}

export default function App() {
  const path = window.location.pathname;
  const isOperatorRoute = path === "/admin" || path.startsWith("/admin/") ||
    path === "/dashboard" || path.startsWith("/dashboard/") ||
    path === "/wallet" || path.startsWith("/wallet/");

  if (!isOperatorRoute) {
    return <PublicPortal />;
  }

  return <ConfiguredApp />;
}
