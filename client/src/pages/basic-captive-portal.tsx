import { useEffect, useMemo, useRef, useState } from "react";

interface ServiceTier {
  id: string;
  name: string;
  description?: string;
  price?: number;
  fiatPrice?: number;
  durationHours: number;
  speedMbps: number | string;
  dataLimitMB: number;
  features?: string[];
  buttonText?: string;
  isFree: boolean;
  isPopular?: boolean;
  enabled?: boolean;
  acceptStripePayments?: boolean;
  acceptCryptoPayments?: boolean;
}

interface PortalConfig {
  nodeInfo?: { name?: string; location?: string };
  branding?: { logoText?: string; tagline?: string };
  pricing?: { tiers?: ServiceTier[] };
  features?: { redirectAfterPayment?: string };
  stripe?: { enabled?: boolean };
  payments?: {
    stripe?: { enabled?: boolean };
    crypto?: { enabled?: boolean };
  };
}

type PortalState = "loading" | "ready" | "connecting" | "connected" | "error";

function deviceIdentifier(): string {
  const seed = `${navigator.userAgent}|${screen.width}x${screen.height}|${Date.now()}|${Math.random()}`;
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
  }
  return `device_${Math.abs(hash).toString(36)}_${Date.now()}`;
}

function getOrCreateDeviceIdentifier(): string {
  const existing = localStorage.getItem("meshlink_user_id");
  if (existing) return existing;
  const created = deviceIdentifier();
  localStorage.setItem("meshlink_user_id", created);
  return created;
}

function getOrCreateVisitIdentifier(): string {
  const existing = sessionStorage.getItem("meshlink_visit_id");
  if (existing) return existing;
  const created = typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `visit_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem("meshlink_visit_id", created);
  return created;
}

function trackPortalEvent(
  eventName: "portal_viewed" | "tier_selected" | "checkout_cancelled" | "checkout_failed",
  details: { tierId?: string; paymentMethod?: "free" | "stripe" | "crypto" | "unavailable" } = {},
) {
  void fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ eventName, visitId: getOrCreateVisitIdentifier(), ...details }),
    keepalive: true,
  }).catch(() => undefined);
}

export default function BasicCaptivePortal() {
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [state, setState] = useState<PortalState>("loading");
  const [message, setMessage] = useState("Loading available access…");
  const [activeTierId, setActiveTierId] = useState<string | null>(null);
  const [walletTier, setWalletTier] = useState<ServiceTier | null>(null);
  const paymentReturnHandled = useRef(false);

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Portal configuration is unavailable");
        return response.json();
      })
      .then(async (value: PortalConfig) => {
        setConfig(value);
        document.title = value.branding?.logoText || value.nodeInfo?.name || "Wi-Fi Access";

        const params = new URLSearchParams(window.location.search);
        const handlingPaymentReturn = params.has("payment_success") || params.has("payment_cancelled");
        if (!handlingPaymentReturn) {
          try {
            const response = await fetch("/api/access/restore", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userIdentifier: getOrCreateDeviceIdentifier() }),
            });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result.restored) {
              setState("connected");
              setMessage(`Welcome back. Your ${result.tierName || "access"} pass is still active.`);
              window.setTimeout(() => {
                window.location.assign(value.features?.redirectAfterPayment || "https://www.google.com");
              }, 1200);
              return;
            }
          } catch {
            // Restoration is opportunistic; show the regular portal if unavailable.
          }
        }

        setState("ready");
        setMessage("");
        trackPortalEvent("portal_viewed");
      })
      .catch(() => {
        setState("error");
        setMessage("The portal could not load. Please reconnect and try again.");
      });
  }, []);

  useEffect(() => {
    if (!config || paymentReturnHandled.current) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get("payment_cancelled") === "true") {
      paymentReturnHandled.current = true;
      trackPortalEvent("checkout_cancelled", {
        tierId: localStorage.getItem("meshlink_tier_id") || undefined,
        paymentMethod: "stripe",
      });
      window.history.replaceState({}, document.title, window.location.pathname);
      localStorage.removeItem("meshlink_tier_id");
      setState("ready");
      setMessage("Payment was canceled. Choose an option when you’re ready.");
      return;
    }

    const tierId = params.get("tier_id");
    const stripeSessionId = params.get("session_id");
    if (params.get("payment_success") !== "true" || !tierId || !stripeSessionId) return;

    paymentReturnHandled.current = true;
    setActiveTierId(tierId);
    setState("connecting");
    setMessage("Verifying payment and activating your connection…");

    fetch("/api/complete-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tierId,
        userIdentifier: getOrCreateDeviceIdentifier(),
        paymentMethod: "stripe",
        paymentReference: `stripe_${stripeSessionId}`,
        stripeSessionId,
      }),
    })
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "Payment could not be verified");
        return result;
      })
      .then(() => {
        window.history.replaceState({}, document.title, window.location.pathname);
        localStorage.removeItem("meshlink_tier_id");
        setState("connected");
        setMessage("Payment confirmed. You’re connected.");
        window.setTimeout(() => {
          window.location.assign(config.features?.redirectAfterPayment || "https://www.google.com");
        }, 1800);
      })
      .catch((error) => {
        window.history.replaceState({}, document.title, window.location.pathname);
        setState("error");
        setActiveTierId(null);
        setMessage(error instanceof Error ? error.message : "Payment could not be verified");
      });
  }, [config]);

  const tiers = useMemo(
    () => config?.pricing?.tiers?.filter((tier) => tier.enabled !== false) || [],
    [config],
  );

  const connectFree = async (tier: ServiceTier) => {
    if (state === "connecting") return;
    trackPortalEvent("tier_selected", { tierId: tier.id, paymentMethod: "free" });
    setActiveTierId(tier.id);
    setWalletTier(null);
    setState("connecting");
    setMessage("Activating your free connection…");

    try {
      const response = await fetch("/api/complete-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tierId: tier.id,
          userIdentifier: getOrCreateDeviceIdentifier(),
          paymentMethod: "free",
          paymentReference: `free_access_${Date.now()}`,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Access could not be activated");
      }

      setState("connected");
      setMessage("You’re connected. Opening the internet…");
      window.setTimeout(() => {
        window.location.assign(config?.features?.redirectAfterPayment || "https://www.google.com");
      }, 1500);
    } catch (error) {
      setState("ready");
      setActiveTierId(null);
      setMessage(error instanceof Error ? error.message : "Access could not be activated");
    }
  };

  const choosePaidTier = async (tier: ServiceTier) => {
    const stripeEnabled = Boolean(config?.payments?.stripe?.enabled || config?.stripe?.enabled);
    const cryptoEnabled = Boolean(config?.payments?.crypto?.enabled);
    if (stripeEnabled && tier.acceptStripePayments) {
      trackPortalEvent("tier_selected", { tierId: tier.id, paymentMethod: "stripe" });
      setActiveTierId(tier.id);
      setWalletTier(null);
      setState("connecting");
      setMessage("Opening secure card checkout…");
      try {
        const userIdentifier = getOrCreateDeviceIdentifier();
        localStorage.setItem("meshlink_tier_id", tier.id);
        const response = await fetch("/api/payment/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tierId: tier.id, userIdentifier }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.checkoutUrl) {
          throw new Error(result.error || "Card checkout is unavailable");
        }
        window.location.assign(result.checkoutUrl);
      } catch (error) {
        trackPortalEvent("checkout_failed", { tierId: tier.id, paymentMethod: "stripe" });
        setState("ready");
        setActiveTierId(null);
        setMessage(error instanceof Error ? error.message : "Card checkout is unavailable");
      }
      return;
    }

    if (cryptoEnabled && tier.acceptCryptoPayments) {
      trackPortalEvent("tier_selected", { tierId: tier.id, paymentMethod: "crypto" });
      setWalletTier(tier);
      setMessage("");
      return;
    }

    setWalletTier(null);
    trackPortalEvent("tier_selected", { tierId: tier.id, paymentMethod: "unavailable" });
    setMessage("Payment is not configured for this access option. Please ask the network operator.");
  };

  const formatData = (megabytes: number) => megabytes >= 1024
    ? `${Math.round((megabytes / 1024) * 10) / 10} GB`
    : `${megabytes} MB`;

  const formatDollars = (amount: number) => Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

  const tierTerms = (tier: ServiceTier) => [
    `${tier.speedMbps} Mbps`,
    tier.durationHours > 0 ? `${tier.durationHours} hours` : null,
    tier.dataLimitMB > 0 ? formatData(tier.dataLimitMB) : null,
  ].filter(Boolean).join(" · ");

  const brand = config?.branding?.logoText || config?.nodeInfo?.name || "Wi-Fi Access";
  const stripeEnabled = Boolean(config?.payments?.stripe?.enabled || config?.stripe?.enabled);

  return (
    <main style={{ minHeight: "100vh", background: "#f8fafc", color: "#0f172a", padding: "24px", boxSizing: "border-box", display: "grid", placeItems: "center" }}>
      <section style={{ width: "100%", maxWidth: 520, background: "#fff", border: "1px solid #e2e8f0", borderRadius: 20, padding: 28, boxSizing: "border-box", boxShadow: "0 18px 45px rgba(15, 23, 42, .10)" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#15803d", fontWeight: 700, marginBottom: 18 }}>
          <span aria-hidden="true">●</span> Official market Wi-Fi
        </div>
        <h1 style={{ fontSize: 30, lineHeight: 1.15, margin: "0 0 10px", letterSpacing: "-.03em" }}>{brand}</h1>
        <p style={{ color: "#475569", lineHeight: 1.5, margin: "0 0 24px" }}>
          {config?.branding?.tagline || "Connect to free internet access."}
        </p>

        {state !== "connected" ? (
          <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
            {tiers.map((tier) => (
              <article key={tier.id} style={{ position: "relative", border: tier.isPopular ? "2px solid #2563eb" : "1px solid #dbe3ee", background: tier.isFree ? "#f0fdf4" : "#fff", borderRadius: 14, padding: 18 }}>
                {tier.isPopular ? (
                  <span style={{ position: "absolute", right: 14, top: 14, background: "#dbeafe", color: "#1d4ed8", borderRadius: 999, padding: "4px 8px", fontSize: 11, fontWeight: 800 }}>POPULAR</span>
                ) : null}
                <div style={{ paddingRight: tier.isPopular ? 76 : 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 750 }}>{tier.name}</div>
                  <div style={{ color: "#2563eb", fontSize: 20, fontWeight: 800, marginTop: 4 }}>
                    {tier.isFree
                      ? "Free"
                      : stripeEnabled && tier.acceptStripePayments && tier.fiatPrice != null
                        ? formatDollars(tier.fiatPrice)
                        : `${tier.price ?? 0} MESH`}
                  </div>
                </div>
                {tier.description ? <p style={{ color: "#64748b", margin: "8px 0 10px", lineHeight: 1.4 }}>{tier.description}</p> : null}
                <div style={{ color: "#334155", fontSize: 14, marginBottom: 10 }}>
                  {tierTerms(tier)}
                </div>
                {tier.features?.length ? (
                  <ul style={{ color: "#64748b", fontSize: 13, lineHeight: 1.55, margin: "0 0 14px", paddingLeft: 18 }}>
                    {tier.features.map((feature) => <li key={feature}>{feature}</li>)}
                  </ul>
                ) : null}
                <button
                  type="button"
                  disabled={state === "connecting"}
                  onClick={() => tier.isFree ? connectFree(tier) : choosePaidTier(tier)}
                  style={{ width: "100%", border: 0, borderRadius: 10, padding: "12px 16px", background: tier.isFree ? "#16a34a" : "#2563eb", color: "#fff", fontSize: 15, fontWeight: 750, opacity: state === "connecting" && activeTierId !== tier.id ? .55 : 1 }}
                >
                  {state === "connecting" && activeTierId === tier.id
                    ? "Opening…"
                    : tier.isFree
                      ? (tier.buttonText || "Connect Free")
                      : stripeEnabled && tier.acceptStripePayments && tier.fiatPrice != null
                        ? `Pay ${formatDollars(tier.fiatPrice)}`
                        : (tier.buttonText || `Pay ${tier.price ?? 0} MESH`)}
                </button>
                {walletTier?.id === tier.id ? (
                  <div style={{ marginTop: 12, borderRadius: 10, padding: 12, background: "#eff6ff", color: "#1e3a8a", fontSize: 13, lineHeight: 1.45 }}>
                    <div style={{ marginBottom: 10 }}>
                      Continue in Safari to connect your wallet and pay {tier.price ?? 0} MESH.
                    </div>
                    <a
                      href={`/wallet?tier=${encodeURIComponent(tier.id)}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ display: "block", textAlign: "center", textDecoration: "none", borderRadius: 9, padding: "11px 14px", background: "#0f172a", color: "#fff", fontSize: 14, fontWeight: 750 }}
                    >
                      Open Wallet Checkout
                    </a>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}

        {message ? (
          <div role="status" style={{ color: state === "error" ? "#b91c1c" : "#475569", marginBottom: 16, lineHeight: 1.45 }}>
            {message}
          </div>
        ) : null}

        {state === "error" ? (
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{ width: "100%", border: 0, borderRadius: 12, padding: "14px 18px", background: "#2563eb", color: "#fff", fontSize: 16, fontWeight: 700 }}
          >
            Try Again
          </button>
        ) : null}

        <p style={{ color: "#64748b", fontSize: 12, lineHeight: 1.5, margin: "18px 0 0", textAlign: "center" }}>
          Visitor access is free. Vendor payments are processed by Stripe. Websites you open stay protected by HTTPS.
        </p>
      </section>
    </main>
  );
}
