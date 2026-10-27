# meshlink Broker

The **meshlink Broker** is the captive portal and access management server that runs on each meshlink node (Raspberry Pi). It provides the web interface for connecting users, processes payments, enforces bandwidth tiers via iptables/ipset, and exposes admin/analytics APIs.

## Features

- **Captive Portal UI** — React + Tailwind + shadcn/ui interface shown to devices joining the meshlink WiFi network
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
│   ├── service-profiles.ts # Profile loading and activation
│   └── config/
│       ├── meshlink-config.json  # Node, network, payment, and default tier config
│       └── profiles/             # Swappable pricing/branding profiles
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

### Other config sections

- **`nodeInfo`** — Node name, location, operator (shown on portal)
- **`branding`** — Logo text, tagline, colors
- **`features`** — Global toggles (redirect URL and optional payment methods)
- **`payments.stripe`** — Stripe on/off, currency, payment methods
- **`admin`** — Dashboard password and enable/disable

## Service Profiles

Service profiles let an operator switch the portal's branding and service tiers for a particular venue without changing the node's network, payment, or security settings. The included examples are:

- `farmers-market` — preview access, a market day pass, and a vendor pass
- `restaurant` — free guest access and a longer work session
- `marina-starlink` — harbor day and crew week plans
- `pirate-net` — the same default tiers, drawn as the neon Pirate Net page. It is not the sign-in page until this profile is activated.

To activate one on a node:

1. Open the node's `/admin` page and sign in.
2. Select **Profiles**.
3. Review the tiers, select **Activate Profile**, and confirm.

The change takes effect immediately and is saved across restarts. New signups see the selected profile; sessions that have already started keep their original price, duration, speed, and data allowance. Selecting **Default Node Configuration** switches back to the tiers in `meshlink-config.json`.

Profiles are JSON files in `server/config/profiles/`. A basic profile contains an ID, display name, optional branding, and a `pricing.tiers` array. Set `branding.logoText` to the venue name shown throughout the customer portal; when omitted, the profile name is used. Profiles intentionally cannot override node credentials, payment secrets, network interfaces, or security settings.

For automation, an operator can use the same admin bearer token as the dashboard:

```http
GET /api/admin/profiles
Authorization: Bearer <admin-token>

POST /api/admin/profiles/farmers-market/activate
Authorization: Bearer <admin-token>
```

The active selection is runtime state stored in `server/config/active-profile.json`; it should not be committed.

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | No | Health check + uptime |
| GET | `/api/config` | No | Public node/tier config |
| GET | `/api/network/clients` | Bearer | Connected clients list |
| DELETE | `/api/network/clients/:ip` | Bearer | Disconnect a client |
| POST | `/api/admin/login` | No | Get admin token |
| GET | `/api/admin/profiles` | Bearer | List profiles and active selection |
| POST | `/api/admin/profiles/:profileId/activate` | Bearer | Activate a profile immediately |
| GET | `/api/admin/analytics` | Bearer | Session/revenue analytics |
| GET | `/api/admin/sessions` | Bearer | Paginated session list |
| DELETE | `/api/admin/sessions/:id` | Bearer | Revoke a session |
| POST | `/api/payment/create-checkout` | No | Create Stripe Checkout Session |
| POST | `/api/complete-payment` | No | Verify Stripe payment + grant access |

## Deployment

See [RASPBERRY_PI_DEPLOYMENT.md](RASPBERRY_PI_DEPLOYMENT.md) for Raspberry Pi setup and [STRIPE_SETUP.md](STRIPE_SETUP.md) for card payments. MESH payments and the protocol whitepaper are in [meshlink-onchain](https://github.com/meshlinkfoundation/meshlink-onchain).

## Related Docs

- [STRIPE_SETUP.md](STRIPE_SETUP.md) — Stripe Checkout integration guide
- [ACCESS_MANAGEMENT.md](ACCESS_MANAGEMENT.md) — ipset-based access control details
- [RASPBERRY_PI_DEPLOYMENT.md](RASPBERRY_PI_DEPLOYMENT.md) — Pi 5 deployment guide
- [OPENWRT_DEPLOYMENT.md](OPENWRT_DEPLOYMENT.md) — OpenWRT deployment guide
- [SECURITY.md](SECURITY.md) — Security policy
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contribution guidelines
