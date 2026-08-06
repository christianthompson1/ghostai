/**
 * Market-data helpers — every call routes through the Ghost AI backend
 * (`VITE_BACKEND_URL`). No hardcoded token lists, no direct DEX aggregator
 * calls from the browser.
 */
import { API } from "./api";

export type LiveTokenRow = {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change24h: number;
  liquidityUsd: number;
  volume24h: number;
  image?: string;
  pairAddress?: string;
  source?: string;
};

function coerceMarket(m: any): LiveTokenRow | null {
  const mint = m?.mint ?? m?.address ?? m?.tokenAddress;
  if (!mint) return null;
  return {
    mint: String(mint),
    symbol: String(m.symbol ?? "").toUpperCase() || String(mint).slice(0, 4),
    name: String(m.name ?? m.symbol ?? ""),
    priceUsd: Number(m.priceUsd ?? m.price) || 0,
    change24h: Number(m.change24h ?? m.priceChange24h ?? m.change) || 0,
    liquidityUsd: Number(m.liquidityUsd ?? m.liquidity) || 0,
    volume24h: Number(m.volume24h ?? m.volume) || 0,
    image: m.image ?? m.imageUrl ?? m.logoURI ?? undefined,
    pairAddress: m.pairAddress ?? undefined,
    source: m.source ?? undefined,
  };
}

function readMarkets(json: any): LiveTokenRow[] {
  const list: any[] = Array.isArray(json)
    ? json
    : (json?.markets ?? json?.tokens ?? json?.data ?? []);
  return list.map(coerceMarket).filter((r): r is LiveTokenRow => !!r);
}

/** GET /api/v1/markets — the live tradable universe. */
export async function fetchLivePrices(): Promise<LiveTokenRow[]> {
  const rows = readMarkets(await API.getMarkets());
  rows.sort((a, b) => b.volume24h - a.volume24h);
  return rows;
}

/** Only DEX-sourced markets (`source === "dex"`), most-liquid first. */
export async function fetchDexMarkets(): Promise<LiveTokenRow[]> {
  const rows = await fetchLivePrices();
  const dex = rows.filter((r) => (r.source ?? "dex").toLowerCase() === "dex");
  return dex.length ? dex : rows;
}

/** GET /api/v1/markets/search?q= */
export async function searchMarkets(q: string): Promise<LiveTokenRow[]> {
  if (!q.trim()) return [];
  return readMarkets(await API.searchMarkets(q.trim()));
}

/** Snapshot for a single mint — used by the chart panel. */
export async function fetchTokenSnapshot(mint: string): Promise<LiveTokenRow | null> {
  const direct = readMarkets(await API.searchMarkets(mint));
  const hit = direct.find((r) => r.mint === mint) ?? direct[0];
  if (hit) return hit;

  const metrics = await API.getTokenMetrics(mint);
  if (!metrics) return null;
  return coerceMarket({ ...metrics, mint });
}

export type PumpTrendingRow = {
  mint: string;
  name: string;
  symbol: string;
  imageUri: string | null;
  marketCapUsd: number;
  progress: number;
  aiSignal?: string | null;
};

/** GET /api/pumpfun/trending */
export async function fetchPumpTrending(): Promise<PumpTrendingRow[]> {
  const json = await API.getPumpTrending();
  const tokens: any[] = Array.isArray(json) ? json : (json?.tokens ?? json?.data ?? []);
  return tokens
    .filter((t) => t?.mint)
    .map((t) => ({
      mint: String(t.mint),
      name: t.name ?? "",
      symbol: t.symbol ?? "",
      imageUri: t.imageUri ?? t.image ?? null,
      marketCapUsd: Number(t.marketCapUsd) || 0,
      progress: Number(t.progress) || 0,
      aiSignal: t.aiSignal ?? null,
    }));
}

// ── Historical candles ───────────────────────────────────────────────────────
export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };
export type CandleTF = "15m" | "1h" | "1d";

export async function fetchCandles(mint: string, timeframe: CandleTF): Promise<Candle[]> {
  const json = await API.getOhlcv(mint, timeframe, 100);
  const rows: any[] = Array.isArray(json) ? json : (json?.candles ?? json?.data ?? []);
  return rows
    .map((r) => {
      const t = Number(r.time ?? r.t ?? r.timestamp) || 0;
      return {
        t: t < 1e12 ? t * 1000 : t,
        o: Number(r.open ?? r.o) || 0,
        h: Number(r.high ?? r.h) || 0,
        l: Number(r.low ?? r.l) || 0,
        c: Number(r.close ?? r.c) || 0,
        v: Number(r.volume ?? r.v) || 0,
      };
    })
    .filter((c) => Number.isFinite(c.c) && c.c > 0)
    .sort((a, b) => a.t - b.t);
}

// ── Live demo account snapshot ───────────────────────────────────────────────
export type DemoAccountSnapshot = {
  userId: string;
  balanceUsd?: number;
  cash?: number;
  positionsUsd?: number;
  totalEquity?: number;
  unrealizedPnl?: number;
  pnlPercent?: number;
  portfolio?: Record<string, number>;
  positions?: Array<{
    mint: string; symbol?: string; amount: number; avgCost?: number;
    livePrice?: number; unrealizedPnl?: number; pnlPercent?: number;
  }>;
};

export async function fetchDemoAccount(userId: string): Promise<DemoAccountSnapshot | null> {
  return apiGetAccount(userId);
}

async function apiGetAccount(userId: string) {
  const { apiGet } = await import("./api");
  return apiGet<DemoAccountSnapshot>(`/api/demo/account?userId=${encodeURIComponent(userId)}`);
}
