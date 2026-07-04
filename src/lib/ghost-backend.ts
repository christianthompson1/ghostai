/**
 * Ghost AI external backend (Replit) + public market data helpers.
 * All requests are wrapped in try/catch and return null (or throw a friendly
 * message) instead of crashing the UI. The chart & audit widgets show a
 * glass shimmer while these promises resolve.
 */
export const GHOST_BACKEND =
  "https://53f91562-532a-4457-b69f-e770ae7cc385-00-1odxz0gc2gyuo.janeway.replit.dev";

const DEXSCREENER = "https://api.dexscreener.com";
const GECKOTERMINAL = "https://api.geckoterminal.com/api/v2";

/** POST /api/debug-transaction */
export async function decodeTransaction(input: string): Promise<any> {
  try {
    const res = await fetch(`${GHOST_BACKEND}/api/debug-transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ input }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? `Backend error ${res.status}`);
    return json;
  } catch (e: any) {
    throw new Error(e?.message ?? "Could not reach the ledger stream. Try again.");
  }
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
  try {
    const res = await fetch(
      `${GHOST_BACKEND}/api/token-metrics?mint=${encodeURIComponent(mint)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
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
 * Resolve a bare ticker (e.g. "FART", "$BONK", "FLAG") to a Solana mint by
 * picking the most-liquid pair from the free DexScreener search endpoint.
 * Returns null if no Solana pair exists.
 */
export async function resolveTicker(query: string): Promise<ResolvedTicker | null> {
  const q = query.trim().replace(/^\$/, "");
  if (!q) return null;
  try {
    const res = await fetch(`${DEXSCREENER}/latest/dex/search?q=${encodeURIComponent(q)}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];
    const solPairs = pairs.filter((p) => p?.chainId === "solana" && p?.baseToken?.address);
    if (!solPairs.length) return null;
    // Prefer the pair whose base symbol matches the ticker, then most-liquid.
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

const TF_MAP: Record<string, { path: string; aggregate: number; limit: number }> = {
  "1m":  { path: "minute", aggregate: 1,  limit: 60 },
  "5m":  { path: "minute", aggregate: 5,  limit: 72 },
  "1h":  { path: "hour",   aggregate: 1,  limit: 48 },
  "1D":  { path: "hour",   aggregate: 1,  limit: 24 },
  "7D":  { path: "hour",   aggregate: 4,  limit: 42 },
  "1M":  { path: "day",    aggregate: 1,  limit: 30 },
};

/**
 * GeckoTerminal OHLCV — free, no key. Requires a Solana pool address (the
 * DexScreener `pairAddress` works). Returns oldest → newest.
 */
export async function fetchOhlcv(poolAddress: string, timeframe: string): Promise<OhlcvPoint[]> {
  const cfg = TF_MAP[timeframe] ?? TF_MAP["1D"];
  try {
    const url = `${GECKOTERMINAL}/networks/solana/pools/${poolAddress}/ohlcv/${cfg.path}?aggregate=${cfg.aggregate}&limit=${cfg.limit}&currency=usd`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const list: any[] = json?.data?.attributes?.ohlcv_list ?? [];
    // Each row: [timestamp, open, high, low, close, volume] — newest first.
    return list
      .map((r) => ({ t: Number(r[0]) * 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
      .filter((p) => Number.isFinite(p.c))
      .sort((a, b) => a.t - b.t);
  } catch {
    return [];
  }
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
  try {
    const res = await fetch(`${GHOST_BACKEND}/api/demo/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(userId ? { userId } : {}),
    });
    if (!res.ok) throw new Error(`Backend ${res.status}`);
    return await res.json();
  } catch {
    // Local fallback so the demo UI always renders.
    return {
      userId: userId ?? Math.random().toString(36).slice(2, 10),
      balanceUsd: 1000,
      portfolio: {},
      trades: [],
      createdAt: new Date().toISOString(),
    };
  }
}

export async function submitDemoTrade(input: {
  userId: string; action: "buy" | "sell"; mint: string;
  symbol: string; amount: number; priceUsd: number;
}): Promise<{ ok: boolean; error?: string; account?: any; trade?: any }> {
  try {
    const res = await fetch(`${GHOST_BACKEND}/api/demo/trade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json?.error ?? `Backend ${res.status}` };
    return { ok: true, ...json };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Network unreachable" };
  }
}

