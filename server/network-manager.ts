import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class NetworkManager {
  private static instance: NetworkManager;
  private isLinux: boolean = false;
  private tcInitialized: boolean = false;
  private readonly WLAN_IFACE = 'wlan0';
  private readonly TOTAL_BANDWIDTH_MBIT = 300;

  private constructor() {}

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

  getClientIp(req: any): string {
    const ip = req.headers['x-forwarded-for'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           '127.0.0.1';
    return ip.replace(/^::ffff:/, '');
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

      // Default class — unauthenticated / unclassified traffic gets 1 Mbps
      await this.sudoExec(
        `/usr/sbin/tc class add dev ${this.WLAN_IFACE} parent 1:1 classid 1:9999 htb rate 1mbit ceil 1mbit`
      );
      await this.sudoExec(
        `/usr/sbin/tc qdisc add dev ${this.WLAN_IFACE} parent 1:9999 handle 9999: sfq perturb 10`
      );

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

    const normalizedIp = ip.replace(/^::ffff:/, '');
    const lastOctet = parseInt(normalizedIp.split('.').pop() || '0', 10);
    if (lastOctet < 1 || lastOctet > 254) {
      console.error(`[NetworkManager] Invalid IP octet for tc class: ${normalizedIp}`);
      return;
    }

    const classHex = lastOctet.toString(16);
    const prio = lastOctet;
    const rate = Math.max(1, Math.floor(speedMbps));

    // Remove any existing rules for this IP first (idempotent)
    await this.removeSpeedLimit(normalizedIp);

    try {
      // Per-client HTB class
      await this.sudoExec(
        `/usr/sbin/tc class add dev ${this.WLAN_IFACE} parent 1:1 classid 1:${classHex} htb rate ${rate}mbit ceil ${rate}mbit`
      );

      // SFQ leaf qdisc for fairness
      await this.sudoExec(
        `/usr/sbin/tc qdisc add dev ${this.WLAN_IFACE} parent 1:${classHex} handle ${lastOctet}: sfq perturb 10`
      );

      // u32 filter matching dst IP
      await this.sudoExec(
        `/usr/sbin/tc filter add dev ${this.WLAN_IFACE} parent 1:0 protocol ip prio ${prio} u32 match ip dst ${normalizedIp}/32 flowid 1:${classHex}`
      );

      console.log(`[NetworkManager] tc: ${normalizedIp} capped at ${rate}Mbps (class 1:${classHex})`);
    } catch (error) {
      console.error(`[NetworkManager] Failed to set speed limit for ${normalizedIp}:`, error);
    }
  }

  async removeSpeedLimit(ip: string): Promise<void> {
    if (!this.isLinux || !this.tcInitialized) {
      return;
    }

    const normalizedIp = ip.replace(/^::ffff:/, '');
    const lastOctet = parseInt(normalizedIp.split('.').pop() || '0', 10);
    if (lastOctet < 1 || lastOctet > 254) return;

    const classHex = lastOctet.toString(16);
    const prio = lastOctet;

    // Delete filter, leaf qdisc, class — each may not exist, so catch individually
    await this.sudoExec(
      `/usr/sbin/tc filter del dev ${this.WLAN_IFACE} parent 1:0 protocol ip prio ${prio} u32`
    ).catch(() => {});

    await this.sudoExec(
      `/usr/sbin/tc qdisc del dev ${this.WLAN_IFACE} parent 1:${classHex}`
    ).catch(() => {});

    await this.sudoExec(
      `/usr/sbin/tc class del dev ${this.WLAN_IFACE} parent 1:1 classid 1:${classHex}`
    ).catch(() => {});
  }

  async grantAccess(ip: string, seconds: number, speedMbps?: number): Promise<void> {
    const normalizedIp = ip.replace(/^::ffff:/, '');
    const roundedSeconds = Math.ceil(seconds);
    console.log(`[NetworkManager] Granting access to ${normalizedIp} for ${roundedSeconds}s`);

    if (this.isLinux) {
      await this.sudoExec(`/usr/sbin/ipset add meshlink_auth ${normalizedIp} timeout ${roundedSeconds} -exist`);
    }

    if (speedMbps != null) {
      await this.setSpeedLimit(normalizedIp, speedMbps);
    }
  }

  async revokeAccess(ip: string): Promise<void> {
    const normalizedIp = ip.replace(/^::ffff:/, '');
    console.log(`[NetworkManager] Revoking access for ${normalizedIp}`);

    await this.removeSpeedLimit(normalizedIp);

    if (this.isLinux) {
      await this.sudoExec(`/usr/sbin/ipset del meshlink_auth ${normalizedIp} -exist`).catch(() => {});
    }
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
    }

    console.log('[NetworkManager] Initialized');
  }
}

export const networkManager = NetworkManager.getInstance();
