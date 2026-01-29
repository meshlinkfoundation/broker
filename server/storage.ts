import { SQLiteStorage } from './sqlite-storage';
import { 
  users, 
  l2Networks, 
  bandwidthPackages, 
  hotspotSessions, 
  transactions,
  type User, 
  type InsertUser,
  type L2Network,
  type InsertL2Network,
  type BandwidthPackage,
  type InsertBandwidthPackage,
  type HotspotSession,
  type InsertHotspotSession,
  type Transaction,
  type InsertTransaction,
  type AccessSession,
  type InsertAccessSession
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByWallet(walletAddress: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // L2 Networks
  getL2Networks(): Promise<L2Network[]>;
  getL2Network(id: number): Promise<L2Network | undefined>;
  createL2Network(network: InsertL2Network): Promise<L2Network>;
  
  // Bandwidth Packages
  getBandwidthPackages(): Promise<BandwidthPackage[]>;
  getBandwidthPackage(id: number): Promise<BandwidthPackage | undefined>;
  createBandwidthPackage(pkg: InsertBandwidthPackage): Promise<BandwidthPackage>;
  
  // Hotspot Sessions
  getHotspotSessions(userId: number): Promise<HotspotSession[]>;
  getHotspotSession(id: number): Promise<HotspotSession | undefined>;
  createHotspotSession(session: InsertHotspotSession): Promise<HotspotSession>;
  updateHotspotSession(id: number, updates: Partial<HotspotSession>): Promise<HotspotSession | undefined>;
  
  // Transactions
  getTransaction(hash: string): Promise<Transaction | undefined>;
  createTransaction(transaction: InsertTransaction): Promise<Transaction>;
  updateTransaction(hash: string, updates: Partial<Transaction>): Promise<Transaction | undefined>;
  
  // Access Session Management
  getAccessSession(sessionGuid: string): Promise<AccessSession | undefined>;
  getAccessSessionsByUser(userIdentifier: string): Promise<AccessSession[]>;
  createAccessSession(session: InsertAccessSession): Promise<AccessSession>;
  updateAccessSession(sessionGuid: string, updates: Partial<AccessSession>): Promise<AccessSession | undefined>;
  getActiveAccessSessions(): Promise<AccessSession[]>;
  expireAccessSession(sessionGuid: string): Promise<void>;
  
  // Analytics
  getAnalytics?(): Promise<any>;
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private l2Networks: Map<number, L2Network>;
  private bandwidthPackages: Map<number, BandwidthPackage>;
  private hotspotSessions: Map<number, HotspotSession>;
  private transactions: Map<string, Transaction>;
  private accessSessions: Map<string, AccessSession>; // Keyed by sessionGuid
  private currentId: number;

  constructor() {
    this.users = new Map();
    this.l2Networks = new Map();
    this.bandwidthPackages = new Map();
    this.hotspotSessions = new Map();
    this.transactions = new Map();
    this.accessSessions = new Map();
    this.currentId = 1;
    
    // Initialize with default data
    this.initializeDefaults();
  }

  private initializeDefaults() {
    // Default L2 Networks
    const networks: InsertL2Network[] = [
      {
        name: "Polygon",
        chainId: 137,
        rpcUrl: "https://polygon-rpc.com",
        gasPrice: "0.000001",
        confirmationTime: 2,
        isActive: true,
      },
      {
        name: "Arbitrum",
        chainId: 42161,
        rpcUrl: "https://arb1.arbitrum.io/rpc",
        gasPrice: "0.00001",
        confirmationTime: 1,
        isActive: true,
      },
      {
        name: "Optimism",
        chainId: 10,
        rpcUrl: "https://mainnet.optimism.io",
        gasPrice: "0.000005",
        confirmationTime: 3,
        isActive: true,
      },
    ];
    
    networks.forEach(network => {
      const id = this.currentId++;
      this.l2Networks.set(id, { ...network, id, isActive: network.isActive ?? true });
    });
    
    // Default Bandwidth Packages
    const packages: InsertBandwidthPackage[] = [
      {
        name: "Free Access",
        description: "Basic internet for browsing and messaging - Always free!",
        dataLimitMB: 500, // 500MB
        durationHours: 24,
        priceMeshTokens: "0",
        isFree: true,
        isActive: true,
      },
      {
        name: "Premium Speed",
        description: "High-speed internet for streaming and downloads",
        dataLimitMB: 5120, // 5GB
        durationHours: 168, // 1 week
        priceMeshTokens: "25",
        isFree: false,
        isActive: true,
      },
      {
        name: "Unlimited Pro",
        description: "Unlimited high-speed access for heavy usage",
        dataLimitMB: 51200, // 50GB
        durationHours: 720, // 30 days
        priceMeshTokens: "100",
        isFree: false,
        isActive: true,
      },
    ];
    
    packages.forEach(pkg => {
      const id = this.currentId++;
      this.bandwidthPackages.set(id, { 
        ...pkg, 
        id, 
        isActive: pkg.isActive ?? true,
        isFree: pkg.isFree ?? false 
      });
    });
  }

  // User methods
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByWallet(walletAddress: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.walletAddress === walletAddress,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentId++;
    const user: User = { 
      ...insertUser, 
      id,
      username: insertUser.username || null,
      createdAt: new Date(),
    };
    this.users.set(id, user);
    return user;
  }

  // L2 Network methods
  async getL2Networks(): Promise<L2Network[]> {
    return Array.from(this.l2Networks.values()).filter(network => network.isActive);
  }

  async getL2Network(id: number): Promise<L2Network | undefined> {
    return this.l2Networks.get(id);
  }

  async createL2Network(insertNetwork: InsertL2Network): Promise<L2Network> {
    const id = this.currentId++;
    const network: L2Network = { ...insertNetwork, id };
    this.l2Networks.set(id, network);
    return network;
  }

  // Bandwidth Package methods
  async getBandwidthPackages(): Promise<BandwidthPackage[]> {
    return Array.from(this.bandwidthPackages.values()).filter(pkg => pkg.isActive);
  }

  async getBandwidthPackage(id: number): Promise<BandwidthPackage | undefined> {
    return this.bandwidthPackages.get(id);
  }

  async createBandwidthPackage(insertPackage: InsertBandwidthPackage): Promise<BandwidthPackage> {
    const id = this.currentId++;
    const pkg: BandwidthPackage = { ...insertPackage, id };
    this.bandwidthPackages.set(id, pkg);
    return pkg;
  }

  // Hotspot Session methods
  async getHotspotSessions(userId: number): Promise<HotspotSession[]> {
    return Array.from(this.hotspotSessions.values()).filter(
      session => session.userId === userId
    );
  }

  async getHotspotSession(id: number): Promise<HotspotSession | undefined> {
    return this.hotspotSessions.get(id);
  }

  async createHotspotSession(insertSession: InsertHotspotSession): Promise<HotspotSession> {
    const id = this.currentId++;
    const session: HotspotSession = { 
      ...insertSession, 
      id,
      dataUsedMB: insertSession.dataUsedMB ?? 0,
      startTime: insertSession.startTime ?? null,
      endTime: insertSession.endTime ?? null,
      createdAt: new Date(),
    };
    this.hotspotSessions.set(id, session);
    return session;
  }

  async updateHotspotSession(id: number, updates: Partial<HotspotSession>): Promise<HotspotSession | undefined> {
    const session = this.hotspotSessions.get(id);
    if (!session) return undefined;
    
    const updatedSession = { ...session, ...updates };
    this.hotspotSessions.set(id, updatedSession);
    return updatedSession;
  }

  // Transaction methods
  async getTransaction(hash: string): Promise<Transaction | undefined> {
    return this.transactions.get(hash);
  }

  async createTransaction(insertTransaction: InsertTransaction): Promise<Transaction> {
    const id = this.currentId++;
    const transaction: Transaction = { 
      ...insertTransaction, 
      id,
      blockNumber: insertTransaction.blockNumber ?? null,
      createdAt: new Date(),
    };
    this.transactions.set(insertTransaction.hash, transaction);
    return transaction;
  }

  async updateTransaction(hash: string, updates: Partial<Transaction>): Promise<Transaction | undefined> {
    const transaction = this.transactions.get(hash);
    if (!transaction) return undefined;
    
    const updatedTransaction = { ...transaction, ...updates };
    this.transactions.set(hash, updatedTransaction);
    return updatedTransaction;
  }

  // Access Session Management
  async getAccessSession(sessionGuid: string): Promise<AccessSession | undefined> {
    return this.accessSessions.get(sessionGuid);
  }

  async getAccessSessionsByUser(userIdentifier: string): Promise<AccessSession[]> {
    return Array.from(this.accessSessions.values())
      .filter(session => session.userIdentifier === userIdentifier);
  }

  async createAccessSession(insertSession: InsertAccessSession): Promise<AccessSession> {
    const session: AccessSession = {
      id: this.currentId++,
      ...insertSession,
      createdAt: new Date(),
      lastAccessAt: null,
    };

    this.accessSessions.set(session.sessionGuid, session);
    return session;
  }

  async updateAccessSession(sessionGuid: string, updates: Partial<AccessSession>): Promise<AccessSession | undefined> {
    const session = this.accessSessions.get(sessionGuid);
    if (!session) return undefined;

    const updatedSession = { ...session, ...updates };
    this.accessSessions.set(sessionGuid, updatedSession);
    return updatedSession;
  }

  async getActiveAccessSessions(): Promise<AccessSession[]> {
    const now = new Date();
    return Array.from(this.accessSessions.values())
      .filter(session => 
        session.status === 'active' && 
        session.expiryDate > now
      );
  }

  async expireAccessSession(sessionGuid: string): Promise<void> {
    const session = this.accessSessions.get(sessionGuid);
    if (session) {
      session.status = 'expired';
      this.accessSessions.set(sessionGuid, session);
    }
  }


}

// Use MemStorage for now to ensure stability
export const storage = new MemStorage();
