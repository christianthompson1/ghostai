/**
 * Ghost AI external backend (Replit / local engine) + public helpers.
 * All requests are wrapped in try/catch and return null (or throw a friendly
 * message) instead of crashing the UI. The chart & audit widgets show a
 * glass shimmer while these promises resolve.
 */
import { API, BACKEND_URL } from "./api";

/** Absolute backend engine origin (from `VITE_BACKEND_URL`). */
export const GHOST_BACKEND = BACKEND_URL;

const DEXSCREENER = "https://api.dexscreener.com";

/** POST /api/debug-transaction */
export async function decodeTransaction(input: string): Promise<any> {
  const json = await API.decodeTransaction(input);
  if (!json) throw new Error("Could not reach the ledger stream. Try again.");
  return json;
}

/** GET /api/token-metrics?mint=... */
export async function fetchTokenMetrics(mint: string): Promise<{
  mint: string;
  symbol?: string;
  name?: string;
  priceUsd?: number;
  totalSupply?: number | null;
  liquidityUsd?: number;
  fdv?: number;
  pairAddress?: string;
  dex?: string;
  pairCreatedAt?: number | null;
} | null> {
  return API.getTokenMetrics(mint);
}

export type ResolvedTicker = {
  address: string;
  symbol?: string;
  name?: string;
  image?: string;
  priceUsd?: number;
  change24h?: number;
  liquidityUsd?: number;
  fdv?: number;
  volume24h?: number;
  pairAddress?: string;
  dex?: string;
};

/**
 * Resolve a bare ticker (e.g. "FART", "$BONK") to a Solana mint. Tries the
 * backend market search first, then falls back to the public DexScreener
 * search endpoint.
 */
export async function resolveTicker(query: string): Promise<ResolvedTicker | null> {
  const q = query.trim().replace(/^\$/, "");
  if (!q) return null;

  const backend = await API.searchMarkets(q);
  const rows: any[] = Array.isArray(backend)
    ? backend
    : (backend?.markets ?? backend?.results ?? backend?.data ?? []);
  const hit = rows.find((r) => r?.mint ?? r?.address);
  if (hit) {
    return {
      address: String(hit.mint ?? hit.address),
      symbol: hit.symbol,
      name: hit.name,
      image: hit.image ?? hit.imageUrl ?? hit.logoURI,
      priceUsd: Number(hit.priceUsd ?? hit.price) || undefined,
      change24h: Number(hit.change24h ?? hit.priceChange24h) || 0,
      liquidityUsd: Number(hit.liquidityUsd ?? hit.liquidity) || undefined,
      fdv: Number(hit.fdv ?? hit.marketCap) || undefined,
      volume24h: Number(hit.volume24h ?? hit.volume) || undefined,
      pairAddress: hit.pairAddress,
      dex: hit.dex ?? hit.source,
    };
  }

  try {
    const res = await fetch(`${DEXSCREENER}/latest/dex/search?q=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];
    const solPairs = pairs.filter((p) => p?.chainId === "solana" && p?.baseToken?.address);
    if (!solPairs.length) return null;
    const upper = q.toUpperCase();
    solPairs.sort((a, b) => {
      const am = a.baseToken?.symbol?.toUpperCase() === upper ? 1 : 0;
      const bm = b.baseToken?.symbol?.toUpperCase() === upper ? 1 : 0;
      if (am !== bm) return bm - am;
      return (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0);
    });
    const p = solPairs[0];
    return {
      address: p.baseToken.address,
      symbol: p.baseToken.symbol,
      name: p.baseToken.name,
      image: p.info?.imageUrl,
      priceUsd: Number(p.priceUsd) || undefined,
      change24h: p.priceChange?.h24,
      liquidityUsd: p.liquidity?.usd,
      fdv: p.fdv,
      volume24h: p.volume?.h24,
      pairAddress: p.pairAddress,
      dex: p.dexId,
    };
  } catch {
    return null;
  }
}

export type OhlcvPoint = { t: number; o: number; h: number; l: number; c: number; v: number };

/** UI timeframe → backend `/api/v1/charts/ohlcv` timeframe. */
const TF_MAP: Record<string, { tf: string; limit: number }> = {
  "1m": { tf: "1m", limit: 60 },
  "5m": { tf: "5m", limit: 72 },
  "1h": { tf: "1h", limit: 48 },
  "1D": { tf: "1h", limit: 24 },
  "7D": { tf: "4h", limit: 42 },
  "1M": { tf: "1d", limit: 30 },
};

/** GET /api/v1/charts/ohlcv — normalised to oldest → newest. */
export async function fetchOhlcv(symbol: string, timeframe: string): Promise<OhlcvPoint[]> {
  const cfg = TF_MAP[timeframe] ?? TF_MAP["1D"];
  const json = await API.getOhlcv(symbol, cfg.tf, cfg.limit);
  const list: any[] = Array.isArray(json)
    ? json
    : (json?.candles ?? json?.data ?? json?.ohlcv ?? []);
  return list
    .map((r: any) => {
      if (Array.isArray(r)) {
        const t = Number(r[0]);
        return { t: t < 1e12 ? t * 1000 : t, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] || 0 };
      }
      const t = Number(r.time ?? r.t ?? r.timestamp ?? 0);
      return {
        t: t < 1e12 ? t * 1000 : t,
        o: Number(r.open ?? r.o) || 0,
        h: Number(r.high ?? r.h) || 0,
        l: Number(r.low ?? r.l) || 0,
        c: Number(r.close ?? r.c) || 0,
        v: Number(r.volume ?? r.v) || 0,
      };
    })
    .filter((p) => Number.isFinite(p.c) && p.c > 0)
    .sort((a, b) => a.t - b.t);
}

// ── Demo (paper) trading ──────────────────────────────────────────────────────
export type DemoAccount = {
  userId: string;
  balanceUsd: number;
  portfolio: Record<string, number>;
  trades: Array<{
    id: string; action: "buy" | "sell"; mint: string; symbol: string;
    amount: number; priceUsd: number; totalUsd: number; timestamp: string;
  }>;
  createdAt?: string;
};

export async function initDemoAccount(userId?: string): Promise<DemoAccount> {
  const json = await (async () => {
    try {
      const res = await fetch(`${GHOST_BACKEND}/api/demo/initialize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(userId ? { userId } : {}),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  })();

  return {
    userId: json?.userId ?? userId ?? Math.random().toString(36).slice(2, 10),
    balanceUsd: Number(json?.balanceUsd ?? 1000),
    portfolio: json?.portfolio ?? {},
    trades: json?.trades ?? [],
    createdAt: json?.createdAt ?? new Date().toISOString(),
  };
}

export async function submitDemoTrade(
  account: DemoAccount,
  input: { action: "buy" | "sell"; mint: string; symbol: string; amount: number; priceUsd: number },
): Promise<{ ok: boolean; error?: string; account: DemoAccount }> {
  try {
    const res = await fetch(`${GHOST_BACKEND}/api/demo/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ userId: account.userId, ...input }),
    });
    const json = await res.json().catch(() => ({} as any));
    if (!res.ok) return { ok: false, error: json?.error ?? `Trade rejected (${res.status})`, account };

    const src = json.account ?? json;
    return {
      ok: true,
      account: {
        ...account,
        balanceUsd: Number(src.balanceUsd ?? account.balanceUsd),
        portfolio: src.portfolio ?? account.portfolio,
        trades: src.trades ?? account.trades,
      },
    };
  } catch {
    return { ok: false, error: "Trading engine unreachable. Try again.", account };
  }
}
