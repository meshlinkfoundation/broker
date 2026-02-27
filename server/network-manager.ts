import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class NetworkManager {
  private static instance: NetworkManager;
  private isLinux: boolean = false;

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

  async grantAccess(ip: string, seconds: number): Promise<void> {
    const normalizedIp = ip.replace(/^::ffff:/, '');
    const roundedSeconds = Math.ceil(seconds);
    console.log(`[NetworkManager] Granting access to ${normalizedIp} for ${roundedSeconds}s`);

    if (this.isLinux) {
      await this.sudoExec(`/usr/sbin/ipset add meshlink_auth ${normalizedIp} timeout ${roundedSeconds} -exist`);
    }
  }

  async revokeAccess(ip: string): Promise<void> {
    const normalizedIp = ip.replace(/^::ffff:/, '');
    console.log(`[NetworkManager] Revoking access for ${normalizedIp}`);

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
    }

    console.log('[NetworkManager] Initialized');
  }
}

export const networkManager = NetworkManager.getInstance();
