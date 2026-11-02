import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

export interface TollgateSession {
  id: string;
  mac: string;
  ip: string;
  createdAt: number;
  allotment: number;
  metric: string;
  tokenHash: string;
}

export class TollgateStore {
  private db: Database.Database;

  constructor(dataDir: string) {
    const dir = path.resolve(process.cwd(), dataDir);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(path.join(dir, "tollgate.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        mac TEXT NOT NULL,
        ip TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        allotment INTEGER NOT NULL,
        metric TEXT NOT NULL,
        token_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_mac_created ON sessions(mac, created_at DESC);
      CREATE TABLE IF NOT EXISTS redemptions (
        token_hash TEXT PRIMARY KEY,
        amount INTEGER NOT NULL,
        session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS proofs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        proof TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
  }

  reserveToken(tokenHash: string): boolean {
    const result = this.db
      .prepare("INSERT OR IGNORE INTO redemptions (token_hash, amount, session_id, created_at) VALUES (?, 0, '', ?)")
      .run(tokenHash, Date.now());
    return result.changes === 1;
  }

  dropToken(tokenHash: string): void {
    this.db.prepare("DELETE FROM redemptions WHERE token_hash = ?").run(tokenHash);
  }

  recordPayment(opts: {
    tokenHash: string;
    amount: number;
    mac: string;
    ip: string;
    allotment: number;
    metric: string;
    proofs: unknown[];
  }): TollgateSession {
    const session: TollgateSession = {
      id: crypto.randomUUID(),
      mac: opts.mac,
      ip: opts.ip,
      createdAt: Date.now(),
      allotment: opts.allotment,
      metric: opts.metric,
      tokenHash: opts.tokenHash,
    };

    this.db.transaction(() => {
      this.db
        .prepare("UPDATE redemptions SET amount = ?, session_id = ? WHERE token_hash = ?")
        .run(opts.amount, session.id, opts.tokenHash);
      this.db
        .prepare(
          "INSERT INTO sessions (id, mac, ip, created_at, allotment, metric, token_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          session.id,
          session.mac,
          session.ip,
          session.createdAt,
          session.allotment,
          session.metric,
          session.tokenHash,
        );
      const insertProof = this.db.prepare("INSERT INTO proofs (proof, created_at) VALUES (?, ?)");
      for (const proof of opts.proofs) {
        insertProof.run(JSON.stringify(proof, (_key, value) => (typeof value === "bigint" ? value.toString() : value)), Date.now());
      }
    })();

    return session;
  }

  latestSession(mac: string): TollgateSession | undefined {
    return this.db
      .prepare("SELECT id, mac, ip, created_at AS createdAt, allotment, metric, token_hash AS tokenHash FROM sessions WHERE mac = ? ORDER BY created_at DESC LIMIT 1")
      .get(mac) as TollgateSession | undefined;
  }
}
