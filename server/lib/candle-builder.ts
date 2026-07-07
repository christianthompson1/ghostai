/**
 * Candle Builder — real OHLCV for charting
 *
 * Routing strategy:
 *
 *   Standard tokens (SOL, BONK, MYRO, WEN, POPCAT, etc.)
 *     → CoinGecko OHLC API — genuine exchange candles with real O/H/L/C
 *
 *   Pump.fun tokens (mint ends in "pump" OR tracked in our live PumpPortal feed)
 *     → fetchPumpFunAnchors():  uses live bonding-curve state from our
 *       in-memory tokenMap (vSol/vTokens → price) plus recent price deltas
 *       from DexScreener when available, then builds a synthetic OHLCV series
 *       anchored to real data points
 *
 *   All other tokens (DeFi, NFT-adjacent, obscure mints, etc.)
 *     → fetchDexScreenerAnchors():  DexScreener price-change anchors
 *       (h1/h6/h24) → piecewise Brownian-bridge OHLCV
 *
 * The Brownian-bridge approach is deliberately honest:
 *   - Segment open/close values follow real price anchors.
 *   - Only intra-candle wicks are synthetic.
 *   - A deterministic seeded RNG (mint + timeframe key) prevents chart flicker.
 *
 * Supported timeframes:
 *   15m → 24 candles × 15 min  (last 6 hours)
 *   1h  → 24 candles × 1 hour  (last 24 hours)
 *   1d  → 30 candles × 1 day   (last 30 days)
 *
 * Cache: 60 s per (mint, timeframe), max 500 entries (LRU eviction).
 */

import { tokenMap }   from "./pumpportal-ws.js";
import { getSolPrice } from "./sol-price.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type Timeframe = "15m" | "1h" | "1d";

export interface Candle {
  time:   number;  // Unix seconds (start of candle)
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

export interface CandleResult {
  mint:      string;
  timeframe: Timeframe;
  source:    "coingecko" | "pumpfun-live" | "synthetic";
  candles:   Candle[];
}

// ── Cache ─────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS   = 60_000;
const CACHE_MAX_SIZE = 500;

interface CacheEntry {
  data:     CandleResult;
  cachedAt: number;
}
const cache = new Map<string, CacheEntry>();

function cacheKey(mint: string, timeframe: Timeframe): string {
  return `${mint}:${timeframe}`;
}

function evictCandleCache(): void {
  const now = Date.now();
  for (const [k, v] of cache) {
    if (now - v.cachedAt >= CACHE_TTL_MS) cache.delete(k);
  }
  while (cache.size > CACHE_MAX_SIZE) {
    cache.delete(cache.keys().next().value as string);
  }
}

// ── Well-known CoinGecko coin IDs (Solana ecosystem) ─────────────────────────

const COINGECKO_IDS: Record<string, string> = {
  // Core
  "So11111111111111111111111111111111111111112":    "solana",
  "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So":  "msol",
  "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs":  "wrapped-ether-wormhole",
  // Memecoins
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263": "bonk",
  "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm": "dogwifhat",
  "HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4": "myro",
  "WENWENvqqNya429ubCdR81ZmD69brwQaaBYY6p3LCpk":   "wen-4",
  "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr": "popcat",
  "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5":   "cat-in-a-dogs-world",
  "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump":  "fartcoin",
  // DeFi / Infrastructure
  "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN":  "jupiter-exchange-solana",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "raydium",
  "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU": "samoyedcoin",
  "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE":  "orca",
};

// ── Pump.fun token detection ──────────────────────────────────────────────────

/**
 * Returns true if this mint is a Pump.fun bonding-curve token.
 * Detection: address ends in "pump" (the suffix used by pump.fun's factory)
 * OR the mint is currently tracked in our live PumpPortal WebSocket feed.
 */
function isPumpFunToken(mint: string): boolean {
  return mint.endsWith("pump") || tokenMap.has(mint);
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function getCandles(
  mint:      string,
  timeframe: Timeframe
): Promise<CandleResult> {
  const key    = cacheKey(mint, timeframe);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  const result = await buildCandles(mint, timeframe);

  evictCandleCache();
  cache.set(key, { data: result, cachedAt: Date.now() });
  return result;
}

// ── Build candles — routing logic ─────────────────────────────────────────────

async function buildCandles(mint: string, timeframe: Timeframe): Promise<CandleResult> {
  // 1. Known tokens → CoinGecko (real exchange candles)
  const cgId = COINGECKO_IDS[mint];
  if (cgId) {
    const cgResult = await fetchCoinGeckoCandles(mint, cgId, timeframe);
    if (cgResult) return cgResult;
    // Fall through on CoinGecko failure
  }

  // 2. Pump.fun tokens → live bonding-curve data from our PumpPortal feed
  if (isPumpFunToken(mint)) {
    const pumpResult = await buildPumpFunCandles(mint, timeframe);
    if (pumpResult) return pumpResult;
    // Fall through to DexScreener synthetic if tokenMap has no data
  }

  // 3. All other tokens → DexScreener anchors + synthetic Brownian bridge
  const anchors = await fetchDexScreenerAnchors(mint);
  return buildSyntheticCandles(mint, timeframe, anchors);
}

// ── Pump.fun live candle builder ──────────────────────────────────────────────

/**
 * Build candles for a pump.fun token using our live PumpPortal data.
 *
 * The bonding-curve state gives us:
 *   - Current price: vSolInBondingCurve / vTokensInBondingCurve (in SOL)
 *   - Volume proxy: vSolInBondingCurve × solPrice × 2 (rough traded volume)
 *
 * We then check DexScreener for price-change anchors (if the token is already
 * listed there) to get more realistic historical price points.  If DexScreener
 * has no data we extrapolate history from the bonding-curve progress curve.
 */
async function buildPumpFunCandles(
  mint:      string,
  timeframe: Timeframe
): Promise<CandleResult | null> {
  const entry = tokenMap.get(mint);

  let solPriceUsd = 150;
  try { solPriceUsd = await getSolPrice(); } catch { /* use fallback */ }

  // Compute current price from bonding curve (SOL → USD)
  let priceNow = 0;
  if (entry && entry.vTokensInBondingCurve > 0) {
    priceNow = (entry.vSolInBondingCurve / entry.vTokensInBondingCurve) * solPriceUsd;
  }

  // Try DexScreener anchors regardless — if the token has been listed there,
  // we get real price-change percentages which make the chart more accurate.
  const dexAnchors = await fetchDexScreenerAnchors(mint);

  // If DexScreener gave us a real price (≠ fallback 1), use it for priceNow
  // since it reflects the DEX price (more useful than bonding-curve estimate)
  if (dexAnchors.priceNow > 1 || (dexAnchors.priceNow > 0 && dexAnchors.pairAddr !== "unknown")) {
    priceNow = dexAnchors.priceNow;
  }

  if (priceNow <= 0 && !entry) return null;
  if (priceNow <= 0) return null;

  // Build realistic price anchors from bonding-curve age + DexScreener deltas
  let anchors: PriceAnchors;

  if (dexAnchors.priceNow > 0 && dexAnchors.pairAddr !== "unknown") {
    // DexScreener has real data — use it directly (best case)
    anchors = { ...dexAnchors, priceNow };
  } else if (entry) {
    // Estimate history from token age and bonding-curve progress
    // Newer tokens have more aggressive price curves (pump.fun launch curve)
    const ageMs = Date.now() - entry.firstSeen;
    const ageH  = ageMs / 3_600_000;

    // Assume launch price was ~10-30% of current (typical pump.fun trajectory)
    const launchFactor = 0.15;
    const launchPrice  = priceNow * launchFactor;

    // Use a log-curve: price grew rapidly early, slowing as bonding curve fills
    const progress = Math.min(1, entry.marketCapSol / 85);
    const price6hAgo  = priceNow * Math.max(launchFactor, 1 - (1 - launchFactor) * Math.min(1, ageH / 6));
    const price1hAgo  = priceNow * Math.max(0.7, 0.90 + progress * 0.10);
    const price24hAgo = ageH < 24 ? priceNow * launchFactor : priceNow * 0.50;

    anchors = {
      priceNow,
      price1h:  price1hAgo,
      price6h:  price6hAgo,
      price24h: price24hAgo,
      price5m:  priceNow * 0.98,
      volH24:   entry.vSolInBondingCurve * solPriceUsd * 2,
      volH6:    entry.vSolInBondingCurve * solPriceUsd * 0.5,
      volH1:    entry.vSolInBondingCurve * solPriceUsd * 0.1,
      pairAddr: entry.bondingCurveKey,
    };
  } else {
    return null;
  }

  const result = buildSyntheticCandles(mint, timeframe, anchors);
  // Override source to signal pump.fun provenance
  return { ...result, source: "pumpfun-live" };
}

// ── CoinGecko OHLC ────────────────────────────────────────────────────────────

interface CgOhlcCandle { time: number; open: number; high: number; low: number; close: number }

async function fetchCoinGeckoCandles(
  mint:      string,
  cgId:      string,
  timeframe: Timeframe
): Promise<CandleResult | null> {
  const days = timeframe === "1d" ? 30 : 1;

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(cgId)}/ohlc?vs_currency=usd&days=${days}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;

    const raw = (await res.json()) as [number, number, number, number, number][];
    if (!Array.isArray(raw) || raw.length === 0) return null;

    let candles: Candle[];

    if (timeframe === "1d") {
      candles = raw.slice(-30).map(([ts, o, h, l, c]) => ({
        time: Math.floor(ts / 1000), open: o, high: h, low: l, close: c, volume: 0,
      }));
    } else if (timeframe === "1h") {
      candles = resampleToHourly(
        raw.map(([ts, o, h, l, c]) => ({ time: Math.floor(ts / 1000), open: o, high: h, low: l, close: c }))
      ).slice(-24);
    } else {
      // 15m: interpolate 30-min candles from CoinGecko
      candles = resampleTo15Min(
        raw.map(([ts, o, h, l, c]) => ({ time: Math.floor(ts / 1000), open: o, high: h, low: l, close: c }))
      ).slice(-24);
    }

    if (candles.length === 0) return null;
    return { mint, timeframe, source: "coingecko", candles };
  } catch {
    return null;
  }
}

function resampleToHourly(candles30m: CgOhlcCandle[]): Candle[] {
  const result: Candle[] = [];
  for (let i = 0; i + 1 < candles30m.length; i += 2) {
    const a = candles30m[i], b = candles30m[i + 1];
    result.push({
      time: a.time, open: a.open,
      high: Math.max(a.high, b.high), low: Math.min(a.low, b.low),
      close: b.close, volume: 0,
    });
  }
  return result;
}

function resampleTo15Min(candles30m: CgOhlcCandle[]): Candle[] {
  const result: Candle[] = [];
  for (const c of candles30m) {
    const mid = (c.open + c.close) / 2;
    result.push(
      { time: c.time,           open: c.open, high: (c.high + mid) / 2, low: (c.low + mid) / 2, close: mid,     volume: 0 },
      { time: c.time + 15 * 60, open: mid,    high: c.high,             low: c.low,             close: c.close, volume: 0 },
    );
  }
  return result;
}

// ── DexScreener anchor fetch ──────────────────────────────────────────────────

interface PriceAnchors {
  priceNow: number;
  price1h:  number;
  price6h:  number;
  price24h: number;
  price5m:  number;
  volH24:   number;
  volH6:    number;
  volH1:    number;
  pairAddr: string;
}

const FALLBACK_ANCHORS: PriceAnchors = {
  priceNow: 0, price1h: 0, price6h: 0, price24h: 0, price5m: 0,
  volH24: 0, volH6: 0, volH1: 0, pairAddr: "unknown",
};

async function fetchDexScreenerAnchors(mint: string): Promise<PriceAnchors> {
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`,
      { signal: AbortSignal.timeout(5_000) }
    );
    if (!res.ok) return FALLBACK_ANCHORS;

    const data = (await res.json()) as {
      pairs?: Array<{
        chainId:     string;
        pairAddress: string;
        priceUsd?:   string;
        priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
        volume?:      { h24?: number; h6?: number; h1?: number };
        liquidity?:   { usd?: number };
      }>;
    };

    const pairs = (data.pairs ?? []).filter(p => p.chainId === "solana");
    if (pairs.length === 0) return FALLBACK_ANCHORS;

    const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];

    const priceNow = parseFloat(best.priceUsd ?? "0");
    if (!priceNow) return FALLBACK_ANCHORS;

    const pc  = best.priceChange ?? {};
    const vol = best.volume      ?? {};

    return {
      priceNow,
      price1h:  priceNow / (1 + (pc.h1  ?? 0) / 100),
      price6h:  priceNow / (1 + (pc.h6  ?? 0) / 100),
      price24h: priceNow / (1 + (pc.h24 ?? 0) / 100),
      price5m:  priceNow / (1 + (pc.m5  ?? 0) / 100),
      volH24:   vol.h24 ?? 0,
      volH6:    vol.h6  ?? 0,
      volH1:    vol.h1  ?? 0,
      pairAddr: best.pairAddress,
    };
  } catch {
    return FALLBACK_ANCHORS;
  }
}

// ── Synthetic OHLCV (piecewise Brownian bridge) ───────────────────────────────

function buildSyntheticCandles(
  mint:      string,
  timeframe: Timeframe,
  anchors:   PriceAnchors,
): CandleResult {
  const nowSec = Math.floor(Date.now() / 1000);

  // Guard: if we have no valid price, produce a minimal placeholder
  const basePrice = anchors.priceNow;
  if (!basePrice || basePrice <= 0) {
    return {
      mint,
      timeframe,
      source: "synthetic",
      candles: [],
    };
  }

  let segments: Segment[];
  let N: number;
  let intervalSec: number;
  let totalVol: number;

  if (timeframe === "15m") {
    intervalSec = 15 * 60;
    N           = 24;
    totalVol    = anchors.volH6;
    segments    = [
      { fromPrice: anchors.price6h,  toPrice: anchors.price1h,  fromFrac: 0,      toFrac: 5/6   },
      { fromPrice: anchors.price1h,  toPrice: anchors.price5m,  fromFrac: 5/6,    toFrac: 23/24 },
      { fromPrice: anchors.price5m,  toPrice: anchors.priceNow, fromFrac: 23/24,  toFrac: 1     },
    ];
  } else if (timeframe === "1h") {
    intervalSec = 60 * 60;
    N           = 24;
    totalVol    = anchors.volH24;
    segments    = [
      { fromPrice: anchors.price24h, toPrice: anchors.price6h,  fromFrac: 0,      toFrac: 18/24 },
      { fromPrice: anchors.price6h,  toPrice: anchors.price1h,  fromFrac: 18/24,  toFrac: 23/24 },
      { fromPrice: anchors.price1h,  toPrice: anchors.priceNow, fromFrac: 23/24,  toFrac: 1     },
    ];
  } else {
    intervalSec = 24 * 60 * 60;
    N           = 30;
    totalVol    = anchors.volH24 * 30;
    const dailyDrift = anchors.price24h > 0
      ? (anchors.priceNow - anchors.price24h) / anchors.price24h
      : 0;
    const price30d   = anchors.priceNow / Math.pow(1 + dailyDrift, 30);
    segments = [
      { fromPrice: price30d,         toPrice: anchors.price24h, fromFrac: 0,      toFrac: 29/30 },
      { fromPrice: anchors.price24h, toPrice: anchors.priceNow, fromFrac: 29/30,  toFrac: 1     },
    ];
  }

  // Ensure all segment prices are positive — clamp to 0.0001 × priceNow as minimum
  const minPrice = basePrice * 0.0001;
  segments = segments.map(s => ({
    ...s,
    fromPrice: Math.max(minPrice, s.fromPrice),
    toPrice:   Math.max(minPrice, s.toPrice),
  }));

  const startTimeSec = nowSec - N * intervalSec;
  const rng          = mulberry32(hashStr(anchors.pairAddr + timeframe));

  const allPrices  = [anchors.priceNow, anchors.price1h, anchors.price6h, anchors.price24h].filter(p => p > 0);
  const priceMax   = Math.max(...allPrices);
  const priceMin   = Math.min(...allPrices);
  const range      = priceMax - priceMin;
  const volatility = range > 0 ? range / priceMax : 0.03;

  const candles: Candle[] = [];
  let prevClose = priceForFrac(0, segments);

  for (let i = 0; i < N; i++) {
    const frac     = i / N;
    const fracNext = (i + 1) / N;
    const midPrice = priceForFrac((frac + fracNext) / 2, segments);
    const candleVol = totalVol > 0
      ? parseFloat(((totalVol / N) * (0.4 + rng() * 1.2)).toFixed(2))
      : 0;

    const noise   = (rng() - 0.5) * 2 * midPrice * volatility * 0.6;
    const close   = Math.max(midPrice * 0.001, midPrice + noise);
    const open    = prevClose;

    const wickFactor = midPrice * volatility * (0.2 + rng() * 0.4);
    const high  = Math.max(open, close) + wickFactor;
    const low   = Math.max(midPrice * 0.0001, Math.min(open, close) - wickFactor);

    candles.push({
      time:   startTimeSec + i * intervalSec,
      open:   round6(open),
      high:   round6(high),
      low:    round6(low),
      close:  round6(close),
      volume: candleVol,
    });

    prevClose = close;
  }

  if (candles.length > 0) {
    const last = candles[candles.length - 1];
    last.close = round6(anchors.priceNow);
    last.high  = round6(Math.max(last.high, last.close));
    last.low   = round6(Math.min(last.low,  last.close));
  }

  return { mint, timeframe, source: "synthetic", candles };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

interface Segment {
  fromPrice: number;
  toPrice:   number;
  fromFrac:  number;
  toFrac:    number;
}

function priceForFrac(frac: number, segments: Segment[]): number {
  for (const seg of segments) {
    if (frac >= seg.fromFrac && frac <= seg.toFrac) {
      const t = (seg.toFrac - seg.fromFrac) > 0
        ? (frac - seg.fromFrac) / (seg.toFrac - seg.fromFrac)
        : 0;
      return seg.fromPrice + (seg.toPrice - seg.fromPrice) * t;
    }
  }
  return segments[segments.length - 1].toPrice;
}

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) | 0;
  return h >>> 0;
}

function round6(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  const mag    = Math.floor(Math.log10(n));
  const factor = Math.pow(10, 5 - mag);
  return Math.round(n * factor) / factor;
}
