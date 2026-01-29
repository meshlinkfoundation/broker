import { pgTable, text, serial, integer, boolean, timestamp, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  walletAddress: text("wallet_address").notNull().unique(),
  username: text("username"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const l2Networks = pgTable("l2_networks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  chainId: integer("chain_id").notNull(),
  rpcUrl: text("rpc_url").notNull(),
  gasPrice: decimal("gas_price", { precision: 18, scale: 9 }).notNull(),
  confirmationTime: integer("confirmation_time").notNull(), // in seconds
  isActive: boolean("is_active").default(true).notNull(),
});

export const bandwidthPackages = pgTable("bandwidth_packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  dataLimitMB: integer("data_limit_mb").notNull(),
  durationHours: integer("duration_hours").notNull(),
  priceMeshTokens: decimal("price_mesh_tokens", { precision:10, scale:2 }).notNull(),
  isFree: boolean("is_free").default(false).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
});

export const hotspotSessions = pgTable("hotspot_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  packageId: integer("package_id").references(() => bandwidthPackages.id).notNull(),
  networkId: integer("network_id").references(() => l2Networks.id).notNull(),
  transactionHash: text("transaction_hash").notNull(),
  status: text("status").notNull(), // 'pending', 'active', 'expired', 'cancelled'
  dataUsedMB: integer("data_used_mb").default(0).notNull(),
  startTime: timestamp("start_time"),
  endTime: timestamp("end_time"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").references(() => hotspotSessions.id).notNull(),
  hash: text("hash").notNull().unique(),
  networkId: integer("network_id").references(() => l2Networks.id).notNull(),
  fromAddress: text("from_address").notNull(),
  toAddress: text("to_address").notNull(),
  amount: decimal("amount", { precision: 18, scale: 9 }).notNull(),
  gasUsed: decimal("gas_used", { precision: 18, scale: 9 }).notNull(),
  status: text("status").notNull(), // 'pending', 'confirmed', 'failed'
  blockNumber: integer("block_number"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  createdAt: true,
});

export const insertL2NetworkSchema = createInsertSchema(l2Networks).omit({
  id: true,
});

export const insertBandwidthPackageSchema = createInsertSchema(bandwidthPackages).omit({
  id: true,
});

export const insertHotspotSessionSchema = createInsertSchema(hotspotSessions).omit({
  id: true,
  createdAt: true,
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

// Types
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type L2Network = typeof l2Networks.$inferSelect;
export type InsertL2Network = z.infer<typeof insertL2NetworkSchema>;

export type BandwidthPackage = typeof bandwidthPackages.$inferSelect;
export type InsertBandwidthPackage = z.infer<typeof insertBandwidthPackageSchema>;

export type HotspotSession = typeof hotspotSessions.$inferSelect;
export type InsertHotspotSession = z.infer<typeof insertHotspotSessionSchema>;

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;

// Access Management Schema
export const accessSessions = pgTable("access_sessions", {
  id: serial("id").primaryKey(),
  sessionGuid: text("session_guid").notNull().unique(),
  userIdentifier: text("user_identifier").notNull(), // Could be MAC address, device ID, etc.
  tierId: text("tier_id").notNull(),
  tierName: text("tier_name").notNull(),
  paymentMethod: text("payment_method").notNull(), // 'stripe' or 'crypto'
  paymentReference: text("payment_reference"), // Stripe payment ID or crypto tx hash
  startDate: timestamp("start_date").notNull(),
  expiryDate: timestamp("expiry_date").notNull(),
  dataLimitMB: integer("data_limit_mb").notNull(),
  dataUsedMB: integer("data_used_mb").notNull().default(0),
  speedMbps: text("speed_mbps").notNull(), // Can be number or "max"
  status: text("status").notNull().default("active"), // active, expired, suspended
  nodeOperator: text("node_operator").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastAccessAt: timestamp("last_access_at"),
});

export const insertAccessSessionSchema = createInsertSchema(accessSessions).omit({
  id: true,
  createdAt: true,
});

export type AccessSession = typeof accessSessions.$inferSelect;
export type InsertAccessSession = z.infer<typeof insertAccessSessionSchema>;
