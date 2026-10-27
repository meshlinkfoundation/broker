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

export default function PirateCaptivePortal() {
  const [config, setConfig] = useState<PortalConfig | null>(null);
  const [state, setState] = useState<PortalState>("loading");
  const [message, setMessage] = useState("Stand by.");
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
        document.title = value.branding?.logoText || value.nodeInfo?.name || "Pirate Net";

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
              setMessage("Pass still live.");
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
        setMessage("Portal down. Reconnect.");
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
      setMessage("Payment canceled.");
      return;
    }

    const tierId = params.get("tier_id");
    const stripeSessionId = params.get("session_id");
    if (params.get("payment_success") !== "true" || !tierId || !stripeSessionId) return;

    paymentReturnHandled.current = true;
    setActiveTierId(tierId);
    setState("connecting");
    setMessage("Checking payment.");

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
        localStorage.removeItem("meshlink_tier_id");
        const next = config.features?.redirectAfterPayment || "https://www.google.com";
        window.location.replace(next);
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
  const [liveSpeeds, setLiveSpeeds] = useState<Record<string, number>>({});
  const tierKey = tiers.map((tier) => `${tier.id}:${tier.speedMbps}`).join("|");

  useEffect(() => {
    if (!tierKey) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setLiveSpeeds(Object.fromEntries(tiers.map((tier) => [tier.id, Number(tier.speedMbps) || 0])));
      return;
    }
    const started = performance.now();
    const duration = 1200;
    let frame = 0;
    let cancelled = false;
    const tick = (now: number) => {
      if (cancelled) return;
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setLiveSpeeds(Object.fromEntries(tiers.map((tier, index) => {
        const delayed = Math.min(1, Math.max(0, (eased - index * 0.08) / 0.84));
        return [tier.id, Math.round((Number(tier.speedMbps) || 0) * delayed)];
      })));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [tierKey, tiers]);

  const connectFree = async (tier: ServiceTier) => {
    if (state === "connecting") return;
    trackPortalEvent("tier_selected", { tierId: tier.id, paymentMethod: "free" });
    setActiveTierId(tier.id);
    setWalletTier(null);
    setState("connecting");
    setMessage("Jacking in.");

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
      setMessage("You’re in.");
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
      setMessage("Opening checkout.");
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
    setMessage("Pay lane closed.");
  };

  const formatDollars = (amount: number) => Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;

  const maxSpeed = Math.max(...tiers.map((tier) => Number(tier.speedMbps) || 0), 1);
  const tierSpeed = (tier: ServiceTier) => Number(tier.speedMbps) || 0;
  const meterWidth = (speed: number) => {
    const span = Math.log10(Math.max(maxSpeed, 10));
    const width = Math.round((Math.log10(Math.max(speed, 1)) / span) * 100);
    return Math.min(100, Math.max(14, width));
  };
  const tierLook = (tier: ServiceTier) => {
    const speed = tierSpeed(tier);
    if (tier.isFree || speed <= 5) return "is-slow";
    if (speed < maxSpeed) return "is-mid";
    return "is-fast";
  };

  const brand = config?.branding?.logoText || config?.nodeInfo?.name || "Pirate Net";
  const stripeEnabled = Boolean(config?.payments?.stripe?.enabled || config?.stripe?.enabled);
  const cryptoEnabled = Boolean(config?.payments?.crypto?.enabled);
  const tierPriceLabel = (tier: ServiceTier) => {
    if (tier.isFree) return "Free";
    const offerMesh = cryptoEnabled && tier.acceptCryptoPayments && !(stripeEnabled && tier.acceptStripePayments);
    if (!offerMesh && tier.fiatPrice != null) return formatDollars(tier.fiatPrice);
    if (offerMesh) return `${tier.price ?? 0} MESH`;
    return tier.fiatPrice != null ? formatDollars(tier.fiatPrice) : "Paid";
  };

  return (
    <main className="pn">
      <style>{PORTAL_CSS}</style>
      <div className="pn-atmosphere" aria-hidden="true" />
      <section className="pn-panel">
        <div className="pn-kicker">
          <span className="pn-dot" aria-hidden="true" /> Unlicensed
        </div>
        <div className="pn-brand">
          <img className="pn-pirate" src="/pirate.svg" alt="" />
          <h1>{brand}</h1>
        </div>

        {state !== "connected" ? (
          <div className="pn-tiers">
            {tiers.map((tier) => (
              <article key={tier.id} className={`pn-tier ${tierLook(tier)}`}>
                <div className="pn-tier-head">
                  <div>
                    <div className="pn-tier-name">{tier.name}</div>
                    {tier.description ? <div className="pn-use">{tier.description}</div> : null}
                  </div>
                  <div className="pn-price">{tierPriceLabel(tier)}</div>
                </div>
                <div className="pn-speed">
                  <span className="pn-speed-num">{liveSpeeds[tier.id] ?? 0}</span>
                  <span className="pn-speed-unit">Mbps</span>
                </div>
                <div className="pn-meter" aria-hidden="true">
                  <span style={{ ["--meter" as string]: `${meterWidth(tierSpeed(tier))}%` }} />
                </div>
                <button
                  type="button"
                  className={tier.isFree ? "pn-btn is-free" : "pn-btn"}
                  disabled={state === "connecting"}
                  onClick={() => tier.isFree ? connectFree(tier) : choosePaidTier(tier)}
                  style={{ opacity: state === "connecting" && activeTierId !== tier.id ? 0.55 : 1 }}
                >
                  {state === "connecting" && activeTierId === tier.id
                    ? "Linking"
                    : tier.isFree
                      ? "Jack in"
                      : "Pay"}
                </button>
                {walletTier?.id === tier.id ? (
                  <div className="pn-wallet">
                    <div>Pay {tier.price ?? 0} MESH in Safari.</div>
                    <a
                      href={`/wallet?tier=${encodeURIComponent(tier.id)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open wallet
                    </a>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}

        {message ? (
          <div role="status" className={state === "error" ? "pn-status is-error" : "pn-status"}>
            {message}
          </div>
        ) : null}

        {state === "error" ? (
          <button type="button" className="pn-btn" onClick={() => window.location.reload()}>
            Retry
          </button>
        ) : null}

      </section>
    </main>
  );
}

const PORTAL_CSS = `
html, body, #root {
  background: #05030a;
  min-height: 100%;
}
body {
  margin: 0;
  overscroll-behavior: none;
}
.pn {
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
  padding: 24px;
  padding-bottom: max(24px, env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  color: #e7fbff;
  background: #05030a;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  position: relative;
}
.pn-atmosphere {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(900px 420px at 15% -10%, rgba(255, 43, 214, .28), transparent 60%),
    radial-gradient(700px 380px at 110% 10%, rgba(61, 255, 242, .18), transparent 55%),
    linear-gradient(180deg, rgba(5, 3, 10, .2), #05030a 70%),
    repeating-linear-gradient(0deg, transparent, transparent 27px, rgba(61, 255, 242, .08) 28px),
    repeating-linear-gradient(90deg, transparent, transparent 27px, rgba(255, 43, 214, .06) 28px);
}
.pn-atmosphere::after {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(180deg, rgba(255, 255, 255, .035) 0 1px, transparent 1px 4px);
  mix-blend-mode: overlay;
  animation: pn-scan 9s linear infinite;
}
@keyframes pn-scan {
  from { transform: translateY(-20px); }
  to { transform: translateY(20px); }
}
.pn-panel {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 520px;
  margin-top: auto;
  margin-bottom: auto;
  animation: pn-panel-in .7s cubic-bezier(.16, 1, .3, 1) both;
  overflow: hidden;
  box-sizing: border-box;
  padding: 28px 24px 22px;
  background: rgba(8, 6, 18, .88);
  border: 1px solid rgba(61, 255, 242, .55);
  box-shadow: 0 0 0 1px rgba(255, 43, 214, .25), 0 0 40px rgba(61, 255, 242, .18), inset 0 0 30px rgba(255, 43, 214, .06);
  clip-path: polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px);
}
.pn-kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  color: #3dfff2;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: .16em;
  text-transform: uppercase;
}
.pn-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #3dfff2;
  box-shadow: 0 0 10px #3dfff2;
  animation: pn-blink 1.4s steps(2) infinite;
}
@keyframes pn-blink {
  50% { opacity: .25; }
}
.pn-brand {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 0 10px;
}
.pn-pirate {
  width: 62px;
  height: 42px;
  flex: none;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, .35);
  animation: pn-flag .7s cubic-bezier(.2, 1.5, .3, 1) .1s both;
}
.pn h1 {
  margin: 0;
  font-size: 36px;
  line-height: 1;
  letter-spacing: .04em;
  text-transform: uppercase;
  text-shadow: 0 0 18px rgba(61, 255, 242, .75), 2px 0 #ff2bd6;
  animation: pn-glitch .85s steps(2, end) .05s both;
}
.pn-tiers { display: grid; gap: 14px; margin: 18px 0; }
.pn-tier {
  position: relative;
  padding: 16px;
  background: rgba(7, 10, 22, .8);
  border: 1px solid rgba(183, 201, 220, .25);
  animation: pn-rise .6s cubic-bezier(.16, 1, .3, 1) both;
}
.pn-tier:nth-child(1) { animation-delay: .18s; }
.pn-tier:nth-child(2) { animation-delay: .34s; }
.pn-tier:nth-child(3) { animation-delay: .5s; }
.pn-tier.is-slow { border-color: rgba(143, 163, 184, .45); }
.pn-tier.is-mid { border-color: rgba(245, 193, 108, .85); }
.pn-tier.is-fast { border-color: #ff2bd6; box-shadow: inset 0 0 18px rgba(255, 43, 214, .12); }
.pn-tier-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.pn-tier-name { font-size: 16px; letter-spacing: .04em; text-transform: uppercase; }
.pn-use { margin-top: 2px; color: #9fb3c8; font-size: 12px; letter-spacing: .12em; text-transform: uppercase; }
.pn-price {
  color: #f5c16c;
  font-size: 22px;
  font-weight: 800;
  text-shadow: 0 0 12px rgba(245, 193, 108, .35);
}
.pn-speed { display: flex; align-items: baseline; gap: 8px; margin: 10px 0 8px; }
.pn-speed-num { font-weight: 800; line-height: .85; letter-spacing: -.04em; }
.pn-tier.is-slow .pn-speed-num { color: #9fb3c8; font-size: 34px; }
.pn-tier.is-mid .pn-speed-num { color: #f5c16c; font-size: 46px; }
.pn-tier.is-fast .pn-speed-num { color: #ff2bd6; font-size: 58px; text-shadow: 0 0 16px rgba(255, 43, 214, .45); }
.pn-speed-unit { color: #d5e7f5; font-size: 13px; letter-spacing: .08em; text-transform: uppercase; }
.pn-meter { height: 8px; margin-bottom: 14px; background: rgba(255, 255, 255, .08); overflow: hidden; }
.pn-meter span {
  display: block;
  height: 100%;
  width: 0;
  animation: pn-fill 1.05s cubic-bezier(.16, 1, .3, 1) forwards;
}
.pn-tier:nth-child(1) .pn-meter span { animation-delay: .4s; }
.pn-tier:nth-child(2) .pn-meter span { animation-delay: .58s; }
.pn-tier:nth-child(3) .pn-meter span { animation-delay: .76s; }
.pn-tier.is-slow .pn-meter span { background: #8fa3b8; }
.pn-tier.is-mid .pn-meter span { background: #f5c16c; box-shadow: 0 0 10px rgba(245, 193, 108, .6); }
.pn-tier.is-fast .pn-meter span { background: #ff2bd6; box-shadow: 0 0 12px rgba(255, 43, 214, .7); }
.pn-btn {
  position: relative;
  z-index: 0;
  isolation: isolate;
  overflow: hidden;
  width: 100%;
  border: 1px solid #ff2bd6;
  background: #ff2bd6;
  color: #14010e;
  padding: 13px 16px;
  font: inherit;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 0 18px rgba(255, 43, 214, .35);
}
.pn-btn::before {
  content: "";
  position: absolute;
  inset: -140%;
  z-index: -2;
  background: conic-gradient(from 0deg, transparent 0 72%, #fff 84%, #3dfff2 92%, transparent 100%);
  animation: pn-orbit 1.15s linear 3 .7s;
}
.pn-btn::after {
  content: "";
  position: absolute;
  inset: 2px;
  z-index: -1;
  background: #ff2bd6;
}
.pn-btn.is-free {
  background: transparent;
  color: #3dfff2;
  border-color: #3dfff2;
  box-shadow: 0 0 16px rgba(61, 255, 242, .25);
}
.pn-btn.is-free::after { background: #070612; }
.pn-btn:disabled { cursor: wait; }
.pn-wallet {
  margin-top: 12px;
  padding: 12px;
  background: rgba(61, 255, 242, .08);
  color: #d8fbff;
  font-size: 13px;
  line-height: 1.45;
}
.pn-wallet a {
  display: block;
  margin-top: 10px;
  text-align: center;
  text-decoration: none;
  padding: 11px 14px;
  background: #3dfff2;
  color: #041216;
  font-weight: 800;
  letter-spacing: .06em;
  text-transform: uppercase;
}
.pn-status { margin-bottom: 16px; color: #9ad7ff; line-height: 1.45; }
.pn-status.is-error { color: #ff8fab; }
.pn-panel::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  background: linear-gradient(115deg, transparent 36%, rgba(255, 255, 255, .55), transparent 64%);
  transform: translateX(-130%);
  animation: pn-sheen .9s ease .2s both;
}
@keyframes pn-panel-in {
  from { opacity: 0; transform: translateY(18px) scale(.97); }
  to { opacity: 1; transform: none; }
}
@keyframes pn-flag {
  from { opacity: 0; transform: rotate(-16deg) scale(.25); }
  to { opacity: 1; transform: none; }
}
@keyframes pn-glitch {
  0% { opacity: 0; transform: translateX(-12px); text-shadow: 7px 0 #ff2bd6, -7px 0 #3dfff2; }
  40% { opacity: 1; transform: translateX(6px); }
  70% { transform: translateX(-3px); text-shadow: -5px 0 #ff2bd6, 5px 0 #3dfff2; }
  100% { transform: none; text-shadow: 0 0 18px rgba(61, 255, 242, .75), 2px 0 #ff2bd6; }
}
@keyframes pn-rise {
  from { opacity: 0; transform: translateY(26px); }
  to { opacity: 1; transform: none; }
}
@keyframes pn-fill { to { width: var(--meter, 100%); } }
@keyframes pn-orbit { to { transform: rotate(1turn); } }
@keyframes pn-sheen { to { transform: translateX(130%); } }
@media (prefers-reduced-motion: reduce) {
  .pn-panel, .pn-panel::before, .pn-pirate, .pn h1, .pn-tier, .pn-meter span, .pn-btn::before {
    animation: none;
  }
  .pn-meter span { width: var(--meter, 100%); }
}
`;
