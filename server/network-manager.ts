import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface NetworkTier {
  id: string;
  name: string;
  downloadKbps: number;
  uploadKbps: number;
  timeLimit?: number; // in seconds, undefined for unlimited
}

export interface ClientInfo {
  ip: string;
  mac?: string;
  sessionGuid: string;
  tier: NetworkTier;
  expiryDate: Date;
}

export class NetworkManager {
  private static instance: NetworkManager;
  private activeClients: Map<string, ClientInfo> = new Map();
  private tempAccessTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private isLinux: boolean = false;
  private isOpenWRT: boolean = false;
  private wlanInterface: string = 'wlan0';

  private constructor() {}

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  private async detectEnvironment(): Promise<void> {
    try {
      const { stdout } = await execAsync('uci show system.@system[0].hostname 2>/dev/null || echo ""');
      if (stdout.trim()) {
        this.isOpenWRT = true;
        this.isLinux = true;
        console.log('[NetworkManager] OpenWRT environment detected');
        return;
      }
    } catch {}

    try {
      await execAsync('which iptables || sudo which iptables');
      this.isLinux = true;
      console.log('[NetworkManager] Linux environment detected - captive portal mode enabled');
    } catch {
      this.isLinux = false;
      console.log('[NetworkManager] Development environment - traffic control simulation mode');
    }
  }

  // Run a shell command with sudo (for iptables/ipset when running as non-root)
  private async sudoExec(command: string): Promise<string> {
    try {
      const { stdout } = await execAsync(`sudo ${command}`);
      return stdout.trim();
    } catch (error: any) {
      console.error(`[NetworkManager] Command failed: sudo ${command}`, error.message);
      throw error;
    }
  }

  // Predefined network tiers
  private getTierConfig(tierId: string): NetworkTier {
    const tiers: Record<string, NetworkTier> = {
      'free': {
        id: 'free',
        name: 'Free Access',
        downloadKbps: 1000,
        uploadKbps: 500,
        timeLimit: 24 * 60 * 60
      },
      'lightweight': {
        id: 'lightweight',
        name: 'Lightweight',
        downloadKbps: 25000,
        uploadKbps: 5000,
        timeLimit: 7 * 24 * 60 * 60
      },
      'premium': {
        id: 'premium',
        name: 'Super Fast Premium',
        downloadKbps: 200000,
        uploadKbps: 50000,
        timeLimit: 7 * 24 * 60 * 60
      }
    };

    return tiers[tierId] || tiers['free'];
  }

  // Grant temporary internet access so client can reach Stripe checkout
  // Auto-revokes after durationMs (default 10 min) unless cancelled by assignClientToTier
  async grantTemporaryAccess(clientIp: string, durationMs: number = 600000): Promise<void> {
    const normalizedIp = clientIp.replace(/^::ffff:/, '');

    console.log(`[NetworkManager] Granting temporary access to ${normalizedIp} for ${durationMs / 1000}s`);

    if (this.isLinux) {
      try {
        await this.sudoExec(`/usr/sbin/ipset add meshlink_auth ${normalizedIp} -exist`);
        console.log(`[NetworkManager] Temporary access granted to ${normalizedIp}`);
      } catch (error) {
        console.error(`[NetworkManager] Failed to grant temporary access for ${normalizedIp}:`, error);
        throw error;
      }
    } else {
      console.log(`[NetworkManager] Development mode - would grant temporary access to ${normalizedIp}`);
    }

    // Clear any existing temp timer for this IP
    const existing = this.tempAccessTimers.get(normalizedIp);
    if (existing) clearTimeout(existing);

    // Schedule auto-revoke
    const timer = setTimeout(async () => {
      this.tempAccessTimers.delete(normalizedIp);
      // Only revoke if client hasn't been assigned to a real tier
      if (!this.activeClients.has(normalizedIp)) {
        console.log(`[NetworkManager] Temporary access expired for ${normalizedIp} - revoking`);
        if (this.isLinux) {
          await this.sudoExec(`/usr/sbin/ipset del meshlink_auth ${normalizedIp} -exist`).catch(() => {});
        }
      }
    }, durationMs);

    this.tempAccessTimers.set(normalizedIp, timer);
  }

  // Grant internet access to a client by adding to meshlink_auth ipset
  async assignClientToTier(clientIp: string, sessionGuid: string, tierId: string, expiryDate: Date, clientMac?: string): Promise<void> {
    const tier = this.getTierConfig(tierId);
    const clientInfo: ClientInfo = {
      ip: clientIp,
      mac: clientMac,
      sessionGuid,
      tier,
      expiryDate
    };

    // Normalize IPv6-mapped IPv4 (::ffff:192.168.50.x -> 192.168.50.x)
    const normalizedIp = clientIp.replace(/^::ffff:/, '');
    clientInfo.ip = normalizedIp;

    // Cancel any temporary access timer — client is now fully authorized
    const tempTimer = this.tempAccessTimers.get(normalizedIp);
    if (tempTimer) {
      clearTimeout(tempTimer);
      this.tempAccessTimers.delete(normalizedIp);
      console.log(`[NetworkManager] Cancelled temporary access timer for ${normalizedIp} — paid tier assigned`);
    }

    this.activeClients.set(normalizedIp, clientInfo);

    console.log(`[NetworkManager] Assigning client ${normalizedIp} (${clientMac || 'unknown MAC'}) to tier: ${tier.name}`);

    if (this.isLinux) {
      try {
        // Add client to the meshlink_auth ipset - this grants internet access
        // (iptables FORWARD chain allows meshlink_auth members to pass)
        await this.sudoExec(`/usr/sbin/ipset add meshlink_auth ${normalizedIp} -exist`);
        console.log(`[NetworkManager] Client ${normalizedIp} added to meshlink_auth - internet access granted`);

        // Also add to tier-specific ipset for traffic shaping (future use)
        const tierSet = `${tier.id}_clients`;
        await this.sudoExec(`/usr/sbin/ipset add ${tierSet} ${normalizedIp} -exist`).catch(() => {});

        // Schedule expiry
        if (tier.timeLimit) {
          this.scheduleClientExpiry(clientInfo);
        }
      } catch (error) {
        console.error(`[NetworkManager] Failed to grant access for ${normalizedIp}:`, error);
      }
    } else {
      console.log(`[NetworkManager] Development mode - would grant internet access to ${normalizedIp} (${tier.name})`);
    }
  }

  // Schedule client expiry
  private scheduleClientExpiry(client: ClientInfo): void {
    const now = new Date();
    const timeUntilExpiry = client.expiryDate.getTime() - now.getTime();

    if (timeUntilExpiry > 0) {
      setTimeout(() => {
        this.expireClient(client.ip);
      }, timeUntilExpiry);

      const hours = Math.round(timeUntilExpiry / (1000 * 60 * 60) * 10) / 10;
      console.log(`[NetworkManager] Scheduled expiry for ${client.ip} in ${hours}h`);
    }
  }

  // Remove client from network tier and revoke internet access
  async expireClient(clientIp: string): Promise<void> {
    const normalizedIp = clientIp.replace(/^::ffff:/, '');
    const client = this.activeClients.get(normalizedIp);
    if (!client) return;

    console.log(`[NetworkManager] Expiring client ${normalizedIp} from tier: ${client.tier.name}`);

    if (this.isLinux) {
      try {
        // Remove from meshlink_auth - revokes internet access
        await this.sudoExec(`/usr/sbin/ipset del meshlink_auth ${normalizedIp} -exist`);
        console.log(`[NetworkManager] Client ${normalizedIp} removed from meshlink_auth - internet access revoked`);

        // Remove from tier-specific ipset
        const tierSet = `${client.tier.id}_clients`;
        await this.sudoExec(`/usr/sbin/ipset del ${tierSet} ${normalizedIp} -exist`).catch(() => {});
      } catch (error) {
        console.error(`[NetworkManager] Failed to revoke access for ${normalizedIp}:`, error);
      }
    }

    this.activeClients.delete(normalizedIp);
  }

  getClientInfo(clientIp: string): ClientInfo | undefined {
    const normalizedIp = clientIp.replace(/^::ffff:/, '');
    return this.activeClients.get(normalizedIp);
  }

  getActiveClients(): ClientInfo[] {
    return Array.from(this.activeClients.values());
  }

  async cleanupExpiredClients(): Promise<void> {
    const now = new Date();
    const expiredClients = Array.from(this.activeClients.entries())
      .filter(([_, client]) => client.expiryDate < now)
      .map(([ip, _]) => ip);

    for (const ip of expiredClients) {
      await this.expireClient(ip);
    }

    if (expiredClients.length > 0) {
      console.log(`[NetworkManager] Cleaned up ${expiredClients.length} expired clients`);
    }
  }

  // Detect client IP from request
  getClientIp(req: any): string {
    const ip = req.headers['x-forwarded-for'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           '127.0.0.1';
    // Normalize IPv6-mapped IPv4
    return ip.replace(/^::ffff:/, '');
  }

  // Initialize network management on startup
  async initialize(): Promise<void> {
    console.log('[NetworkManager] Initializing network management...');

    await this.detectEnvironment();

    if (this.isLinux) {
      try {
        // Ensure the meshlink_auth ipset exists (captive portal gate)
        await this.sudoExec('/usr/sbin/ipset create meshlink_auth hash:ip -exist');

        // Create tier-specific ipsets for future traffic shaping
        await this.sudoExec('/usr/sbin/ipset create free_clients hash:ip -exist');
        await this.sudoExec('/usr/sbin/ipset create lightweight_clients hash:ip -exist');
        await this.sudoExec('/usr/sbin/ipset create premium_clients hash:ip -exist');

        console.log('[NetworkManager] Captive portal ipsets ready');
      } catch (error) {
        console.error('[NetworkManager] Failed to initialize ipsets:', error);
      }
    }

    // Start cleanup interval
    setInterval(() => {
      this.cleanupExpiredClients();
    }, 60000);

    console.log('[NetworkManager] Network management initialized');
  }
}

export const networkManager = NetworkManager.getInstance();
