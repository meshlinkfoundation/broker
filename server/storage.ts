import { SQLiteStorage } from './sqlite-storage';
import {
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
  getAccessSessionByPaymentReference(paymentReference: string): Promise<AccessSession | undefined>;
  getAccessSessionsByUser(userIdentifier: string): Promise<AccessSession[]>;
  createAccessSession(session: InsertAccessSession): Promise<AccessSession>;
  updateAccessSession(sessionGuid: string, updates: Partial<AccessSession>): Promise<AccessSession | undefined>;
  getActiveAccessSessions(): Promise<AccessSession[]>;
  expireAccessSession(sessionGuid: string): Promise<void>;

  // Analytics
  recordPortalEvent?(event: {
    eventName: string;
    clientIp: string;
    visitId?: string;
    tierId?: string;
    paymentMethod?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  getAnalytics?(): Promise<any>;
}

export const storage: IStorage = new SQLiteStorage();
