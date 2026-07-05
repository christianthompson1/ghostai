/**
 * PumpPortal WebSocket client — real-time Pump.fun token state engine.
 *
 * Connects to wss://pumpportal.fun/api/data and maintains an in-memory map
 * of every active bonding-curve token we observe, keyed by mint address.
 *
 * Subscriptions:
 *   subscribeNewToken     → fires for every new pump.fun token creation
 *   subscribeTokenTrade   → fires for every on-chain buy/sell on the bonding curve;
 *                           keys: [] = subscribe to ALL token trades (PumpPortal
 *                           interprets an empty keys array as a global trade feed)
 *
 * Each event carries an up-to-date `marketCapSol` field, so the state map
 * is always current without any additional polling.
 *
 * Auto-reconnects with exponential backoff (1 s → 2 s → 4 s … capped at 30 s).
 * Graduated tokens (pool ≠ "pump" or marketCapSol > GRADUATION_SOL_THRESHOLD)
 * are immediately evicted from the map.
 *
 * Memory hygiene:
 *   - Tokens inactive for > 2 hours AND with < 10 % graduation progress are pruned.
 *   - Maximum map size is capped at 10,000 entries (evicts lowest-progress entries).
 */

import WebSocket from "ws";

// ── constants ─────────────────────────────────────────────────────────────────

/** Bonding curve completes at ≈ 85 SOL raised (maps to ~$69k USD at typical prices). */
const GRADUATION_SOL_THRESHOLD = 85;

const PUMPPORTAL_WS_URL = "wss://pumpportal.fun/api/data";

const RECONNECT_BASE_MS  = 1_000;
const RECONNECT_MAX_MS   = 30_000;
const PRUNE_INTERVAL_MS  = 60_000;  // prune stale entries every 60 s
const MAX_MAP_SIZE       = 10_000;
const STALE_AFTER_MS     = 2 * 60 * 60 * 1_000; // 2 hours
const LOW_PROGRESS_SOL   = GRADUATION_SOL_THRESHOLD * 0.10; // < 10 % progress

// ── types ─────────────────────────────────────────────────────────────────────

export interface TokenEntry {
  mint:                string;
  name:                string;
  symbol:              string;
  pool:                string;
  bondingCurveKey:     string;
  marketCapSol:        number;  // up-to-date SOL market cap from PumpPortal
  vTokensInBondingCurve: number;
  vSolInBondingCurve:  number;
  imageUri?:           string;
  firstSeen:           number;  // Date.now() when first added to map
  lastUpdated:         number;  // Date.now() of most recent trade event
}

/** Raw event shape from PumpPortal WebSocket. */
interface PumpEvent {
  txType?:                 string;   // "create" | "buy" | "sell"
  mint?:                   string;
  name?:                   string;
  symbol?:                 string;
  uri?:                    string;
  pool?:                   string;
  bondingCurveKey?:        string;
  marketCapSol?:           number;
  vTokensInBondingCurve?:  number;
  vSolInBondingCurve?:     number;
  message?:                string;   // subscription-ack messages
}

// ── state ─────────────────────────────────────────────────────────────────────

/** The single shared token-state map — read by /api/pumpfun/trending. */
export const tokenMap = new Map<string, TokenEntry>();

let ws: WebSocket | null = null;
let reconnectDelay = RECONNECT_BASE_MS;
let isRunning      = false;
let connectedAt: number | null = null;

/** Diagnostics exposed to the health endpoint. */
export const wsStats = {
  connected: false,
  connectedAt: null as number | null,
  totalEventsReceived: 0,
  tokensTracked: 0,
};

// ── public API ────────────────────────────────────────────────────────────────

/** Call once at server startup to begin the live data pipeline. */
export function startPumpPortalClient(): void {
  if (isRunning) return;
  isRunning = true;
  connect();
  setInterval(pruneStaleEntries, PRUNE_INTERVAL_MS);
  console.log("[PumpPortal] WebSocket client started");
}

// ── connection management ─────────────────────────────────────────────────────

function connect(): void {
  console.log(`[PumpPortal] Connecting to ${PUMPPORTAL_WS_URL} …`);

  ws = new WebSocket(PUMPPORTAL_WS_URL, {
    handshakeTimeout: 10_000,
  });

  ws.on("open", onOpen);
  ws.on("message", onMessage);
  ws.on("error", onError);
  ws.on("close", onClose);
}

function onOpen(): void {
  console.log("[PumpPortal] Connected — subscribing to token feed");
  reconnectDelay = RECONNECT_BASE_MS;
  connectedAt    = Date.now();

  wsStats.connected   = true;
  wsStats.connectedAt = connectedAt;

  // Subscribe to new token creation events (every new pump.fun launch)
  send({ method: "subscribeNewToken" });

  // Subscribe to ALL on-chain trades across every bonding curve.
  // PumpPortal treats an empty keys array as a global feed subscription.
  send({ method: "subscribeTokenTrade", keys: [] });
}

function onMessage(raw: Buffer): void {
  let event: PumpEvent;
  try {
    event = JSON.parse(raw.toString()) as PumpEvent;
  } catch {
    return; // malformed frame — ignore
  }

  // Subscription-ack messages have no mint; skip them
  if (event.message || !event.mint) return;

  wsStats.totalEventsReceived++;
  processEvent(event);
}

function onError(err: Error): void {
  console.error("[PumpPortal] WebSocket error:", err.message);
}

function onClose(code: number, reason: Buffer): void {
  ws = null;
  wsStats.connected   = false;
  wsStats.connectedAt = null;
  connectedAt         = null;

  console.warn(
    `[PumpPortal] Connection closed (${code} ${reason.toString() || "no reason"})` +
    ` — reconnecting in ${reconnectDelay / 1000}s`
  );

  setTimeout(() => {
    if (isRunning) connect();
  }, reconnectDelay);

  // Exponential backoff capped at RECONNECT_MAX_MS
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
}

function send(payload: object): void {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ── event processing ──────────────────────────────────────────────────────────

function processEvent(event: PumpEvent): void {
  const mint = event.mint;
  if (!mint) return;

  const marketCapSol = typeof event.marketCapSol === "number"
    ? event.marketCapSol
    : 0;

  // Evict graduated tokens immediately
  // "graduated" = bonding curve moved to a DEX pool (pool ≠ "pump" / "pumpfun")
  const pool = event.pool ?? "pump";
  const isGraduated =
    (pool !== "pump" && pool !== "pumpfun") ||
    marketCapSol >= GRADUATION_SOL_THRESHOLD;

  if (isGraduated) {
    if (tokenMap.has(mint)) {
      tokenMap.delete(mint);
      wsStats.tokensTracked = tokenMap.size;  // keep stats in sync immediately
      console.log(`[PumpPortal] Graduated & evicted: ${event.symbol ?? mint}`);
    }
    return;
  }

  const now     = Date.now();
  const existing = tokenMap.get(mint);

  if (existing) {
    // Update mutable fields from the latest trade event
    existing.marketCapSol          = marketCapSol || existing.marketCapSol;
    existing.vTokensInBondingCurve = event.vTokensInBondingCurve ?? existing.vTokensInBondingCurve;
    existing.vSolInBondingCurve    = event.vSolInBondingCurve    ?? existing.vSolInBondingCurve;
    existing.pool                  = pool;
    existing.lastUpdated           = now;
  } else {
    // First time we see this token
    const entry: TokenEntry = {
      mint,
      name:                  event.name   ?? "Unknown",
      symbol:                event.symbol ?? "???",
      pool,
      bondingCurveKey:       event.bondingCurveKey ?? "",
      marketCapSol,
      vTokensInBondingCurve: event.vTokensInBondingCurve ?? 0,
      vSolInBondingCurve:    event.vSolInBondingCurve    ?? 0,
      imageUri:              event.uri,
      firstSeen:             now,
      lastUpdated:           now,
    };
    tokenMap.set(mint, entry);
    enforceMapSizeCap();
  }

  wsStats.tokensTracked = tokenMap.size;
}

// ── memory hygiene ────────────────────────────────────────────────────────────

/** Evict tokens that haven't traded in 2 hours AND are below 10 % progress. */
function pruneStaleEntries(): void {
  const now   = Date.now();
  let pruned  = 0;

  for (const [mint, entry] of tokenMap) {
    const isStale     = now - entry.lastUpdated > STALE_AFTER_MS;
    const isLowValue  = entry.marketCapSol < LOW_PROGRESS_SOL;

    if (isStale && isLowValue) {
      tokenMap.delete(mint);
      pruned++;
    }
  }

  wsStats.tokensTracked = tokenMap.size;
  if (pruned > 0) console.log(`[PumpPortal] Pruned ${pruned} stale entries; ${tokenMap.size} remain`);
}

/** If the map exceeds MAX_MAP_SIZE, remove the lowest-marketCap entries first. */
function enforceMapSizeCap(): void {
  if (tokenMap.size <= MAX_MAP_SIZE) return;

  // Sort ascending by marketCapSol and drop the bottom entries
  const sorted = [...tokenMap.entries()].sort(
    ([, a], [, b]) => a.marketCapSol - b.marketCapSol
  );
  const toRemove = sorted.slice(0, tokenMap.size - MAX_MAP_SIZE);
  for (const [mint] of toRemove) tokenMap.delete(mint);
}
