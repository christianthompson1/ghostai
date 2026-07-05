/**
 * Ghost AI — Market Data Router
 *
 * GET /api/market/candles?token=:address&timeframe=:timeframe
 *
 *   Returns historical OHLCV candlestick data for any Solana token.
 *
 *   Supported timeframes:
 *     15m  → 24 candles × 15 min  (last 6 hours)
 *     1h   → 24 candles × 1 hour  (last 24 hours)
 *     1d   → 30 candles × 1 day   (last 30 days)
 *
 *   Data sources (tried in order):
 *     1. CoinGecko OHLC — used for well-known tokens (SOL, BONK, etc.)
 *        Delivers genuine exchange candles with real open/high/low/close.
 *     2. Synthetic (DexScreener-anchored) — for all other tokens.
 *        Price-change anchors from DexScreener (h1/h6/h24) are used to
 *        build a piecewise Brownian bridge, ensuring the chart shows a
 *        real trend direction rather than a flat line.
 *
 *   Response is cached 60 seconds server-side so repeated frontend polls
 *   don't re-fetch upstream on every render cycle.
 *
 * CORS is applied globally in server/index.ts.
 */

import { Router, type Request, type Response } from "express";
import { getCandles, type Timeframe } from "../lib/candle-builder.js";

export const router = Router();

const VALID_TIMEFRAMES = new Set<string>(["15m", "1h", "1d"]);

// ── GET /api/market/candles ───────────────────────────────────────────────────

router.get("/candles", async (req: Request, res: Response) => {
  const { token, timeframe } = req.query as {
    token?:     string;
    timeframe?: string;
  };

  // ── Validation ─────────────────────────────────────────────────────────────
  if (!token || typeof token !== "string" || token.trim() === "") {
    res.status(400).json({
      error: "Query param 'token' is required (Solana mint address)",
    });
    return;
  }

  const tf = (timeframe ?? "1h").toLowerCase();
  if (!VALID_TIMEFRAMES.has(tf)) {
    res.status(400).json({
      error: `Invalid timeframe '${tf}'. Must be one of: 15m, 1h, 1d`,
    });
    return;
  }

  // ── Fetch candles ──────────────────────────────────────────────────────────
  try {
    const result = await getCandles(token.trim(), tf as Timeframe);

    res.json({
      token:     result.mint,
      timeframe: result.timeframe,
      source:    result.source,
      count:     result.candles.length,
      candles:   result.candles,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});
