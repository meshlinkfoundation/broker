# meshlink Raspberry Pi 5 Deployment Guide

Complete guide for deploying meshlink hotspot management on Raspberry Pi 5 with OpenWRT or Raspberry Pi OS.

## Hardware Requirements

- **Raspberry Pi 5** (4GB+ RAM recommended)
- **MicroSD card** (32GB+ Class 10)
- **WiFi USB adapter** (for dual-radio setup) or use built-in WiFi
- **Ethernet connection** for internet uplink
- **Power supply** (27W USB-C recommended)

## Option 1: OpenWRT Installation (Recommended for Production)

### 1. Flash OpenWRT to Raspberry Pi 5

```bash
# Download OpenWRT for RPi5
wget https://downloads.openwrt.org/snapshots/targets/bcm27xx/bcm2712/openwrt-bcm27xx-bcm2712-rpi-5-ext4-factory.img.gz

# Flash to SD card (replace /dev/sdX with your SD card)
gunzip -c openwrt-bcm27xx-bcm2712-rpi-5-ext4-factory.img.gz | sudo dd of=/dev/sdX bs=4M status=progress
```

### 2. Initial OpenWRT Setup

1. Insert SD card and boot Raspberry Pi 5
2. Connect via Ethernet to 192.168.1.1
3. Set root password and enable SSH

```bash
# SSH into OpenWRT
ssh root@192.168.1.1

# Update package lists
opkg update

# Install required packages
opkg install nodejs npm git curl wget ca-certificates
```

### 3. Network Configuration

Edit `/etc/config/network`:

```uci
# Configure WiFi interface for hotspot
config interface 'hotspot'
    option ifname 'wlan0'
    option proto 'static'
    option ipaddr '10.82.1.1'
    option netmask '255.255.255.0'
    option gateway '192.168.1.1'
    option dns '8.8.8.8 8.8.4.4'
```

Edit `/etc/config/wireless`:

```uci
config wifi-device 'radio0'
    option type 'mac80211'
    option channel '6'
    option hwmode '11g'
    option path 'platform/soc/1000120000.mmc/mmc_host/mmc1/mmc1:0001/mmc1:0001:1'
    option htmode 'HT20'
    option country 'US'

config wifi-iface 'hotspot'
    option device 'radio0'
    option network 'hotspot'
    option mode 'ap'
    option ssid 'meshlink_Free'
    option encryption 'none'
    option isolate '1'
```

### 4. Deploy meshlink Application

```bash
# Create application directory
mkdir -p /opt/meshlink
cd /opt/meshlink

# Clone repository (replace with your repo)
git clone https://github.com/your-username/meshlink.git .

# Install dependencies
npm install

# Create production environment file
cat > .env << EOF
NODE_ENV=production
PORT=3000
DATABASE_PATH=/opt/meshlink/data/meshlink.db
EOF

# Create data directory
mkdir -p /opt/meshlink/data

# Build application
npm run build

# Test run
npm start
```

### 5. Configure Captive Portal

Edit `/etc/config/dhcp`:

```uci
config dnsmasq
    option domainneeded '1'
    option boguspriv '1'
    option filterwin2k '0'
    option localise_queries '1'
    option rebind_protection '1'
    option rebind_localhost '1'
    option local '/lan/'
    option domain 'lan'
    option expandhosts '1'
    option nonegcache '0'
    option authoritative '1'
    option readethers '1'
    option leasefile '/tmp/dhcp.leases'
    option resolvfile '/tmp/resolv.conf.auto'
    option nonwildcard '1'
    option localservice '1'
    option address '/meshlink.local/10.82.1.1'

config dhcp 'hotspot'
    option interface 'hotspot'
    option start '100'
    option limit '150'
    option leasetime '12h'
    option force '1'
```

### 6. Configure Firewall for Captive Portal

Edit `/etc/config/firewall`:

```uci
config zone
    option name 'hotspot'
    option input 'REJECT'
    option output 'ACCEPT'
    option forward 'REJECT'
    option network 'hotspot'

config rule
    option name 'Allow-meshlink-HTTP'
    option src 'hotspot'
    option dest_port '80 443 3000'
    option target 'ACCEPT'
    option proto 'tcp'

config rule
    option name 'Allow-meshlink-DNS'
    option src 'hotspot'
    option dest_port '53'
    option target 'ACCEPT'
    option proto 'udp'

config rule
    option name 'Allow-meshlink-DHCP'
    option src 'hotspot'
    option dest_port '67'
    option target 'ACCEPT'
    option proto 'udp'

config redirect
    option target 'DNAT'
    option src 'hotspot'
    option dest 'lan'
    option proto 'tcp'
    option src_dport '80'
    option dest_ip '10.82.1.1'
    option dest_port '3000'
    option name 'Captive-Portal-Redirect'
```

### 7. Create System Service

Create `/etc/init.d/meshlink`:

```bash
#!/bin/sh /etc/rc.common

START=99
STOP=10

USE_PROCD=1
PROG=/usr/bin/node
MESHLINK_DIR=/opt/meshlink

start_service() {
    procd_open_instance
    procd_set_param command $PROG $MESHLINK_DIR/server/index.js
    procd_set_param cwd $MESHLINK_DIR
    procd_set_param env NODE_ENV=production
    procd_set_param user root
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param respawn
    procd_close_instance
}
```

Make executable and enable:

```bash
chmod +x /etc/init.d/meshlink
/etc/init.d/meshlink enable
/etc/init.d/meshlink start
```

## Option 2: Raspberry Pi OS Installation (Tested & Working)

> **Tested on:** Raspberry Pi 5, Raspberry Pi OS (Debian 13 Trixie), NetworkManager

### 1. Install Raspberry Pi OS

1. Use Raspberry Pi Imager to flash **Raspberry Pi OS** (Desktop or Lite, 64-bit)
2. Configure hostname, user account (`meshlink`), and **enable SSH** in imager settings
3. Connect the Pi via Ethernet and SSH in

### 2. Update the System

```bash
ssh meshlink@<pi-ip-address>
sudo apt update -y && sudo apt upgrade -y
```

### 3. Run the meshlink Installer

The `meshlink-wifi-gateway/install.sh` script handles **everything** end-to-end:
- System packages (hostapd, dnsmasq, iptables, iw, rfkill)
- WiFi radio unblock (soft-blocked by default on Pi 5)
- NetworkManager configured to ignore wlan0
- Static IP on wlan0, hostapd (WPA2 AP), dnsmasq (DHCP + DNS)
- IP forwarding and NAT (masquerade)
- Captive portal redirect (iptables REDIRECT port 80 → broker)
- Node.js 20 install
- Broker build (`npm install && npm run build`)
- Systemd services for boot persistence

```bash
# Clone the repo
git clone <repo-url>
cd meshlink/meshlink-wifi-gateway

# Run the installer (does everything)
bash install.sh
```

Default AP settings (edit variables at top of `install.sh` to customize):

| Setting | Default |
|---------|---------|
| SSID | `meshlink` |
| Password | `meshlink2025` |
| Gateway IP | `192.168.50.1` |
| DHCP range | `192.168.50.10` - `192.168.50.100` |
| Channel | 6 (2.4 GHz) |
| Broker port | 3000 |

### 4. Verify Everything

After the installer finishes, it runs verification checks automatically. You can also check manually:

```bash
# All services should be active
for svc in meshlink-network hostapd dnsmasq meshlink-broker; do
  echo "$svc: $(systemctl is-active $svc)"
done

# wlan0 should show 192.168.50.1
ip addr show wlan0

# Broker should respond
curl -s http://192.168.50.1:3000/api/health

# REDIRECT rule should be present
sudo iptables -t nat -L PREROUTING -n
```

### 5. Test the Captive Portal

1. Connect a phone/laptop to the **meshlink** WiFi (password: `meshlink2025`)
2. The device should show a "Sign in to WiFi" notification or popup
3. Tapping it opens the meshlink landing page
4. If it doesn't appear, **forget the network and reconnect**

#### Key differences from older Raspberry Pi OS (Bookworm and earlier)

- **NetworkManager** is used instead of dhcpcd. The installer creates `/etc/NetworkManager/conf.d/99-meshlink-unmanaged.conf` to prevent NM from managing wlan0.
- **WiFi is RF-blocked by default** on Pi 5. The installer runs `rfkill unblock wlan` (must happen AFTER NetworkManager restart).
- **sysctl** is at `/usr/sbin/sysctl`. The installer uses `/etc/sysctl.d/99-meshlink.conf` drop-in.
- **dnsmasq** requires `bind-interfaces`, `listen-address`, and `IGNORE_RESOLVCONF=yes` to prevent breaking the Pi's own DNS (which kills SSH).
- A **meshlink-network.service** systemd unit handles rfkill, wlan0 IP, and iptables restore on boot.
- Captive portal uses **iptables REDIRECT** (not DNAT) — DNAT to local IPs has routing issues on this platform.

## Configuration Management

### 1. Update meshlink Configuration

Edit `server/config/meshlink-config.json`:

```json
{
  "nodeInfo": {
    "name": "meshlink_MyNode",
    "location": "Your Location",
    "operator": "Your Name"
  },
  "pricing": {
    "currency": "MESH",
    "fiatCurrency": "USD",
    "tiers": [
      {
        "id": "free",
        "name": "Free Access",
        "description": "Basic internet for browsing and messaging",
        "price": 0,
        "fiatPrice": 0,
        "dataLimitMB": 500,
        "durationHours": 24,
        "speedMbps": 1,
        "buttonText": "Connect Free",
        "buttonColor": "green",
        "isFree": true,
        "acceptStripePayments": false,
        "acceptCryptoPayments": false
      }
    ]
  },
  "features": {
    "enableCrypto": false
  },
  "stripe": {
    "enabled": false
  }
}
```

### 2. Set Up Stripe Payments (Optional)

If you want to accept payments:

1. Create Stripe account at https://stripe.com
2. Get your API keys from dashboard
3. Create payment links for each tier
4. Update configuration with Stripe keys and payment links

### 3. Database Management

meshlink uses SQLite by default. Database file location:
- OpenWRT: `/opt/meshlink/data/meshlink.db`
- Raspberry Pi OS: `/home/pi/meshlink/meshlink.db`

Access admin dashboard at: `http://10.82.1.1:3000/admin`
Default password: `admin` (change in config)

## Network Management Features

### Traffic Shaping

meshlink automatically configures:
- **tc (traffic control)** for bandwidth limiting
- **iptables** for client isolation and firewall rules
- **ipset** for efficient client management

### Client Isolation

Each connected client is isolated from others for security:
- Prevents direct client-to-client communication
- Routes all traffic through the gateway
- Maintains session-based access control

### Session Management

- Real-time client tracking
- Automatic session expiration
- Data usage monitoring
- Bandwidth tier enforcement

## Monitoring and Maintenance

### View Logs

```bash
# meshlink application logs
journalctl -u meshlink -f

# System logs
tail -f /var/log/syslog

# Network interface status
ip addr show
iwconfig
```

### Performance Monitoring

```bash
# Check connected clients
cat /tmp/dhcp.leases

# Monitor bandwidth usage
iftop -i wlan0

# Check memory and CPU
htop
```

### Updates

```bash
cd /opt/meshlink  # or /home/pi/meshlink
git pull
npm install
sudo systemctl restart meshlink
```

## Security Considerations

1. **Change default passwords** in meshlink config
2. **Enable firewall rules** to protect management interface
3. **Use HTTPS** in production with SSL certificates
4. **Regular updates** of system and meshlink software
5. **Monitor access logs** for unusual activity

## Troubleshooting

### Common Issues

**WiFi AP not starting:**
```bash
sudo systemctl status hostapd
sudo systemctl restart hostapd
```

**DHCP not working:**
```bash
sudo systemctl status dnsmasq
sudo systemctl restart dnsmasq
```

**meshlink not accessible:**
```bash
sudo systemctl status meshlink
curl http://localhost:3000/api/health
```

**Traffic shaping not working:**
```bash
tc qdisc show dev wlan0
iptables -L -n -v
```

This deployment creates a production-ready hotspot management system on your Raspberry Pi 5 with all the features you've configured including the 3-tier pricing structure, admin dashboard, and real-time client management.