# broker

Code that supports the **captive portal UI** and **configuration** for MeshLink access points. This repository provides the web interface and configuration logic used when devices connect to a MeshLink network and interact with the broker (e.g., accept terms or authenticate) before gaining full access.

## What it does

- **Captive portal UI**: The web pages and assets shown when a device joins a MeshLink network and is redirected to the broker—including the MeshLink Broker welcome experience and navigation (Home, About, Contact).
- **Configuration for MeshLink access points**: Logic and data used to configure and drive the captive portal behavior on MeshLink access points.
- **Static, hostable assets**: HTML, styles, and scripts that can be served by any web server or embedded in a captive-portal system.

## Repository structure

| File        | Purpose                                      |
|------------|-----------------------------------------------|
| `index.html` | Main captive portal page (MeshLink Broker UI) |
| `README.md`  | This documentation                            |

The page references `styles.css` and `script.js`; add those in the same directory if you want custom styling or client-side behavior.

## Running locally

1. **Prerequisites**: **Node.js v18 or later** is required. Check with `node -v`. If you're on Node 16 or older:
   - With **nvm**: `nvm install 20` then `nvm use 20`
   - With **Homebrew**: `brew install node@20` and ensure it's on your PATH
   - Or install the LTS version from [nodejs.org](https://nodejs.org)
2. **Install dependencies** (from the repo root):
   ```bash
   npm install
   ```
   If you previously ran `npm install` with Node 16, remove `node_modules` first: `rm -rf node_modules && npm install`.
3. **Start the dev server** (serves both the API and the captive portal UI):
   ```bash
   npm run dev
   ```
4. Open **http://localhost:3000** in your browser.

For production: run `npm run build`, then `npm start` to serve the built app.

## How to use

1. **Host the page**: Serve the repo (or at least `index.html`) from a web server that your captive-portal / MeshLink setup redirects users to.
2. **Customize**: Edit `index.html` to change copy, links, or structure. Add `styles.css` and `script.js` as needed.
3. **Integrate**: Point your MeshLink broker / gateway to this URL so that unauthenticated or new users see this page.

## Configuring tiers (AP operators)

Access point operators configure the captive portal’s plan options (tiers) by editing **`server/config/meshlink-config.json`**. The file is read on every request, so changes take effect without restarting the server.

### Where to edit

- **File**: `server/config/meshlink-config.json`
- **Section**: `pricing.tiers` — an array of tier objects. Add, remove, or reorder entries to change the plans users see.

### Tier object fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique ID (e.g. `free`, `premium`). Used internally and for traffic shaping. |
| `name` | string | Display name shown on the portal (e.g. "Free Access", "Premium Speed"). |
| `description` | string | Short description under the tier name. |
| `price` | number | Price in the crypto currency defined in `pricing.currency` (e.g. MESH). Use `0` for free. |
| `fiatPrice` | number | Price in fiat (e.g. USD) for display and Stripe. Use `0` for free. |
| `dataLimitMB` | number | Data cap in megabytes (for display and enforcement if implemented). |
| `durationHours` | number | Access duration in hours (e.g. `24` = 1 day, `168` = 1 week). |
| `speedMbps` | number or string | Speed in Mbps (for display and QoS if configured). |
| `features` | string[] | List of bullet points (e.g. `["1 Mbps speed", "Web browsing"]`). |
| `buttonText` | string | Label on the plan’s button (e.g. "Connect Free", "Pay $4.99"). |
| `buttonColor` | string | Theme: `green`, `blue`, `purple`, etc. |
| `isFree` | boolean | `true` for free tier; affects flow (no payment step). |
| `isPopular` | boolean | `true` to show a “Popular” badge on the card. |
| `acceptStripePayments` | boolean | Whether this tier can be paid via Stripe. |
| `acceptCryptoPayments` | boolean | Whether this tier can be paid via crypto (if enabled in `features`). |
| `stripePaymentLink` | string (optional) | Stripe Payment Link URL for this tier. Required if `acceptStripePayments` is `true`. |

### Example: adding a tier

Add a new object to `pricing.tiers`:

```json
{
  "id": "premium",
  "name": "Premium Speed",
  "description": "High-speed access for one week.",
  "price": 50,
  "fiatPrice": 4.99,
  "dataLimitMB": 5120,
  "durationHours": 168,
  "speedMbps": 50,
  "features": ["5GB limit", "50 Mbps", "7 days"],
  "buttonText": "Pay $4.99",
  "buttonColor": "blue",
  "isFree": false,
  "isPopular": true,
  "acceptStripePayments": true,
  "acceptCryptoPayments": false,
  "stripePaymentLink": "https://buy.stripe.com/your_link_here"
}
```

### Other config in the same file

- **`pricing.currency`** / **`pricing.fiatCurrency`**: Currency codes for crypto and fiat.
- **`nodeInfo`**: Name, location, operator — shown on the portal.
- **`branding`**: Logo text, tagline, colors.
- **`features`**: Global toggles (e.g. crypto, wallet, redirect URL).
- **`stripe`**: Global Stripe on/off and currency.
- **`admin`**: Dashboard password and enable/disable; change default in production.

Save `meshlink-config.json` with valid JSON (no trailing commas). Reload the captive portal page to see updated tiers.

## Scope & Stability

This repository provides the reference implementation of the MeshLink broker captive portal. It is intended to be stable and infrastructure-oriented.

Experimental UI/UX changes and demos live in buildwithparallel repositories.

## Technical notes

- Plain HTML for the UI; no build step required.
- Responsive viewport meta tag is set for mobile-friendly display.
- This repo provides the captive portal UI and configuration used by MeshLink access points; redirect and authentication behavior is driven by this code in conjunction with your network/gateway setup.
