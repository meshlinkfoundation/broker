import { exec } from 'child_process';
import { promisify } from 'util';
import { isIP } from 'net';

const execAsync = promisify(exec);

export class NetworkManager {
  private static instance: NetworkManager;
  private isLinux: boolean = false;
  private tcInitialized: boolean = false;
  private readonly WLAN_IFACE = this.getWifiInterface();
  private readonly TOTAL_BANDWIDTH_MBIT = 300;
  private readonly CAPTIVE_PORTAL_SPEED_MBIT = 20;
  private readonly WAN_IFACE = this.getWanInterface();
  private readonly usageCounters = new Map<string, { counter: number; total: number }>();

  private constructor() {}

  private getWifiInterface(): string {
    const iface = process.env.MESHLINK_AP_INTERFACE || 'wlan0';
    if (!/^[a-zA-Z0-9_.:-]{1,15}$/.test(iface)) {
      throw new Error(`Invalid MESHLINK_AP_INTERFACE: ${iface}`);
    }
    return iface;
  }

  private getWanInterface(): string {
    const iface = process.env.MESHLINK_WAN_INTERFACE || 'eth0';
    if (!/^[a-zA-Z0-9_.:-]{1,15}$/.test(iface)) {
      throw new Error(`Invalid MESHLINK_WAN_INTERFACE: ${iface}`);
    }
    return iface;
  }

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  private async detectEnvironment(): Promise<void> {
    try {
      await execAsync('which iptables || sudo which iptables');
      this.isLinux = true;
      console.log('[NetworkManager] Linux environment detected');
    } catch {
      this.isLinux = false;
      console.log('[NetworkManager] Development environment - simulation mode');
    }
  }

  private async sudoExec(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`sudo ${command}`);
      return stdout.trim();
    } catch (error: any) {
      console.error(`[NetworkManager] Command failed: sudo ${command}`, error.message);
      throw error;
    }
  }

  private normalizeClientIp(ip: string): string {
    const withoutMappedPrefix = ip.replace(/^::ffff:/, '');
    const normalizedIp = withoutMappedPrefix === '::1' ? '127.0.0.1' : withoutMappedPrefix;

    if (isIP(normalizedIp) !== 4) {
      throw new Error(`Invalid client IPv4 address: ${normalizedIp}`);
    }

    return normalizedIp;
  }

  getClientIp(req: any): string {
    // The broker is reached directly on the Pi. Do not trust X-Forwarded-For:
    // clients on the open AP can supply it themselves, and this value is later
    // passed to ipset/tc commands.
    const ip = req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
    return this.normalizeClientIp(ip);
  }

  async hasAccess(ip: string): Promise<boolean> {
    const normalizedIp = this.normalizeClientIp(ip);
    if (!this.isLinux) return false;

    try {
      await execAsync(`sudo /usr/sbin/ipset test meshlink_auth ${normalizedIp}`);
      return true;
    } catch {
      return false;
    }
  }

  private async initializeTrafficControl(): Promise<void> {
    try {
      // Wipe any existing root qdisc
      await this.sudoExec(`/usr/sbin/tc qdisc del dev ${this.WLAN_IFACE} root 2>/dev/null || true`);

      // Root HTB qdisc with default class 9999
      await this.sudoExec(
        `/usr/sbin/tc qdisc add dev ${this.WLAN_IFACE} root handle 1: htb default 9999`
      );

      // Root class — total bandwidth ceiling
      await this.sudoExec(
        `/usr/sbin/tc class add dev ${this.WLAN_IFACE} parent 1: classid 1:1 htb rate ${this.TOTAL_BANDWIDTH_MBIT}mbit ceil ${this.TOTAL_BANDWIDTH_MBIT}mbit`
      );

      // Default class — enough bandwidth for the locally hosted portal bundle.
      // Internet forwarding remains blocked until the client is authorized.
      await this.sudoExec(
        `/usr/sbin/tc class add dev ${this.WLAN_IFACE} parent 1:1 classid 1:9999 htb rate ${this.CAPTIVE_PORTAL_SPEED_MBIT}mbit ceil ${this.CAPTIVE_PORTAL_SPEED_MBIT}mbit`
      );
      await this.sudoExec(
        `/usr/sbin/tc qdisc add dev ${this.WLAN_IFACE} parent 1:9999 handle 9999: sfq perturb 10`
      );

      // Ingress qdisc so each client's upload can be capped at the same rate
      // as the download class on the way back out to the radio.
      await this.sudoExec(`/usr/sbin/tc qdisc del dev ${this.WLAN_IFACE} ingress 2>/dev/null || true`);
      await this.sudoExec(`/usr/sbin/tc qdisc add dev ${this.WLAN_IFACE} handle ffff: ingress`);

      this.tcInitialized = true;
      console.log('[NetworkManager] Traffic control initialized (HTB on ' + this.WLAN_IFACE + ')');
    } catch (error) {
      console.error('[NetworkManager] Failed to initialize traffic control:', error);
      this.tcInitialized = false;
    }
  }

  async setSpeedLimit(ip: string, speedMbps: number): Promise<void> {
    if (!this.isLinux || !this.tcInitialized) {
      console.log(`[NetworkManager] tc skip (dev mode): setSpeedLimit ${ip} ${speedMbps}Mbps`);
      return;
    }

    const normalizedIp = this.normalizeClientIp(ip);
    const lastOctet = parseInt(normalizedIp.split('.').pop() || '0', 10);
    if (lastOctet < 1 || lastOctet > 254) {
      console.error(`[NetworkManager] Invalid IP octet for tc class: ${normalizedIp}`);
      return;
    }

    const classHex = lastOctet.toString(16);
    const prio = lastOctet;
    const rate = Math.max(1, Math.floor(speedMbps));
    const burstKb = Math.max(64, rate * 8);

    // Remove any existing rules for this IP first (idempotent)
    await this.removeSpeedLimit(normalizedIp);

    try {
      // Download: packets leaving the radio toward this client.
      await this.sudoExec(
        `/usr/sbin/tc class add dev ${this.WLAN_IFACE} parent 1:1 classid 1:${classHex} htb rate ${rate}mbit ceil ${rate}mbit`
      );

      await this.sudoExec(
        `/usr/sbin/tc qdisc add dev ${this.WLAN_IFACE} parent 1:${classHex} handle ${lastOctet}: sfq perturb 10`
      );

      await this.sudoExec(
        `/usr/sbin/tc filter add dev ${this.WLAN_IFACE} parent 1:0 protocol ip prio ${prio} u32 match ip dst ${normalizedIp}/32 flowid 1:${classHex}`
      );

      // Upload: packets arriving from this client.
      await this.sudoExec(
        `/usr/sbin/tc filter add dev ${this.WLAN_IFACE} parent ffff: protocol ip prio ${prio} u32 match ip src ${normalizedIp}/32 police rate ${rate}mbit burst ${burstKb}k drop`
      );

      console.log(`[NetworkManager] tc: ${normalizedIp} capped at ${rate}Mbps up and down`);
    } catch (error) {
      console.error(`[NetworkManager] Failed to set speed limit for ${normalizedIp}:`, error);
    }
  }

  async removeSpeedLimit(ip: string): Promise<void> {
    if (!this.isLinux || !this.tcInitialized) {
      return;
    }

    const normalizedIp = this.normalizeClientIp(ip);
    const lastOctet = parseInt(normalizedIp.split('.').pop() || '0', 10);
    if (lastOctet < 1 || lastOctet > 254) return;

    const classHex = lastOctet.toString(16);
    const prio = lastOctet;

    // Delete filter, leaf qdisc, class — each may not exist, so catch individually
    await this.sudoExec(
      `/usr/sbin/tc filter del dev ${this.WLAN_IFACE} parent 1:0 protocol ip prio ${prio} u32`
    ).catch(() => {});

    await this.sudoExec(
      `/usr/sbin/tc filter del dev ${this.WLAN_IFACE} parent ffff: protocol ip prio ${prio} u32`
    ).catch(() => {});

    await this.sudoExec(
      `/usr/sbin/tc qdisc del dev ${this.WLAN_IFACE} parent 1:${classHex}`
    ).catch(() => {});

    await this.sudoExec(
      `/usr/sbin/tc class del dev ${this.WLAN_IFACE} parent 1:1 classid 1:${classHex}`
    ).catch(() => {});
  }

  async grantAccess(ip: string, seconds: number, speedMbps?: number): Promise<void> {
    const normalizedIp = this.normalizeClientIp(ip);
    const roundedSeconds = Math.ceil(seconds);
    // ipset rejects timeouts above 2147483 seconds. Zero means the entry does not expire.
    const timeout = roundedSeconds > 0 && roundedSeconds <= 2147483 ? roundedSeconds : 0;
    console.log(`[NetworkManager] Granting access to ${normalizedIp} for ${timeout === 0 ? "unlimited" : `${timeout}s`}`);

    if (this.isLinux) {
      await this.sudoExec(`/usr/sbin/ipset add meshlink_auth ${normalizedIp} timeout ${timeout} -exist`);
      await this.ensureClientAccounting(normalizedIp);
    }

    if (speedMbps != null) {
      await this.setSpeedLimit(normalizedIp, speedMbps);
    }
  }

  async revokeAccess(ip: string): Promise<void> {
    const normalizedIp = this.normalizeClientIp(ip);
    console.log(`[NetworkManager] Revoking access for ${normalizedIp}`);

    await this.removeSpeedLimit(normalizedIp);

    if (this.isLinux) {
      await this.sudoExec(`/usr/sbin/ipset del meshlink_auth ${normalizedIp} -exist`).catch(() => {});
    }
  }

  private async iptables(args: string): Promise<boolean> {
    try {
      await execAsync(`sudo /usr/sbin/iptables ${args}`);
      return true;
    } catch {
      return false;
    }
  }

  private async ensureAccountingChain(): Promise<void> {
    await this.iptables('-N meshlink_acct');
    if (!(await this.iptables(`-C FORWARD -o ${this.WAN_IFACE} -j meshlink_acct`))) {
      await this.iptables(`-I FORWARD -o ${this.WAN_IFACE} -j meshlink_acct`);
    }
    if (!(await this.iptables(`-C FORWARD -i ${this.WAN_IFACE} -j meshlink_acct`))) {
      await this.iptables(`-I FORWARD -i ${this.WAN_IFACE} -j meshlink_acct`);
    }
  }

  private async ensureClientAccounting(ip: string): Promise<void> {
    const upload = `-C meshlink_acct -s ${ip} -o ${this.WAN_IFACE} -m set --match-set meshlink_auth src -j RETURN`;
    const download = `-C meshlink_acct -d ${ip} -i ${this.WAN_IFACE} -m set --match-set meshlink_auth dst -j RETURN`;
    if (!(await this.iptables(upload))) {
      await this.iptables(upload.replace('-C ', '-A '));
    }
    if (!(await this.iptables(download))) {
      await this.iptables(download.replace('-C ', '-A '));
    }
  }

  private async snapshotUsageCounters(): Promise<void> {
    const counters = await this.readUsageCounters();
    for (const [ip, bytes] of counters) {
      this.usageCounters.set(ip, { counter: bytes, total: 0 });
    }
  }

  private async readUsageCounters(): Promise<Map<string, number>> {
    const totals = new Map<string, number>();
    if (!this.isLinux) return totals;

    let output = '';
    try {
      const result = await execAsync('sudo /usr/sbin/iptables -L meshlink_acct -v -n -x');
      output = result.stdout;
    } catch {
      return totals;
    }

    for (const line of output.split('\n')) {
      const match = line.match(/^\s*\d+\s+(\d+)\s+\S+\s+\S+\s+--\s+\S+\s+\S+\s+(\S+)\s+(\S+)/);
      if (!match) continue;
      const bytes = Number(match[1]);
      const source = match[2];
      const destination = match[3];
      const ip = source.startsWith('192.168.50.') ? source : destination.startsWith('192.168.50.') ? destination : '';
      if (!ip || !Number.isFinite(bytes)) continue;
      totals.set(ip, (totals.get(ip) || 0) + bytes);
    }
    return totals;
  }

  async takeUsageMegabytes(ips: string[]): Promise<Map<string, number>> {
    const usage = new Map<string, number>();
    if (!this.isLinux || ips.length === 0) return usage;

    await this.ensureAccountingChain();
    for (const ip of ips) {
      await this.ensureClientAccounting(ip);
    }

    const counters = await this.readUsageCounters();
    for (const ip of ips) {
      const counter = counters.get(ip) || 0;
      const state = this.usageCounters.get(ip);
      if (!state) {
        this.usageCounters.set(ip, { counter, total: counter });
      } else {
        const delta = counter >= state.counter ? counter - state.counter : counter;
        state.counter = counter;
        state.total += delta;
      }
      const total = this.usageCounters.get(ip)?.total || 0;
      if (total < 200_000) continue;
      usage.set(ip, Math.max(1, Math.round(total / (1024 * 1024))));
    }
    return usage;
  }

  async initialize(): Promise<void> {
    console.log('[NetworkManager] Initializing...');
    await this.detectEnvironment();

    if (this.isLinux) {
      try {
        // Create ipset with timeout support (timeout 0 = per-entry timeouts enabled)
        await this.sudoExec('/usr/sbin/ipset create meshlink_auth hash:ip timeout 0 -exist');
        console.log('[NetworkManager] meshlink_auth ipset ready (timeout-enabled)');
      } catch (error) {
        console.error('[NetworkManager] Failed to initialize ipset:', error);
      }

      await this.initializeTrafficControl();
      await this.ensureAccountingChain();
      await this.snapshotUsageCounters();
    }

    console.log('[NetworkManager] Initialized');
  }
}

export const networkManager = NetworkManager.getInstance();
