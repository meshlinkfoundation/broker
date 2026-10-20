# OpenWRT Deployment Guide for meshlink Captive Portal

This guide explains how to deploy the meshlink captive portal on a Raspberry Pi 5 running OpenWRT with proper bandwidth management and QoS controls.

## Prerequisites

- Raspberry Pi 5 with OpenWRT 23.05.x or newer
- Internet connection via ethernet or USB-C
- WiFi adapter configured as access point
- SSH access to the OpenWRT device

## 1. OpenWRT Initial Setup

### Install Required Packages

```bash
# Update package lists
opkg update

# Install essential packages
opkg install node npm git sqm-scripts ipset iptables-mod-ipset

# Install networking tools
opkg install hostapd wpad-openssl dnsmasq-full

# Install development tools
opkg install make gcc binutils
```

### Configure Network Interfaces

Edit `/etc/config/network`:

```bash
uci set network.lan.proto='static'
uci set network.lan.ipaddr='192.168.1.1'
uci set network.lan.netmask='255.255.255.0'
uci set network.lan.ip6assign='60'

# Configure WiFi interface for captive portal
uci set network.hotspot=interface
uci set network.hotspot.proto='static'
uci set network.hotspot.ipaddr='10.10.10.1'
uci set network.hotspot.netmask='255.255.255.0'
uci commit network
```

### Configure Wireless Access Point

Edit `/etc/config/wireless`:

```bash
# Enable WiFi
uci set wireless.radio0.disabled='0'
uci set wireless.radio0.country='US'
uci set wireless.radio0.channel='6'

# Configure access point
uci set wireless.default_radio0.device='radio0'
uci set wireless.default_radio0.network='hotspot'
uci set wireless.default_radio0.mode='ap'
uci set wireless.default_radio0.ssid='meshlink_Free'
uci set wireless.default_radio0.encryption='none'
uci set wireless.default_radio0.isolate='1'

uci commit wireless
wifi reload
```

## 2. Traffic Control Setup

### Configure SQM QoS

Create SQM configuration for bandwidth tiers:

```bash
# Install and configure SQM
opkg install sqm-scripts luci-app-sqm

# Configure base SQM settings
uci set sqm.eth0=queue
uci set sqm.eth0.interface='br-lan'
uci set sqm.eth0.enabled='1'
uci set sqm.eth0.download='100000'  # 100 Mbps
uci set sqm.eth0.upload='50000'     # 50 Mbps
uci set sqm.eth0.script='piece_of_cake.qos'

uci commit sqm
/etc/init.d/sqm restart
```

### Create IPSets for Client Classification

```bash
# Create persistent ipsets
cat > /etc/init.d/meshlink-ipsets << 'EOF'
#!/bin/sh /etc/rc.common

START=19
STOP=91

start() {
    # Create ipsets for each tier
    ipset create free_clients hash:ip -exist
    ipset create premium_clients hash:ip -exist
    ipset create unlimited_clients hash:ip -exist
    
    echo "meshlink ipsets created"
}

stop() {
    # Clean up ipsets
    ipset destroy free_clients 2>/dev/null
    ipset destroy premium_clients 2>/dev/null
    ipset destroy unlimited_clients 2>/dev/null
    
    echo "meshlink ipsets destroyed"
}

restart() {
    stop
    start
}
EOF

chmod +x /etc/init.d/meshlink-ipsets
/etc/init.d/meshlink-ipsets enable
/etc/init.d/meshlink-ipsets start
```

### Configure Firewall Rules

Add iptables rules for traffic marking:

```bash
# Create firewall include for meshlink
cat > /etc/firewall.meshlink << 'EOF'
#!/bin/sh

# Clear existing meshlink rules
iptables -t mangle -F PREROUTING 2>/dev/null

# Mark packets from different tiers
iptables -t mangle -A PREROUTING -m set --match-set free_clients src -j MARK --set-mark 10
iptables -t mangle -A PREROUTING -m set --match-set premium_clients src -j MARK --set-mark 20
iptables -t mangle -A PREROUTING -m set --match-set unlimited_clients src -j MARK --set-mark 30

# Traffic control based on marks
tc qdisc add dev br-lan root handle 1: htb default 30 2>/dev/null || true

# Free tier: 1 Mbps download, 500 Kbps upload
tc class add dev br-lan parent 1: classid 1:10 htb rate 1000kbit ceil 1000kbit 2>/dev/null || true
tc filter add dev br-lan protocol ip parent 1: prio 1 handle 10 fw flowid 1:10 2>/dev/null || true

# Premium tier: 50 Mbps download, 10 Mbps upload  
tc class add dev br-lan parent 1: classid 1:20 htb rate 50000kbit ceil 50000kbit 2>/dev/null || true
tc filter add dev br-lan protocol ip parent 1: prio 2 handle 20 fw flowid 1:20 2>/dev/null || true

# Unlimited tier: 100 Mbps download, 50 Mbps upload
tc class add dev br-lan parent 1: classid 1:30 htb rate 100000kbit ceil 100000kbit 2>/dev/null || true
tc filter add dev br-lan protocol ip parent 1: prio 3 handle 30 fw flowid 1:30 2>/dev/null || true

echo "meshlink traffic control configured"
EOF

chmod +x /etc/firewall.meshlink

# Add to firewall configuration
uci add firewall include
uci set firewall.@include[-1].path='/etc/firewall.meshlink'
uci set firewall.@include[-1].reload='1'
uci commit firewall
```

## 3. Captive Portal Setup

### Configure DHCP for Captive Portal

Edit DHCP configuration:

```bash
# Configure dnsmasq for captive portal
uci set dhcp.@dnsmasq[0].interface='br-lan,hotspot'
uci set dhcp.@dnsmasq[0].address='/#/10.10.10.1'
uci set dhcp.@dnsmasq[0].rebind_protection='0'
uci set dhcp.@dnsmasq[0].dns_redirect='1'

# Set DHCP range for hotspot
uci set dhcp.hotspot=dhcp
uci set dhcp.hotspot.interface='hotspot'
uci set dhcp.hotspot.start='100'
uci set dhcp.hotspot.limit='150'
uci set dhcp.hotspot.leasetime='1h'

uci commit dhcp
/etc/init.d/dnsmasq restart
```

### Deploy Node.js Application

```bash
# Create application directory
mkdir -p /opt/meshlink
cd /opt/meshlink

# Clone or upload your application
# (In production, upload your built application files)

# Install dependencies
npm install --production

# Create systemd service for the application
cat > /etc/init.d/meshlink << 'EOF'
#!/bin/sh /etc/rc.common

START=99
STOP=10

start() {
    cd /opt/meshlink
    export NODE_ENV=production
    export PORT=5000
    nohup node server/index.js > /var/log/meshlink.log 2>&1 &
    echo $! > /var/run/meshlink.pid
    echo "meshlink captive portal started"
}

stop() {
    if [ -f /var/run/meshlink.pid ]; then
        kill $(cat /var/run/meshlink.pid)
        rm /var/run/meshlink.pid
        echo "meshlink captive portal stopped"
    fi
}

restart() {
    stop
    sleep 2
    start
}
EOF

chmod +x /etc/init.d/meshlink
/etc/init.d/meshlink enable
```

## 4. Configuration Files

### Create meshlink Configuration

```bash
mkdir -p /opt/meshlink/server/config
cat > /opt/meshlink/server/config/meshlink-config.json << 'EOF'
{
  "nodeInfo": {
    "name": "meshlink_RaspberryPi",
    "location": "Community Hotspot",
    "operator": "Local Mesh Network"
  },
  "pricing": {
    "currency": "MESH",
    "fiatCurrency": "USD",
    "tiers": [
      {
        "id": "free",
        "name": "Free Access",
        "description": "Basic internet access with speed limits",
        "price": 0,
        "fiatPrice": 0,
        "dataLimitMB": 500,
        "durationHours": 24,
        "speedMbps": 1,
        "features": ["500MB data limit", "1 Mbps speed", "24 hour access"],
        "buttonText": "Connect for Free",
        "buttonColor": "green",
        "isFree": true,
        "isPopular": false,
        "acceptStripePayments": false,
        "acceptCryptoPayments": false
      },
      {
        "id": "premium",
        "name": "Premium Speed",
        "description": "High-speed internet for a week",
        "price": 50,
        "fiatPrice": 2.99,
        "dataLimitMB": 5120,
        "durationHours": 168,
        "speedMbps": 50,
        "features": ["5GB data limit", "50 Mbps speed", "7 days access"],
        "buttonText": "Get Premium",
        "buttonColor": "blue",
        "isFree": false,
        "isPopular": true,
        "acceptStripePayments": true,
        "acceptCryptoPayments": true
      }
    ]
  },
  "network": {
    "contractAddress": "",
    "chainId": 10,
    "chainName": "Optimism",
    "rpcUrl": "https://mainnet.optimism.io"
  },
  "branding": {
    "primaryColor": "#2563eb",
    "secondaryColor": "#64748b",
    "logoText": "meshlink",
    "tagline": "Community-Powered Internet Access",
    "showCommunityBadge": true
  },
  "features": {
    "enableWalletConnection": true,
    "requireWalletForPremium": false,
    "showTransactionDetails": true,
    "redirectAfterPayment": "https://www.google.com"
  },
  "stripe": {
    "enabled": true,
    "expressCheckout": true,
    "currency": "usd"
  }
}
EOF
```

## 5. Firewall and Captive Portal Rules

### Configure Captive Portal Redirection

```bash
# Create iptables rules for captive portal
cat > /etc/firewall.captive << 'EOF'
#!/bin/sh

# Redirect HTTP traffic to captive portal
iptables -t nat -A PREROUTING -i br-hotspot -p tcp --dport 80 -j DNAT --to-destination 10.10.10.1:5000
iptables -t nat -A PREROUTING -i br-hotspot -p tcp --dport 443 -j DNAT --to-destination 10.10.10.1:5000

# Allow access to captive portal
iptables -I FORWARD -i br-hotspot -o br-lan -d 10.10.10.1 -j ACCEPT
iptables -I FORWARD -i br-lan -o br-hotspot -s 10.10.10.1 -j ACCEPT

# Block internet access for unauthenticated users
iptables -I FORWARD -i br-hotspot -o br-lan -j DROP

echo "Captive portal redirection configured"
EOF

chmod +x /etc/firewall.captive

# Add to firewall includes
uci add firewall include
uci set firewall.@include[-1].path='/etc/firewall.captive'
uci set firewall.@include[-1].reload='1'
uci commit firewall
/etc/init.d/firewall restart
```

## 6. System Monitoring and Logs

### Configure Log Rotation

```bash
# Create logrotate configuration
cat > /etc/logrotate.d/meshlink << 'EOF'
/var/log/meshlink.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    postrotate
        /etc/init.d/meshlink restart
    endscript
}
EOF
```

### System Health Monitoring

```bash
# Create monitoring script
cat > /usr/bin/meshlink-monitor << 'EOF'
#!/bin/sh

# Check if meshlink service is running
if ! pgrep -f "node server/index.js" > /dev/null; then
    echo "$(date): meshlink service not running, restarting..." >> /var/log/meshlink-monitor.log
    /etc/init.d/meshlink restart
fi

# Check ipsets exist
for set in free_clients premium_clients unlimited_clients; do
    if ! ipset list $set > /dev/null 2>&1; then
        echo "$(date): IPSet $set missing, recreating..." >> /var/log/meshlink-monitor.log
        /etc/init.d/meshlink-ipsets restart
        /etc/firewall.meshlink
        break
    fi
done

# Check memory usage
MEM_USAGE=$(free | awk 'FNR==2{printf "%.2f", $3/($3+$4)*100}')
if [ $(echo "$MEM_USAGE > 90" | bc) -eq 1 ]; then
    echo "$(date): High memory usage: ${MEM_USAGE}%" >> /var/log/meshlink-monitor.log
fi
EOF

chmod +x /usr/bin/meshlink-monitor

# Add to crontab
echo "*/5 * * * * /usr/bin/meshlink-monitor" >> /etc/crontabs/root
/etc/init.d/cron restart
```

## 7. Deployment Steps

### 1. Prepare the System

```bash
# Update OpenWRT
opkg update && opkg upgrade

# Reboot to ensure clean state
reboot
```

### 2. Deploy Application

```bash
# Upload application files to /opt/meshlink
# Set permissions
chmod +x /opt/meshlink/server/index.js

# Start services
/etc/init.d/meshlink-ipsets start
/etc/init.d/meshlink start

# Apply firewall rules
/etc/firewall.meshlink
/etc/firewall.captive
```

### 3. Verify Deployment

```bash
# Check services
ps | grep node
ipset list
iptables -t mangle -L PREROUTING
tc qdisc show

# Test captive portal
curl -I http://10.10.10.1:5000
```

## 8. Network Management API

The system provides REST APIs for network management:

### Get Active Clients
```bash
curl http://10.10.10.1:5000/api/network/clients
```

### Remove Client from Tier
```bash
curl -X DELETE http://10.10.10.1:5000/api/network/clients/192.168.1.100
```

### Admin Dashboard
Access at: `http://10.10.10.1:5000/admin`
Password: `admin`

## 9. Troubleshooting

### Common Issues

1. **WiFi not broadcasting**: Check wireless configuration and country code
2. **No internet redirection**: Verify iptables NAT rules
3. **Bandwidth limits not working**: Check tc and ipset configurations
4. **High memory usage**: Monitor with `meshlink-monitor` script

### Debug Commands

```bash
# Check system status
/etc/init.d/meshlink status
logread | grep meshlink

# Network debugging
tc -s qdisc show
ipset list free_clients
iptables -t nat -L PREROUTING -v
```

## 10. Security Considerations

- Change default admin password
- Enable firewall logging for security events
- Regular security updates for OpenWRT
- Monitor network traffic for anomalies
- Implement rate limiting for API endpoints

This deployment guide provides a complete setup for running the meshlink captive portal on OpenWRT with proper bandwidth management and QoS controls.