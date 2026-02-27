# MeshLink Broker

The **MeshLink Broker** is the captive portal and access management server that runs on each MeshLink node (Raspberry Pi). It provides the web interface for connecting users, processes payments, enforces bandwidth tiers via iptables/ipset, and exposes admin/analytics APIs.

## Features

- **Captive Portal UI** — React + Tailwind + shadcn/ui interface shown to devices joining the MeshLink WiFi network
- **Tiered Access Control** — Free, Lightweight, and Premium tiers with configurable bandwidth limits, data caps, and durations
- **Stripe Checkout Integration** — Server-side Checkout Sessions with temporary access grant during payment flow (see [STRIPE_SETUP.md](STRIPE_SETUP.md))
- **Network Management** — iptables REDIRECT + ipset-based client authorization, managed programmatically from the broker
- **Admin Dashboard** — Built-in admin UI at `/admin` with session management, analytics, and database viewer
- **SQLite Storage** — All sessions, users, and analytics stored locally with no external database dependency
- **REST API** — Full API for config, health, network clients, sessions, analytics, and payments

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui, Recharts, wouter |
| Backend | Node.js, Express, TypeScript, ESM |
| Database | SQLite (better-sqlite3) |
| Payments | Stripe Checkout Sessions |
| Networking | iptables, ipset, hostapd, dnsmasq |
| Hardware | Raspberry Pi 5 (Debian Trixie) |

## Repository Structure

```
broker/
├── client/               # React frontend (Vite)
│   ├── src/
│   │   ├── pages/        # Captive portal, dashboard, admin
│   │   ├── components/   # UI components (shadcn/ui + custom)
│   │   ├── hooks/        # React Query hooks
│   │   └── lib/          # Utilities, query client
│   └── index.html
├── server/
│   ├── index.ts          # Express entry point (port 3000)
│   ├── routes.ts         # All API routes
│   ├── vite.ts           # Dev/prod serving
│   ├── storage.ts        # SQLite database layer
│   ├── network-manager.ts # iptables/ipset management
│   └── config/
│       └── meshlink-config.json  # Tier, branding, and feature config
├── shared/               # Shared TypeScript types
├── package.json
├── vite.config.ts
├── tsconfig.json
└── tailwind.config.ts
```

## Running Locally

**Prerequisites:** Node.js v18+

```bash
cd broker
npm install
npm run dev
```

Open **http://localhost:3000**. The dev server serves both the API and the React frontend with HMR.

For production: `npm run build && npm start`

## Configuring Tiers

Edit **`server/config/meshlink-config.json`** — changes take effect without restarting.

### Key tier fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (e.g. `free`, `premium`). Used for traffic shaping. |
| `name` | string | Display name on the portal. |
| `fiatPrice` | number | Price in USD for Stripe. `0` for free tiers. |
| `dataLimitMB` | number | Data cap in megabytes. |
| `durationHours` | number | Access duration (e.g. `24` = 1 day). |
| `speedMbps` | number | Bandwidth limit for QoS. |
| `isFree` | boolean | `true` skips the payment step. |
| `acceptStripePayments` | boolean | Enable Stripe Checkout for this tier. |
| `acceptCryptoPayments` | boolean | Enable crypto payments (if feature enabled). |

### Other config sections

- **`nodeInfo`** — Node name, location, operator (shown on portal)
- **`branding`** — Logo text, tagline, colors
- **`features`** — Global toggles (crypto, wallet, redirect URL)
- **`payments.stripe`** — Stripe on/off, currency, payment methods
- **`admin`** — Dashboard password and enable/disable

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check + uptime |
| GET | `/api/config` | No | Public node/tier config |
| GET | `/api/network/clients` | No | Connected clients list |
| DELETE | `/api/network/clients/:ip` | No | Disconnect a client |
| POST | `/api/admin/login` | No | Get admin token |
| GET | `/api/admin/analytics` | Bearer | Session/revenue analytics |
| GET | `/api/admin/sessions` | Bearer | Paginated session list |
| DELETE | `/api/admin/sessions/:id` | Bearer | Revoke a session |
| POST | `/api/payment/create-checkout` | No | Create Stripe Checkout Session |
| POST | `/api/complete-payment` | No | Verify Stripe payment + grant access |

## Deployment

See [RASPBERRY_PI_DEPLOYMENT.md](RASPBERRY_PI_DEPLOYMENT.md) for Raspberry Pi setup and [STRIPE_SETUP.md](STRIPE_SETUP.md) for payment configuration.

## Related Docs

- [STRIPE_SETUP.md](STRIPE_SETUP.md) — Stripe Checkout integration guide
- [ACCESS_MANAGEMENT.md](ACCESS_MANAGEMENT.md) — ipset-based access control details
- [RASPBERRY_PI_DEPLOYMENT.md](RASPBERRY_PI_DEPLOYMENT.md) — Pi 5 deployment guide
- [OPENWRT_DEPLOYMENT.md](OPENWRT_DEPLOYMENT.md) — OpenWRT deployment guide
- [MESHLINK_WHITEPAPER.md](MESHLINK_WHITEPAPER.md) — Full protocol whitepaper
- [SECURITY.md](SECURITY.md) — Security policy
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines
