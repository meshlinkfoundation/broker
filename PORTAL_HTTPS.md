# Optional trusted portal hostname

A normal node does not need this. The installer creates a self-signed certificate for `portal.meshlink`, phones do not trust it, and the sign-in sheet stays on HTTP. Do the steps below only when an operator asks for a public name and a certificate browsers will accept.

## What stays on HTTP

Phones discover a captive portal by requesting plain HTTP pages such as `http://captive.apple.com/hotspot-detect.html`. Those probes stay on HTTP. The gateway does not hijack `captive.apple.com` or `connectivitycheck.gstatic.com`, and it does not intercept internet traffic on port 443. Forcing detection onto HTTPS makes phones show "Unable to join" instead of the sign-in sheet.

HTTPS is only for the portal hostname the operator chose.

## What the broker does with a trusted certificate

The gateway installer stores the hostname and certificate paths in `/etc/meshlink/gateway.conf`. The broker reads them when it starts (`server/portal-tls.ts`):

- `MESHLINK_PORTAL_HOST` is the public name.
- `MESHLINK_TLS_CERT` and `MESHLINK_TLS_KEY` point at the PEM files, normally `/etc/meshlink/tls/portal.crt` and `/etc/meshlink/tls/portal.key`.
- `MESHLINK_TLS_TRUSTED=1` means the certificate is publicly trusted. `0` means the self-signed default.

When the certificate is trusted, two things change:

1. A browser that opens the portal hostname over HTTP is redirected to `https://that-name/`. Captive-detection hosts are not redirected. The operator dashboard at `/admin` is not sent to the guest name.
2. DHCP option 114 advertises `https://that-name/api/captive-portal`. That option is omitted for a self-signed certificate.

The TLS listener is on port 3443. The gateway redirects port 443 that is addressed to the portal host to that port. Guests resolve the name to the access-point address (`192.168.50.1`) through dnsmasq, so the phone never needs a public IP for the Pi.

## Name and certificate

Pick a hostname on a domain the operator controls, for example `wifi.example.com`.

Issue the certificate with Let's Encrypt DNS-01. That works from the Pi's Ethernet connection and does not require the Pi to be reachable from the internet. HTTP-01 only works if port 80 on a public address forwards to this machine, which a node behind a home router usually is not.

```bash
sudo apt install -y certbot
sudo certbot certonly --manual --preferred-challenges dns -d wifi.example.com
```

Certbot prints a TXT record. Add that record at the DNS host, wait until it resolves, and continue. Certbot writes `fullchain.pem` and `privkey.pem` under `/etc/letsencrypt/live/wifi.example.com/`.

Point the node at that name and those files. This is a second installer run. It does not happen on a fresh install unless these flags are passed:

```bash
bash install.sh \
  --portal-host wifi.example.com \
  --tls-cert /etc/letsencrypt/live/wifi.example.com/fullchain.pem \
  --tls-key /etc/letsencrypt/live/wifi.example.com/privkey.pem
```

The installer copies the files to `/etc/meshlink/tls/`, sets `MESHLINK_TLS_TRUSTED=1`, and makes dnsmasq answer `wifi.example.com` with `192.168.50.1`.

## Renewal

Let's Encrypt certificates expire. Certbot's copies live under `/etc/letsencrypt/`. The broker reads `/etc/meshlink/tls/`. A deploy hook copies the renewed files into place and restarts the broker. Replace `meshlink` with the user that runs the broker service.

```bash
sudo tee /etc/letsencrypt/renewal-hooks/deploy/meshlink.sh >/dev/null <<'EOF'
#!/bin/sh
install -m 644 -o root -g meshlink "$RENEWED_LINEAGE/fullchain.pem" /etc/meshlink/tls/portal.crt
install -m 640 -o root -g meshlink "$RENEWED_LINEAGE/privkey.pem" /etc/meshlink/tls/portal.key
systemctl restart meshlink-broker
EOF
sudo chmod 755 /etc/letsencrypt/renewal-hooks/deploy/meshlink.sh
```

Check the hook with `sudo certbot renew --dry-run`. The gateway installer does not request or renew certificates.
