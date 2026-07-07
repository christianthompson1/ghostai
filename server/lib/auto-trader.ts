/**
 * Ghost AI — 5-Minute AI Trading Automation Engine
 *
 * Triggered by POST /api/demo/auto-trade.
 *
 * State machine per session:
 *
 *   ANALYZING_MARKET  (≈ 2 s)
 *     ↓  Scans live Pump.fun trending + high-volatility tokens
 *   EXECUTING_TRADE   (durationMinutes countdown)
 *     ↓  Buys chosen token at current market price
 *   COMPLETED
 *        Sells at expiry price, records PnL in persistent DB
 *
 * Each session runs as a pair of setTimeout callbacks on the main Node thread;
 * no worker threads are needed for this use-case.
 *
 * One active session per userId.  Starting a new one while one is in-flight
 * returns 409.
 */

import {
  type AutoTradeSession,
  type DemoAccount,
  getAccount,
  saveAccount,
  saveAutoTrade,
  getLatestAutoTradeForUser,
} from "./db.js";
import { tokenMap } from "./pumpportal-ws.js";

// ── In-memory set of active session IDs ──────────────────────────────────────
// Used to enforce one-session-per-user and to cancel timers on demand.

const activeSessionsByUser = new Map<string, {
  sessionId: string;
  analyzeTimer: ReturnType<typeof setTimeout>;
  tradeTimer?: ReturnType<typeof setTimeout>;
}>();

// ── Public API ────────────────────────────────────────────────────────────────

export interface StartAutoTradeOptions {
  userId:          string;
  durationMinutes: number;   // how long to hold the trade
  tradeAmountUsd:  number;   // USD notional to risk
}

export interface StartAutoTradeResult {
  ok:        true;
  session:   AutoTradeSession;
}

export interface StartAutoTradeError {
  ok:        false;
  status:    number;
  error:     string;
}

/** Start a new auto-trade session. */
export function startAutoTrade(
  opts: StartAutoTradeOptions
): StartAutoTradeResult | StartAutoTradeError {
  const { userId, durationMinutes, tradeAmountUsd } = opts;

  // Check account exists
  const account = getAccount(userId);
  if (!account) {
    return { ok: false, status: 404, error: "Demo account not found — call POST /api/demo/initialize first" };
  }

  // Enforce one active session per user
  if (activeSessionsByUser.has(userId)) {
    const existing = getLatestAutoTradeForUser(userId);
    return {
      ok: false, status: 409,
      error: `An auto-trade session is already in progress (status: ${existing?.status ?? "ACTIVE"})`,
    };
  }

  // Validate balance
  if (account.balanceUsd < tradeAmountUsd) {
    return {
      ok: false, status: 422,
      error: `Insufficient demo balance ($${account.balanceUsd.toFixed(2)} available, $${tradeAmountUsd.toFixed(2)} requested)`,
    };
  }

  const sessionId = generateId();
  const now       = new Date().toISOString();

  const session: AutoTradeSession = {
    sessionId,
    userId,
    status:          "ANALYZING_MARKET",
    durationMinutes,
    tradeAmountUsd,
    startedAt:       now,
  };

  saveAutoTrade(session);

  // Phase 1: analyze for 2 seconds, then execute
  const analyzeTimer = setTimeout(() => {
    runAnalyzePhase(session).catch(err => {
      session.status    = "FAILED";
      session.failReason = (err as Error).message ?? "Unknown error during analysis";
      saveAutoTrade(session);
      activeSessionsByUser.delete(userId);
      console.error(`[AutoTrader] Session ${sessionId} failed in analysis:`, session.failReason);
    });
  }, 2_000);

  if (analyzeTimer.unref) analyzeTimer.unref();

  activeSessionsByUser.set(userId, { sessionId, analyzeTimer });

  return { ok: true, session };
}

/** Cancel any active session for a user (best-effort). */
export function cancelAutoTrade(userId: string): boolean {
  const active = activeSessionsByUser.get(userId);
  if (!active) return false;

  clearTimeout(active.analyzeTimer);
  if (active.tradeTimer) clearTimeout(active.tradeTimer);
  activeSessionsByUser.delete(userId);

  const session = getLatestAutoTradeForUser(userId);
  if (session && session.status !== "COMPLETED") {
    session.status    = "FAILED";
    session.failReason = "Cancelled by user";
    saveAutoTrade(session);
  }
  return true;
}

// ── Phase 1: Market analysis → pick token → buy ───────────────────────────────

async function runAnalyzePhase(session: AutoTradeSession): Promise<void> {
  console.log(`[AutoTrader] ${session.sessionId} — analyzing market…`);

  const candidate = await pickBestToken();
  if (!candidate) {
    throw new Error("No suitable high-volatility token found — try again when the market is more active");
  }

  // Fetch live price from DexScreener (more reliable than tokenMap price)
  const priceUsd = await fetchTokenPrice(candidate.mint) ?? candidate.estimatedPriceUsd;
  if (!priceUsd || priceUsd <= 0) {
    throw new Error(`Could not determine price for ${candidate.symbol}`);
  }

  // Deduct from balance — compute exact token quantity
  const account = getAccount(session.userId);
  if (!account) throw new Error("Account disappeared");

  const tokensHeld = session.tradeAmountUsd / priceUsd;
  account.balanceUsd = parseFloat((account.balanceUsd - session.tradeAmountUsd).toFixed(6));
  account.portfolio[candidate.mint] = parseFloat(
    ((account.portfolio[candidate.mint] ?? 0) + tokensHeld).toFixed(9)
  );

  const tradeEntry = {
    id:        generateId(),
    action:    "buy" as const,
    mint:      candidate.mint,
    symbol:    candidate.symbol,
    amount:    tokensHeld,
    priceUsd,
    totalUsd:  session.tradeAmountUsd,
    timestamp: new Date().toISOString(),
    autoTradeId: session.sessionId,
  };
  account.trades.push(tradeEntry);
  saveAccount(account);

  const expiresAt = new Date(Date.now() + session.durationMinutes * 60_000).toISOString();

  session.status        = "EXECUTING_TRADE";
  session.selectedToken = {
    mint:      candidate.mint,
    symbol:    candidate.symbol,
    priceUsd,
    progress:  candidate.progress,
    aiSignal:  candidate.aiSignal,
  };
  session.entryPrice  = priceUsd;
  session.tokensHeld  = tokensHeld;
  session.executedAt  = new Date().toISOString();
  session.expiresAt   = expiresAt;
  saveAutoTrade(session);

  console.log(`[AutoTrader] ${session.sessionId} — bought ${tokensHeld.toFixed(4)} ${candidate.symbol} @ $${priceUsd} — expires ${expiresAt}`);

  // Phase 2: hold for durationMinutes, then close
  const msRemaining = new Date(expiresAt).getTime() - Date.now();
  const active      = activeSessionsByUser.get(session.userId);

  const tradeTimer = setTimeout(() => {
    runClosePhase(session).catch(err => {
      session.status    = "FAILED";
      session.failReason = (err as Error).message;
      saveAutoTrade(session);
      activeSessionsByUser.delete(session.userId);
      console.error(`[AutoTrader] Session ${session.sessionId} failed on close:`, session.failReason);
    });
  }, msRemaining);

  if (tradeTimer.unref) tradeTimer.unref();
  if (active) active.tradeTimer = tradeTimer;
}

// ── Phase 2: Trade expiry → sell → record PnL ────────────────────────────────

async function runClosePhase(session: AutoTradeSession): Promise<void> {
  console.log(`[AutoTrader] ${session.sessionId} — closing trade…`);

  const mint       = session.selectedToken!.mint;
  const symbol     = session.selectedToken!.symbol;
  const entryPrice = session.entryPrice!;
  const tokensHeld = session.tokensHeld!;

  // Fetch exit price from DexScreener
  const exitPrice = await fetchTokenPrice(mint) ?? entryPrice;

  const account = getAccount(session.userId);
  if (!account) throw new Error("Account disappeared on close");

  // Sell all auto-trade tokens
  const held = account.portfolio[mint] ?? 0;
  const sellQty   = Math.min(tokensHeld, held);  // guard against external sells
  const proceeds  = parseFloat((sellQty * exitPrice).toFixed(6));

  account.balanceUsd = parseFloat((account.balanceUsd + proceeds).toFixed(6));
  const remaining    = parseFloat((held - sellQty).toFixed(9));
  if (remaining <= 0) {
    delete account.portfolio[mint];
  } else {
    account.portfolio[mint] = remaining;
  }

  account.trades.push({
    id:        generateId(),
    action:    "sell",
    mint,
    symbol,
    amount:    sellQty,
    priceUsd:  exitPrice,
    totalUsd:  proceeds,
    timestamp: new Date().toISOString(),
    autoTradeId: session.sessionId,
  });
  saveAccount(account);

  const pnl        = parseFloat((proceeds - session.tradeAmountUsd).toFixed(6));
  const pnlPercent = parseFloat(((pnl / session.tradeAmountUsd) * 100).toFixed(4));

  session.status       = "COMPLETED";
  session.exitPrice    = exitPrice;
  session.pnl          = pnl;
  session.pnlPercent   = pnlPercent;
  session.completedAt  = new Date().toISOString();
  saveAutoTrade(session);

  activeSessionsByUser.delete(session.userId);

  const sign = pnl >= 0 ? "+" : "";
  console.log(`[AutoTrader] ${session.sessionId} — closed ${symbol}: ${sign}$${pnl.toFixed(4)} (${sign}${pnlPercent.toFixed(2)}%)`);
}

// ── Token selection ───────────────────────────────────────────────────────────

interface TokenCandidate {
  mint:              string;
  symbol:            string;
  estimatedPriceUsd: number;
  progress:          number;
  aiSignal:          string | null;
  score:             number;
}

/**
 * Pick the highest-opportunity token from our live Pump.fun feed.
 *
 * Scoring: prefer tokens with AI signals AND mid-range progress (20–80%).
 * Very-low-progress tokens may lack liquidity; near-graduation tokens could
 * spike or dump without warning.
 */
async function pickBestToken(): Promise<TokenCandidate | null> {
  const GRADUATION_USD   = 69_000;
  const GRADUATION_SOL   = 85;

  let solPriceUsd = 150;  // reasonable fallback
  try {
    const { getSolPrice } = await import("./sol-price.js");
    solPriceUsd = await getSolPrice();
  } catch { /* use fallback */ }

  const candidates: TokenCandidate[] = [];

  for (const entry of tokenMap.values()) {
    const progress = Math.min(100, (entry.marketCapSol * solPriceUsd / GRADUATION_USD) * 100);
    if (progress < 5 || progress >= 100) continue;     // skip too-new or graduated

    // Estimate price from bonding curve (SOL per token × USD/SOL)
    const estimatedPriceUsd = entry.vTokensInBondingCurve > 0
      ? (entry.vSolInBondingCurve / entry.vTokensInBondingCurve) * solPriceUsd
      : 0;

    if (estimatedPriceUsd <= 0) continue;

    // Score: prefer 20–70% range; bonus for AI signal
    const progressScore = progress >= 20 && progress <= 70 ? 2 : 1;
    const signalBonus   = entry.aiSignal ? 3 : 0;
    const recencyBonus  = entry.lastUpdated > Date.now() - 30_000 ? 1 : 0;  // updated in last 30 s
    const score         = progressScore + signalBonus + recencyBonus + (progress / 100);

    candidates.push({
      mint:   entry.mint,
      symbol: entry.symbol,
      estimatedPriceUsd,
      progress,
      aiSignal: entry.aiSignal,
      score,
    });
  }

  if (candidates.length === 0) return null;

  // Sort descending by score, pick the best
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

// ── Price fetcher ─────────────────────────────────────────────────────────────

async function fetchTokenPrice(mint: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!res.ok) return null;

    const data = (await res.json()) as {
      pairs?: Array<{
        chainId:    string;
        priceUsd?:  string;
        liquidity?: { usd?: number };
      }>;
    };

    const pairs = (data.pairs ?? []).filter(p => p.chainId === "solana");
    if (pairs.length === 0) return null;

    const best  = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    const price = parseFloat(best.priceUsd ?? "0");
    return price > 0 ? price : null;
  } catch {
    return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}
