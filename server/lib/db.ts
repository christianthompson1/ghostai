/**
 * Ghost AI — Simple JSON File Database
 *
 * Provides durable storage for demo accounts and auto-trade sessions.
 * State is kept in an in-memory working set (fast reads) and flushed to disk
 * after every mutation (debounced 500 ms to batch rapid writes).
 *
 * File: server/data/demo-db.json
 */

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── File path ─────────────────────────────────────────────────────────────────
// Use import.meta.url so the path is always relative to THIS file (db.ts),
// regardless of the working directory when the server starts.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR  = path.join(__dirname, "..", "data");     // server/data/
const DB_FILE   = path.join(DATA_DIR, "demo-db.json");
const TMP_FILE  = DB_FILE + ".tmp";

// ── Types (re-exported so other modules don't have to import demo.ts) ─────────

export interface TradeEntry {
  id:        string;
  action:    "buy" | "sell";
  mint:      string;
  symbol:    string;
  amount:    number;
  priceUsd:  number;
  totalUsd:  number;
  timestamp: string;
  /** Set on auto-trade sell legs */
  autoTradeId?: string;
}

export interface DemoAccount {
  userId:     string;
  balanceUsd: number;
  portfolio:  Record<string, number>;  // mint → quantity
  trades:     TradeEntry[];
  createdAt:  string;
}

export interface AutoTradeSession {
  sessionId:       string;
  userId:          string;
  status:          "ANALYZING_MARKET" | "EXECUTING_TRADE" | "COMPLETED" | "FAILED";
  durationMinutes: number;
  tradeAmountUsd:  number;
  selectedToken?:  {
    mint:      string;
    symbol:    string;
    priceUsd:  number;
    progress?: number;
    aiSignal?: string | null;
  };
  entryPrice?:  number;
  tokensHeld?:  number;  // quantity bought (for exact sell-back)
  exitPrice?:   number;
  pnl?:         number;
  pnlPercent?:  number;
  startedAt:    string;
  executedAt?:  string;
  expiresAt?:   string;
  completedAt?: string;
  failReason?:  string;
}

// ── In-memory working set ─────────────────────────────────────────────────────

interface DbShape {
  accounts:   Record<string, DemoAccount>;
  autoTrades: Record<string, AutoTradeSession>;  // keyed by sessionId
}

let db: DbShape = { accounts: {}, autoTrades: {} };

// ── Load from disk on startup ─────────────────────────────────────────────────

function loadDb(): void {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<DbShape>;
    db.accounts   = parsed.accounts   ?? {};
    db.autoTrades = parsed.autoTrades ?? {};
    const acctCount  = Object.keys(db.accounts).length;
    const tradeCount = Object.keys(db.autoTrades).length;
    console.log(`[DB] Loaded ${acctCount} account(s), ${tradeCount} auto-trade session(s) from disk`);
  } catch (err) {
    console.warn("[DB] Could not load demo-db.json — starting fresh:", (err as Error).message);
    db = { accounts: {}, autoTrades: {} };
  }
}

loadDb();

// ── Debounced flush to disk ───────────────────────────────────────────────────

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushNow();
  }, 500);
  // Don't block Node exit
  if (flushTimer.unref) flushTimer.unref();
}

function flushNow(): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const json = JSON.stringify(db, null, 2);
    fs.writeFileSync(TMP_FILE, json, "utf8");
    fs.renameSync(TMP_FILE, DB_FILE);   // atomic on POSIX
  } catch (err) {
    console.error("[DB] Flush error:", (err as Error).message);
  }
}

// Flush immediately on clean shutdown
process.on("SIGTERM", flushNow);
process.on("SIGINT",  flushNow);

// ── Account API ───────────────────────────────────────────────────────────────

export function getAccount(userId: string): DemoAccount | undefined {
  return db.accounts[userId];
}

export function hasAccount(userId: string): boolean {
  return Object.prototype.hasOwnProperty.call(db.accounts, userId);
}

export function saveAccount(account: DemoAccount): void {
  db.accounts[account.userId] = account;
  scheduleFlush();
}

export function getAllAccounts(): DemoAccount[] {
  return Object.values(db.accounts);
}

// ── Auto-trade session API ────────────────────────────────────────────────────

export function getAutoTrade(sessionId: string): AutoTradeSession | undefined {
  return db.autoTrades[sessionId];
}

/** Return the most recent auto-trade session for a user. */
export function getLatestAutoTradeForUser(userId: string): AutoTradeSession | undefined {
  const sessions = Object.values(db.autoTrades)
    .filter(s => s.userId === userId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return sessions[0];
}

/** Return all auto-trade sessions for a user, newest first. */
export function getAutoTradeHistoryForUser(userId: string): AutoTradeSession[] {
  return Object.values(db.autoTrades)
    .filter(s => s.userId === userId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export function saveAutoTrade(session: AutoTradeSession): void {
  db.autoTrades[session.sessionId] = session;
  scheduleFlush();
}
