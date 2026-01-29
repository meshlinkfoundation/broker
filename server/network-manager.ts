import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

export interface NetworkTier {
  id: string;
  name: string;
  downloadKbps: number;
  uploadKbps: number;
  timeLimit?: number; // in seconds, null for unlimited
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
  private isOpenWRT: boolean = false;
  private isLinux: boolean = false;

  private constructor() {
    this.detectEnvironment();
  }

  static getInstance(): NetworkManager {
    if (!NetworkManager.instance) {
      NetworkManager.instance = new NetworkManager();
    }
    return NetworkManager.instance;
  }

  private async detectEnvironment() {
    try {
      // Check for OpenWRT
      const { stdout } = await execAsync('uci show system.@system[0].hostname 2>/dev/null || echo ""');
      if (stdout.trim()) {
        this.isOpenWRT = true;
        this.isLinux = true;
        console.log('[NetworkManager] OpenWRT environment detected - full traffic control enabled');
        return;
      }
    } catch {}

    try {
      await execAsync('which iptables');
      this.isLinux = true;
      console.log('[NetworkManager] Linux environment detected - basic traffic control enabled');
    } catch {
      this.isLinux = false;
      console.log('[NetworkManager] Development environment - traffic control simulation mode');
    }
  }

  // Predefined network tiers based on the captive portal config
  private getTierConfig(tierId: string): NetworkTier {
    const tiers: Record<string, NetworkTier> = {
      'free': {
        id: 'free',
        name: 'Free Access',
        downloadKbps: 1000, // 1 Mbps
        uploadKbps: 500,    // 500 Kbps
        timeLimit: 24 * 60 * 60 // 24 hours
      },
      'premium': {
        id: 'premium',
        name: 'Premium Speed',
        downloadKbps: 50000, // 50 Mbps
        uploadKbps: 10000,   // 10 Mbps
        timeLimit: 7 * 24 * 60 * 60 // 7 days
      },
      'unlimited': {
        id: 'unlimited',
        name: 'Unlimited Pro',
        downloadKbps: 100000, // 100 Mbps
        uploadKbps: 50000,    // 50 Mbps
        timeLimit: undefined  // No limit
      }
    };

    return tiers[tierId] || tiers['free'];
  }

  // Add client to network tier
  async assignClientToTier(clientIp: string, sessionGuid: string, tierId: string, expiryDate: Date, clientMac?: string): Promise<void> {
    const tier = this.getTierConfig(tierId);
    const clientInfo: ClientInfo = {
      ip: clientIp,
      mac: clientMac,
      sessionGuid,
      tier,
      expiryDate
    };

    this.activeClients.set(clientIp, clientInfo);
    
    console.log(`[NetworkManager] Assigning client ${clientIp} (${clientMac || 'unknown MAC'}) to tier: ${tier.name}`);

    if (this.isLinux) {
      await this.applyTrafficControl(clientInfo);
    } else {
      console.log(`[NetworkManager] Development mode - would apply: ${tier.downloadKbps}/${tier.uploadKbps} Kbps to ${clientIp}`);
    }
  }

  // Apply traffic control rules using tc and iptables
  private async applyTrafficControl(client: ClientInfo): Promise<void> {
    try {
      // Create ipset for this tier if it doesn't exist
      const setName = `${client.tier.id}_clients`;
      await this.createIpSet(setName);
      
      // Add client IP to the appropriate set
      await execAsync(`ipset add ${setName} ${client.ip} -exist`);
      
      // Apply iptables marking rules
      await this.applyIptablesRules(client.tier);
      
      // Apply traffic shaping with tc
      await this.applyTrafficShaping(client.tier);
      
      console.log(`[NetworkManager] Traffic control applied for ${client.ip} - ${client.tier.name}`);
      
      // Set up expiry timer if needed
      if (client.tier.timeLimit) {
        this.scheduleClientExpiry(client);
      }
      
    } catch (error) {
      console.error(`[NetworkManager] Failed to apply traffic control for ${client.ip}:`, error);
    }
  }

  // Create ipset for tier if it doesn't exist
  private async createIpSet(setName: string): Promise<void> {
    try {
      await execAsync(`ipset create ${setName} hash:ip -exist`);
    } catch (error) {
      console.error(`[NetworkManager] Failed to create ipset ${setName}:`, error);
    }
  }

  // Apply iptables rules for traffic marking
  private async applyIptablesRules(tier: NetworkTier): Promise<void> {
    try {
      const setName = `${tier.id}_clients`;
      const mark = tier.id === 'free' ? '10' : tier.id === 'premium' ? '20' : '30';
      
      // Check if rule already exists
      const checkCommand = `iptables -t mangle -C PREROUTING -m set --match-set ${setName} src -j MARK --set-mark ${mark} 2>/dev/null`;
      
      try {
        await execAsync(checkCommand);
        console.log(`[NetworkManager] Iptables rule for ${tier.name} already exists`);
      } catch {
        // Rule doesn't exist, add it
        const addCommand = `iptables -t mangle -A PREROUTING -m set --match-set ${setName} src -j MARK --set-mark ${mark}`;
        await execAsync(addCommand);
        console.log(`[NetworkManager] Added iptables rule for ${tier.name} (mark ${mark})`);
      }
    } catch (error) {
      console.error(`[NetworkManager] Failed to apply iptables rules for ${tier.name}:`, error);
    }
  }

  // Apply traffic shaping using OpenWRT SQM or tc
  private async applyTrafficShaping(tier: NetworkTier): Promise<void> {
    if (this.isOpenWRT) {
      await this.applyOpenWRTQoS(tier);
    } else {
      await this.applyLinuxTC(tier);
    }
  }

  // Apply OpenWRT SQM QoS configuration
  private async applyOpenWRTQoS(tier: NetworkTier): Promise<void> {
    try {
      const queueName = `${tier.id}_queue`;
      const networkInterface = 'br-lan';
      
      // Configure SQM for this tier using UCI
      await execAsync(`uci set sqm.${queueName}=queue`);
      await execAsync(`uci set sqm.${queueName}.interface='${networkInterface}'`);
      await execAsync(`uci set sqm.${queueName}.download='${tier.downloadKbps}'`);
      await execAsync(`uci set sqm.${queueName}.upload='${tier.uploadKbps}'`);
      await execAsync(`uci set sqm.${queueName}.enabled='1'`);
      await execAsync(`uci set sqm.${queueName}.debug_logging='0'`);
      await execAsync(`uci set sqm.${queueName}.verbosity='5'`);
      await execAsync(`uci add_list sqm.${queueName}.ipset='${tier.id}_clients'`);
      
      // Commit UCI changes
      await execAsync(`uci commit sqm`);
      
      // Restart SQM service
      await execAsync(`/etc/init.d/sqm restart`);
      
      console.log(`[NetworkManager] OpenWRT SQM configured for ${tier.name}: ${tier.downloadKbps}/${tier.uploadKbps} Kbps`);
      
    } catch (error) {
      console.error(`[NetworkManager] Failed to configure OpenWRT SQM for ${tier.name}:`, error);
      // Fallback to Linux TC
      await this.applyLinuxTC(tier);
    }
  }

  // Apply Linux tc (Traffic Control) as fallback
  private async applyLinuxTC(tier: NetworkTier): Promise<void> {
    try {
      const networkInterface = 'br-lan';
      const mark = tier.id === 'free' ? '10' : tier.id === 'premium' ? '20' : '30';
      
      // Create root qdisc if it doesn't exist
      await this.ensureRootQdisc(networkInterface);
      
      // Create class for this tier
      const classId = `1:${mark}`;
      const downloadRate = `${tier.downloadKbps}kbit`;
      const uploadRate = `${tier.uploadKbps}kbit`;
      
      // Add class with bandwidth limits
      await execAsync(`tc class add dev ${networkInterface} parent 1: classid ${classId} htb rate ${downloadRate} ceil ${downloadRate} || true`);
      
      // Add filter to match marked packets
      await execAsync(`tc filter add dev ${networkInterface} protocol ip parent 1: prio 1 handle ${mark} fw flowid ${classId} || true`);
      
      console.log(`[NetworkManager] Linux TC configured for ${tier.name}: ${downloadRate}/${uploadRate}`);
      
    } catch (error) {
      console.error(`[NetworkManager] Failed to apply Linux TC for ${tier.name}:`, error);
    }
  }

  // Ensure root qdisc exists
  private async ensureRootQdisc(networkInterface: string): Promise<void> {
    try {
      // Check if root qdisc exists
      const { stdout } = await execAsync(`tc qdisc show dev ${networkInterface}`);
      if (!stdout.includes('htb')) {
        // Create root HTB qdisc
        await execAsync(`tc qdisc add dev ${networkInterface} root handle 1: htb default 30`);
        console.log(`[NetworkManager] Created root HTB qdisc on ${networkInterface}`);
      }
    } catch (error) {
      console.error(`[NetworkManager] Failed to ensure root qdisc:`, error);
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
      
      console.log(`[NetworkManager] Scheduled expiry for ${client.ip} in ${Math.round(timeUntilExpiry / 1000)}s`);
    }
  }

  // Remove client from network tier
  async expireClient(clientIp: string): Promise<void> {
    const client = this.activeClients.get(clientIp);
    if (!client) return;
    
    console.log(`[NetworkManager] Expiring client ${clientIp} from tier: ${client.tier.name}`);
    
    if (this.isLinux) {
      try {
        const setName = `${client.tier.id}_clients`;
        await execAsync(`ipset del ${setName} ${clientIp} -exist`);
        console.log(`[NetworkManager] Removed ${clientIp} from ${setName}`);
      } catch (error) {
        console.error(`[NetworkManager] Failed to remove ${clientIp} from tier:`, error);
      }
    }
    
    this.activeClients.delete(clientIp);
  }

  // Get client info
  getClientInfo(clientIp: string): ClientInfo | undefined {
    return this.activeClients.get(clientIp);
  }

  // List all active clients
  getActiveClients(): ClientInfo[] {
    return Array.from(this.activeClients.values());
  }

  // Clean up expired clients
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
    return req.headers['x-forwarded-for'] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
           '127.0.0.1';
  }

  // Initialize network management on startup
  async initialize(): Promise<void> {
    console.log('[NetworkManager] Initializing network management...');
    
    if (this.isLinux) {
      try {
        // Create base ipsets for all tiers
        await this.createIpSet('free_clients');
        await this.createIpSet('premium_clients');
        await this.createIpSet('unlimited_clients');
        
        console.log('[NetworkManager] Base ipsets created');
      } catch (error) {
        console.error('[NetworkManager] Failed to initialize base ipsets:', error);
      }
    }
    
    // Start cleanup interval
    setInterval(() => {
      this.cleanupExpiredClients();
    }, 60000); // Clean up every minute
    
    console.log('[NetworkManager] Network management initialized');
  }
}

export const networkManager = NetworkManager.getInstance();