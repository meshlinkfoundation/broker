import Database from 'better-sqlite3';
import type { 
  User, InsertUser, 
  L2Network, InsertL2Network,
  BandwidthPackage, InsertBandwidthPackage,
  HotspotSession, InsertHotspotSession,
  Transaction, InsertTransaction,
  AccessSession, InsertAccessSession
} from "../shared/schema";
import type { IStorage } from './storage';

export class SQLiteStorage implements IStorage {
  private db: Database.Database;

  constructor(dbPath: string = 'meshlink.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = 1000');
    this.db.pragma('temp_store = memory');
    
    this.initializeTables();
    this.initializeDefaults();
  }

  private initializeTables() {
    // Users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        walletAddress TEXT UNIQUE NOT NULL,
        username TEXT,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // L2 Networks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS l2_networks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        chainId INTEGER UNIQUE NOT NULL,
        rpcUrl TEXT NOT NULL,
        gasPrice TEXT NOT NULL,
        confirmationTime INTEGER NOT NULL,
        isActive INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Bandwidth Packages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bandwidth_packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        dataLimitMB INTEGER NOT NULL,
        durationHours INTEGER NOT NULL,
        priceMeshTokens TEXT NOT NULL,
        isActive INTEGER NOT NULL DEFAULT 1,
        isFree INTEGER NOT NULL DEFAULT 0
      )
    `);

    // Hotspot Sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hotspot_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        packageId INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        dataUsedMB INTEGER NOT NULL DEFAULT 0,
        startTime TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        endTime TEXT
      )
    `);

    // Transactions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS transactions (
        hash TEXT PRIMARY KEY,
        networkId INTEGER NOT NULL,
        sessionId INTEGER NOT NULL,
        fromAddress TEXT NOT NULL,
        toAddress TEXT NOT NULL,
        amount TEXT NOT NULL,
        gasUsed TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        blockNumber INTEGER,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Access Sessions table - main table for captive portal sessions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS access_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionGuid TEXT UNIQUE NOT NULL,
        userIdentifier TEXT NOT NULL,
        clientIp TEXT,
        tierId TEXT NOT NULL,
        tierName TEXT NOT NULL,
        paymentMethod TEXT NOT NULL,
        paymentReference TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        dataLimitMB INTEGER NOT NULL,
        dataUsedMB INTEGER NOT NULL DEFAULT 0,
        speedMbps TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        startDate TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expiryDate TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        lastAccessAt TEXT
      )
    `);

    // Migration: add clientIp column if missing (existing DBs)
    try {
      this.db.exec(`ALTER TABLE access_sessions ADD COLUMN clientIp TEXT`);
    } catch {
      // Column already exists
    }

    // Create indexes for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_users_wallet ON users(walletAddress);
      CREATE INDEX IF NOT EXISTS idx_access_sessions_guid ON access_sessions(sessionGuid);
      CREATE INDEX IF NOT EXISTS idx_access_sessions_user ON access_sessions(userIdentifier);
      CREATE INDEX IF NOT EXISTS idx_access_sessions_status ON access_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_access_sessions_created ON access_sessions(createdAt);
    `);
  }

  private initializeDefaults() {
    // Initialize default L2 networks
    const networkCount = this.db.prepare('SELECT COUNT(*) as count FROM l2_networks').get() as { count: number };
    if (networkCount.count === 0) {
      const insertNetwork = this.db.prepare(`
        INSERT INTO l2_networks (name, chainId, rpcUrl, gasPrice, confirmationTime, isActive)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      insertNetwork.run('Optimism', 10, 'https://mainnet.optimism.io', '0.001', 60, 1);
      insertNetwork.run('Arbitrum', 42161, 'https://arb1.arbitrum.io/rpc', '0.0005', 30, 1);
      insertNetwork.run('Polygon', 137, 'https://polygon-rpc.com', '0.002', 15, 1);
    }

    // Initialize default bandwidth packages
    const packageCount = this.db.prepare('SELECT COUNT(*) as count FROM bandwidth_packages').get() as { count: number };
    if (packageCount.count === 0) {
      const insertPackage = this.db.prepare(`
        INSERT INTO bandwidth_packages (name, description, dataLimitMB, durationHours, priceMeshTokens, isActive, isFree)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      insertPackage.run('Free Access', 'Basic internet access', 100, 1, '0', 1, 1);
      insertPackage.run('Premium Speed', 'High-speed internet access', 5120, 168, '0.001', 1, 0);
      insertPackage.run('Unlimited Pro', 'Unlimited high-speed access', -1, 720, '0.01', 1, 0);
    }
  }

  // Convert SQLite boolean integers to JavaScript booleans
  private convertBooleans(obj: any): any {
    if (obj && typeof obj === 'object') {
      const converted = { ...obj };
      if ('isActive' in converted) converted.isActive = Boolean(converted.isActive);
      if ('isFree' in converted) converted.isFree = Boolean(converted.isFree);
      return converted;
    }
    return obj;
  }

  // Users methods
  async getUser(id: number): Promise<User | undefined> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const result = stmt.get(id);
    return result ? this.convertBooleans(result) as User : undefined;
  }

  async getUserByWallet(walletAddress: string): Promise<User | undefined> {
    const stmt = this.db.prepare('SELECT * FROM users WHERE walletAddress = ?');
    const result = stmt.get(walletAddress);
    return result ? this.convertBooleans(result) as User : undefined;
  }

  async createUser(user: InsertUser): Promise<User> {
    const stmt = this.db.prepare(`
      INSERT INTO users (walletAddress, username)
      VALUES (?, ?)
    `);
    const result = stmt.run(user.walletAddress, user.username || null);
    return this.getUser(result.lastInsertRowid as number) as Promise<User>;
  }

  // L2 Networks methods
  async getL2Networks(): Promise<L2Network[]> {
    const stmt = this.db.prepare('SELECT * FROM l2_networks WHERE isActive = 1');
    const results = stmt.all();
    return results.map(r => this.convertBooleans(r)) as L2Network[];
  }

  async getL2Network(id: number): Promise<L2Network | undefined> {
    const stmt = this.db.prepare('SELECT * FROM l2_networks WHERE id = ?');
    const result = stmt.get(id);
    return result ? this.convertBooleans(result) as L2Network : undefined;
  }

  async createL2Network(network: InsertL2Network): Promise<L2Network> {
    const stmt = this.db.prepare(`
      INSERT INTO l2_networks (name, chainId, rpcUrl, gasPrice, confirmationTime, isActive)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      network.name, 
      network.chainId, 
      network.rpcUrl, 
      network.gasPrice, 
      network.confirmationTime, 
      network.isActive ? 1 : 0
    );
    return this.getL2Network(result.lastInsertRowid as number) as Promise<L2Network>;
  }

  // Bandwidth Packages methods
  async getBandwidthPackages(): Promise<BandwidthPackage[]> {
    const stmt = this.db.prepare('SELECT * FROM bandwidth_packages WHERE isActive = 1');
    const results = stmt.all();
    return results.map(r => this.convertBooleans(r)) as BandwidthPackage[];
  }

  async getBandwidthPackage(id: number): Promise<BandwidthPackage | undefined> {
    const stmt = this.db.prepare('SELECT * FROM bandwidth_packages WHERE id = ?');
    const result = stmt.get(id);
    return result ? this.convertBooleans(result) as BandwidthPackage : undefined;
  }

  async createBandwidthPackage(pkg: InsertBandwidthPackage): Promise<BandwidthPackage> {
    const stmt = this.db.prepare(`
      INSERT INTO bandwidth_packages (name, description, dataLimitMB, durationHours, priceMeshTokens, isActive, isFree)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      pkg.name,
      pkg.description,
      pkg.dataLimitMB,
      pkg.durationHours,
      pkg.priceMeshTokens,
      pkg.isActive ? 1 : 0,
      pkg.isFree ? 1 : 0
    );
    return this.getBandwidthPackage(result.lastInsertRowid as number) as Promise<BandwidthPackage>;
  }

  // Hotspot Sessions methods
  async getHotspotSessions(userId: number): Promise<HotspotSession[]> {
    const stmt = this.db.prepare('SELECT * FROM hotspot_sessions WHERE userId = ? ORDER BY startTime DESC');
    const results = stmt.all(userId);
    return results.map(r => this.convertBooleans(r)) as HotspotSession[];
  }

  async getHotspotSession(id: number): Promise<HotspotSession | undefined> {
    const stmt = this.db.prepare('SELECT * FROM hotspot_sessions WHERE id = ?');
    const result = stmt.get(id);
    return result ? this.convertBooleans(result) as HotspotSession : undefined;
  }

  async createHotspotSession(session: InsertHotspotSession): Promise<HotspotSession> {
    const stmt = this.db.prepare(`
      INSERT INTO hotspot_sessions (userId, packageId, status, dataUsedMB, endTime)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      session.userId,
      session.packageId,
      session.status || 'active',
      session.dataUsedMB || 0,
      session.endTime || null
    );
    return this.getHotspotSession(result.lastInsertRowid as number) as Promise<HotspotSession>;
  }

  async updateHotspotSession(id: number, updates: Partial<HotspotSession>): Promise<HotspotSession | undefined> {
    const fields = Object.keys(updates).filter(key => key !== 'id').map(key => `${key} = ?`).join(', ');
    const values = Object.entries(updates).filter(([key]) => key !== 'id').map(([_, value]) => value);
    
    if (fields.length === 0) return this.getHotspotSession(id);
    
    const stmt = this.db.prepare(`UPDATE hotspot_sessions SET ${fields} WHERE id = ?`);
    stmt.run(...values, id);
    return this.getHotspotSession(id);
  }

  // Transactions methods
  async getTransaction(hash: string): Promise<Transaction | undefined> {
    const stmt = this.db.prepare('SELECT * FROM transactions WHERE hash = ?');
    const result = stmt.get(hash);
    return result ? this.convertBooleans(result) as Transaction : undefined;
  }

  async createTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const stmt = this.db.prepare(`
      INSERT INTO transactions (hash, networkId, sessionId, fromAddress, toAddress, amount, gasUsed, status, blockNumber)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      transaction.hash,
      transaction.networkId,
      transaction.sessionId,
      transaction.fromAddress,
      transaction.toAddress,
      transaction.amount,
      transaction.gasUsed,
      transaction.status || 'pending',
      transaction.blockNumber || null
    );
    return this.getTransaction(transaction.hash) as Promise<Transaction>;
  }

  async updateTransaction(hash: string, updates: Partial<Transaction>): Promise<Transaction | undefined> {
    const fields = Object.keys(updates).filter(key => key !== 'hash').map(key => `${key} = ?`).join(', ');
    const values = Object.entries(updates).filter(([key]) => key !== 'hash').map(([_, value]) => value);
    
    if (fields.length === 0) return this.getTransaction(hash);
    
    const stmt = this.db.prepare(`UPDATE transactions SET ${fields} WHERE hash = ?`);
    stmt.run(...values, hash);
    return this.getTransaction(hash);
  }

  // Access Sessions methods (main captive portal functionality)
  async getAccessSession(sessionGuid: string): Promise<AccessSession | undefined> {
    const stmt = this.db.prepare('SELECT * FROM access_sessions WHERE sessionGuid = ?');
    const result = stmt.get(sessionGuid);
    if (!result) return undefined;
    
    // Convert dates back to Date objects for compatibility
    return {
      ...this.convertBooleans(result),
      startDate: new Date(result.startDate),
      expiryDate: new Date(result.expiryDate),
      createdAt: new Date(result.createdAt),
      lastAccessAt: result.lastAccessAt ? new Date(result.lastAccessAt) : null
    } as AccessSession;
  }

  async getAccessSessionsByUser(userIdentifier: string): Promise<AccessSession[]> {
    const stmt = this.db.prepare('SELECT * FROM access_sessions WHERE userIdentifier = ? ORDER BY createdAt DESC');
    const results = stmt.all(userIdentifier);
    return results.map(result => ({
      ...this.convertBooleans(result),
      startDate: new Date(result.startDate),
      expiryDate: new Date(result.expiryDate),
      createdAt: new Date(result.createdAt),
      lastAccessAt: result.lastAccessAt ? new Date(result.lastAccessAt) : null
    })) as AccessSession[];
  }

  async createAccessSession(session: InsertAccessSession): Promise<AccessSession> {
    const stmt = this.db.prepare(`
      INSERT INTO access_sessions (
        sessionGuid, userIdentifier, clientIp, tierId, tierName, paymentMethod,
        paymentReference, status, dataLimitMB, dataUsedMB, speedMbps,
        price, startDate, expiryDate, lastAccessAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Calculate price based on tier
    const tierPrices: Record<string, number> = {
      'Free Access': 0,
      'Premium Speed': 2.99,
      'Unlimited Pro': 19.99
    };
    const price = tierPrices[session.tierName] || 0;

    stmt.run(
      session.sessionGuid,
      session.userIdentifier,
      (session as any).clientIp || null,
      session.tierId,
      session.tierName,
      session.paymentMethod,
      session.paymentReference || null,
      session.status || 'active',
      session.dataLimitMB,
      session.dataUsedMB || 0,
      session.speedMbps,
      price,
      session.startDate.toISOString(),
      session.expiryDate.toISOString(),
      session.lastAccessAt ? session.lastAccessAt.toISOString() : null
    );

    return this.getAccessSession(session.sessionGuid) as Promise<AccessSession>;
  }

  async updateAccessSession(sessionGuid: string, updates: Partial<AccessSession>): Promise<AccessSession | undefined> {
    const fields = Object.keys(updates).filter(key => key !== 'sessionGuid' && key !== 'id').map(key => `${key} = ?`).join(', ');
    const values = Object.entries(updates).filter(([key]) => key !== 'sessionGuid' && key !== 'id').map(([_, value]) => {
      if (value instanceof Date) return value.toISOString();
      return value;
    });
    
    if (fields.length === 0) return this.getAccessSession(sessionGuid);
    
    const stmt = this.db.prepare(`UPDATE access_sessions SET ${fields} WHERE sessionGuid = ?`);
    stmt.run(...values, sessionGuid);
    return this.getAccessSession(sessionGuid);
  }

  async getActiveAccessSessions(): Promise<AccessSession[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM access_sessions 
      WHERE status = 'active' AND datetime(expiryDate) > datetime('now')
      ORDER BY createdAt DESC
    `);
    const results = stmt.all();
    return results.map(result => ({
      ...this.convertBooleans(result),
      startDate: new Date(result.startDate),
      expiryDate: new Date(result.expiryDate),
      createdAt: new Date(result.createdAt),
      lastAccessAt: result.lastAccessAt ? new Date(result.lastAccessAt) : null
    })) as AccessSession[];
  }

  async expireAccessSession(sessionGuid: string): Promise<void> {
    const stmt = this.db.prepare(`UPDATE access_sessions SET status = 'expired' WHERE sessionGuid = ?`);
    stmt.run(sessionGuid);
  }

  // Custom analytics method for admin dashboard
  async getAnalytics() {
    const totalSessions = this.db.prepare('SELECT COUNT(*) as count FROM access_sessions').get() as { count: number };
    const activeSessions = this.db.prepare("SELECT COUNT(*) as count FROM access_sessions WHERE status = 'active' AND datetime(expiryDate) > datetime('now')").get() as { count: number };
    const todaySessions = this.db.prepare("SELECT COUNT(*) as count FROM access_sessions WHERE date(createdAt) = date('now')").get() as { count: number };
    const weekSessions = this.db.prepare("SELECT COUNT(*) as count FROM access_sessions WHERE date(createdAt) >= date('now', '-7 days')").get() as { count: number };
    
    const totalDataUsed = this.db.prepare('SELECT SUM(dataUsedMB) as total FROM access_sessions').get() as { total: number };
    const totalRevenue = this.db.prepare('SELECT SUM(price) as total FROM access_sessions').get() as { total: number };
    
    const tierStats = this.db.prepare(`
      SELECT tierName, COUNT(*) as count, SUM(price) as revenue 
      FROM access_sessions 
      GROUP BY tierName
    `).all() as Array<{ tierName: string; count: number; revenue: number }>;
    
    const stripePayments = this.db.prepare("SELECT COUNT(*) as count FROM access_sessions WHERE paymentMethod = 'stripe'").get() as { count: number };
    const cryptoPayments = this.db.prepare("SELECT COUNT(*) as count FROM access_sessions WHERE paymentMethod = 'crypto'").get() as { count: number };
    
    const recentSessions = this.db.prepare(`
      SELECT sessionGuid, tierName, paymentMethod, status, dataUsedMB, createdAt, expiryDate
      FROM access_sessions 
      ORDER BY createdAt DESC 
      LIMIT 10
    `).all() as Array<{
      sessionGuid: string;
      tierName: string;
      paymentMethod: string;
      status: string;
      dataUsedMB: number;
      createdAt: string;
      expiryDate: string;
    }>;

    // Build tier stats with defaults
    const tierStatsMap = {
      free: { name: 'Free Access', count: 0, revenue: 0 },
      premium: { name: 'Premium Speed', count: 0, revenue: 0 },
      unlimited: { name: 'Unlimited Pro', count: 0, revenue: 0 }
    };

    tierStats.forEach(stat => {
      if (stat.tierName === 'Free Access') {
        tierStatsMap.free = { name: stat.tierName, count: stat.count, revenue: stat.revenue };
      } else if (stat.tierName === 'Premium Speed') {
        tierStatsMap.premium = { name: stat.tierName, count: stat.count, revenue: stat.revenue };
      } else if (stat.tierName === 'Unlimited Pro') {
        tierStatsMap.unlimited = { name: stat.tierName, count: stat.count, revenue: stat.revenue };
      }
    });

    return {
      totalSessions: totalSessions.count,
      activeSessions: activeSessions.count,
      todaySessions: todaySessions.count,
      weekSessions: weekSessions.count,
      totalDataUsed: totalDataUsed.total || 0,
      totalRevenue: totalRevenue.total || 0,
      tierStats: tierStatsMap,
      paymentMethods: {
        stripe: stripePayments.count,
        crypto: cryptoPayments.count
      },
      recentSessions
    };
  }

  close() {
    this.db.close();
  }
}