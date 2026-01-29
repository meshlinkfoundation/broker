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

## Scope & Stability

This repository provides the reference implementation of the MeshLink broker captive portal. It is intended to be stable and infrastructure-oriented.

Experimental UI/UX changes and demos live in buildwithparallel repositories.

## Technical notes

- Plain HTML for the UI; no build step required.
- Responsive viewport meta tag is set for mobile-friendly display.
- This repo provides the captive portal UI and configuration used by MeshLink access points; redirect and authentication behavior is driven by this code in conjunction with your network/gateway setup.
