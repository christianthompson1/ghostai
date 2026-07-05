/**
 * Ghost AI — Pump.fun Graduation Tracker
 *
 * GET /api/pumpfun/trending
 *   Returns the Top 20 active bonding-curve tokens sorted by graduation
 *   progress (highest → lowest, capped at 100 %).
 *
 * Data pipeline:
 *   1. Live token state is maintained by the PumpPortal WebSocket client
 *      (server/lib/pumpportal-ws.ts), which receives real-time create/trade
 *      events for every token on the pump.fun bonding curve program.
 *   2. SOL/USD price is cached for 30 s (server/lib/sol-price.ts).
 *   3. Graduation progress = min(100, (marketCapUsd / 69_000) * 100).
 *   4. Graduated tokens (progress ≥ 100 %) are evicted from the live state
 *      map immediately upon detection and never appear in this response.
 *
 * Pump.fun bonding curve constants:
 *   - Total supply  : 1,000,000,000 tokens
 *   - Graduation MC : ~$69,000 USD  (≈ 85 SOL at typical prices)
 *
 * CORS is handled globally by the Express middleware in server/index.ts.
 */

import { Router, type Request, type Response } from "express";
import { tokenMap, wsStats, type TokenEntry } from "../lib/pumpportal-ws.js";
import { getSolPrice } from "../lib/sol-price.js";

export const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

/** USD market-cap target at which a bonding curve completes. */
const GRADUATION_TARGET_USD = 69_000;

/** Number of tokens to return. */
const TOP_N = 20;

// ── GET /api/pumpfun/trending ─────────────────────────────────────────────────

router.get("/trending", async (_req: Request, res: Response) => {
  try {
    let solPriceUsd: number;
    try {
      solPriceUsd = await getSolPrice();
    } catch (priceErr) {
      // SOL price is unavailable and we have no cached value — surface a 503
      // so the client knows the data is degraded rather than receiving wrong rankings.
      const msg = priceErr instanceof Error ? priceErr.message : "SOL price unavailable";
      res.status(503).json({ error: msg, retryAfterSeconds: 5 });
      return;
    }

    // ── Build ranked list ───────────────────────────────────────────────────
    const ranked: RankedToken[] = [];

    for (const entry of tokenMap.values()) {
      const marketCapUsd  = entry.marketCapSol * solPriceUsd;
      const progressRaw   = (marketCapUsd / GRADUATION_TARGET_USD) * 100;
      const progress      = Math.min(100, parseFloat(progressRaw.toFixed(2)));

      // Skip anything already at or beyond the graduation threshold.
      // (The WS client evicts these on arrival, but guard here as well.)
      if (progress >= 100) continue;

      ranked.push({
        mint:              entry.mint,
        name:              entry.name,
        symbol:            entry.symbol,
        imageUri:          entry.imageUri ?? null,
        bondingCurveKey:   entry.bondingCurveKey,
        pool:              entry.pool,

        // Market cap
        marketCapSol:      parseFloat(entry.marketCapSol.toFixed(4)),
        marketCapUsd:      parseFloat(marketCapUsd.toFixed(2)),

        // Bonding-curve reserves (for clients that want to display pool depth)
        vTokensInBondingCurve: entry.vTokensInBondingCurve,
        vSolInBondingCurve:    parseFloat(entry.vSolInBondingCurve.toFixed(4)),

        // Graduation progress
        progress,
        graduationTargetUsd: GRADUATION_TARGET_USD,
        remainingUsd: parseFloat(
          Math.max(0, GRADUATION_TARGET_USD - marketCapUsd).toFixed(2)
        ),

        // Timing
        firstSeen:   entry.firstSeen,
        lastUpdated: entry.lastUpdated,
        ageSeconds:  Math.floor((Date.now() - entry.firstSeen) / 1_000),
      });
    }

    // Sort descending by progress (nearest to graduation first)
    ranked.sort((a, b) => b.progress - a.progress);
    const top20 = ranked.slice(0, TOP_N);

    // ── Response ──────────────────────────────────────────────────────────
    res.json({
      timestamp:       Date.now(),
      solPriceUsd,
      graduationTargetUsd: GRADUATION_TARGET_USD,
      trackedTokens:   tokenMap.size,
      returnedTokens:  top20.length,

      // WebSocket pipeline health
      pipeline: {
        connected:         wsStats.connected,
        connectedSince:    wsStats.connectedAt,
        totalEventsReceived: wsStats.totalEventsReceived,
      },

      tokens: top20,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});

// ── GET /api/pumpfun/health ───────────────────────────────────────────────────
/** Quick diagnostic — confirms the WS pipeline is alive without computing ranks. */
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    wsConnected:         wsStats.connected,
    wsConnectedSince:    wsStats.connectedAt,
    totalEventsReceived: wsStats.totalEventsReceived,
    tokensTracked:       wsStats.tokensTracked,
    mapSize:             tokenMap.size,
  });
});

// ── types ─────────────────────────────────────────────────────────────────────

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
  firstSeen:             number;
  lastUpdated:           number;
  ageSeconds:            number;
}
