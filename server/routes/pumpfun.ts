/**
 * Ghost AI — Pump.fun Graduation Tracker
 *
 * GET /api/pumpfun/trending
 *   Returns the Top 20 active bonding-curve tokens sorted by graduation
 *   progress (highest → lowest, capped at 100 %).
 *
 *   Response caching (3 s TTL):
 *   The ranking loop iterates the full tokenMap on every call.  A 3-second
 *   server-side cache prevents every frontend poll from triggering a full
 *   re-rank and stops Lovable components from receiving a new object
 *   reference on every request (which was causing blank-slot resets).
 *
 *   Single-flight guard:
 *   While a recomputation is already in-flight, concurrent requests are
 *   served the last stale payload immediately instead of each spawning their
 *   own ranking loop.  Only the very first request with no prior payload waits
 *   for the in-flight result.
 *
 * GET /api/pumpfun/health
 *   Lightweight WebSocket pipeline diagnostic.
 *
 * Graduation math:
 *   progress = min(100, (marketCapSol × solPriceUsd / 69_000) × 100)
 *
 * AI Alpha Signals:
 *   "BULLISH BREAKOUT"      — progress jumped > 5 pp in 60 s, < 70 % total
 *   "HIGH VELOCITY SQUEEZE" — progress jumped > 5 pp in 60 s, ≥ 70 % total
 */

import { Router, type Request, type Response } from "express";
import { tokenMap, wsStats } from "../lib/pumpportal-ws.js";
import { getSolPrice } from "../lib/sol-price.js";

export const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const GRADUATION_TARGET_USD = 69_000;
const TOP_N                 = 20;
const CACHE_TTL_MS          = 3_000;

// ── Cache state ───────────────────────────────────────────────────────────────

interface CachedResponse {
  payload:  string;   // pre-serialised JSON — avoids re-stringify on cache hits
  cachedAt: number;
}

let trendingCache:   CachedResponse | null  = null;
let refreshInFlight: Promise<string> | null = null;

// ── GET /api/pumpfun/trending ─────────────────────────────────────────────────

router.get("/trending", async (_req: Request, res: Response) => {
  const now = Date.now();

  // 1. Fresh cache hit — cheapest path
  if (trendingCache && now - trendingCache.cachedAt < CACHE_TTL_MS) {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Cache", "HIT");
    res.setHeader("X-Cache-Age-Ms", String(now - trendingCache.cachedAt));
    res.send(trendingCache.payload);
    return;
  }

  // 2. A refresh is already in-flight — serve stale or wait
  if (refreshInFlight) {
    if (trendingCache) {
      // Serve last payload immediately while the in-flight result will update
      // the cache for the next caller
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "STALE");
      res.send(trendingCache.payload);
      return;
    }
    // Very first request — no stale payload yet; wait for the one in-flight
    try {
      const payload = await refreshInFlight;
      res.setHeader("Content-Type", "application/json");
      res.setHeader("X-Cache", "MISS");
      res.send(payload);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Server error";
      res.status(500).json({ error: message });
    }
    return;
  }

  // 3. Cache miss — start one refresh; all concurrent callers use paths above
  refreshInFlight = computeTrendingPayload();
  try {
    const payload = await refreshInFlight;
    trendingCache  = { payload, cachedAt: Date.now() };
    res.setHeader("Content-Type", "application/json");
    res.setHeader("X-Cache", "MISS");
    res.send(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    // 503 if the root cause is a missing SOL price; 500 otherwise
    const status = (message.includes("unavailable") || message.includes("SOL price")) ? 503 : 500;
    res.status(status).json({ error: message, retryAfterSeconds: 5 });
  } finally {
    refreshInFlight = null;
  }
});

// ── Ranking computation ───────────────────────────────────────────────────────

async function computeTrendingPayload(): Promise<string> {
  const now          = Date.now();
  const solPriceUsd  = await getSolPrice();  // throws on cold-start failure

  const ranked: RankedToken[] = [];

  for (const entry of tokenMap.values()) {
    const marketCapUsd = entry.marketCapSol * solPriceUsd;
    const progressRaw  = (marketCapUsd / GRADUATION_TARGET_USD) * 100;
    const progress     = Math.min(100, parseFloat(progressRaw.toFixed(2)));

    if (progress >= 100) continue;

    ranked.push({
      mint:            entry.mint,
      name:            entry.name,
      symbol:          entry.symbol,
      imageUri:        entry.imageUri ?? null,
      bondingCurveKey: entry.bondingCurveKey,
      pool:            entry.pool,

      marketCapSol:          parseFloat(entry.marketCapSol.toFixed(4)),
      marketCapUsd:          parseFloat(marketCapUsd.toFixed(2)),
      vTokensInBondingCurve: entry.vTokensInBondingCurve,
      vSolInBondingCurve:    parseFloat(entry.vSolInBondingCurve.toFixed(4)),

      progress,
      graduationTargetUsd: GRADUATION_TARGET_USD,
      remainingUsd: parseFloat(
        Math.max(0, GRADUATION_TARGET_USD - marketCapUsd).toFixed(2)
      ),

      // AI Alpha signal — null until velocity threshold is crossed
      aiSignal: entry.aiSignal,

      firstSeen:   entry.firstSeen,
      lastUpdated: entry.lastUpdated,
      ageSeconds:  Math.floor((now - entry.firstSeen) / 1_000),
    });
  }

  ranked.sort((a, b) => b.progress - a.progress);
  const top20 = ranked.slice(0, TOP_N);

  return JSON.stringify({
    timestamp:           now,
    solPriceUsd,
    graduationTargetUsd: GRADUATION_TARGET_USD,
    trackedTokens:       tokenMap.size,
    returnedTokens:      top20.length,
    cacheMaxAgeMs:       CACHE_TTL_MS,
    pipeline: {
      connected:           wsStats.connected,
      connectedSince:      wsStats.connectedAt,
      totalEventsReceived: wsStats.totalEventsReceived,
    },
    tokens: top20,
  });
}

// ── GET /api/pumpfun/health ───────────────────────────────────────────────────

router.get("/health", (_req: Request, res: Response) => {
  const cacheAge = trendingCache ? Date.now() - trendingCache.cachedAt : null;
  res.json({
    wsConnected:         wsStats.connected,
    wsConnectedSince:    wsStats.connectedAt,
    totalEventsReceived: wsStats.totalEventsReceived,
    tokensTracked:       wsStats.tokensTracked,
    mapSize:             tokenMap.size,
    cache: {
      hot:   trendingCache !== null && cacheAge !== null && cacheAge < CACHE_TTL_MS,
      ageMs: cacheAge,
      ttlMs: CACHE_TTL_MS,
    },
  });
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface RankedToken {
  mint:                  string;
  name:                  string;
  symbol:                string;
  imageUri:              string | null;
  bondingCurveKey:       string;
  pool:                  string;
  marketCapSol:          number;
  marketCapUsd:          number;
  vTokensInBondingCurve: number;
  vSolInBondingCurve:    number;
  progress:              number;
  graduationTargetUsd:   number;
  remainingUsd:          number;
  aiSignal:              string | null;
  firstSeen:             number;
  lastUpdated:           number;
  ageSeconds:            number;
}
