/**
 * Persistent paper-trading store.
 *
 * All open positions, entry prices, trade history and cash are written to
 * localStorage on every mutation, so nothing resets when the user navigates
 * between tabs or refreshes the browser. When the user is signed in the
 * portfolio is mirrored to the backend engine (best-effort, never blocking).
 */
import { apiGet, apiPost, backendUrl } from "./api";
import { TOP_SOLANA_TOKENS } from "./market-data";

const KEY = "ghost.paper.v1";
export const START_CASH = 1000;

export type PaperTrade = {
  id: string;
  action: "buy" | "sell";
  mint: string;
  symbol: string;
  amount: number;
  priceUsd: number;
  totalUsd: number;
  timestamp: string;
};

export type PaperPosition = {
  mint: string;
  symbol: string;
  amount: number;
  avgCost: number;
};

export type PaperState = {
  userId: string;
  cash: number;
  realizedPnl: number;
  positions: Record<string, PaperPosition>;
  trades: PaperTrade[];
  updatedAt: string;
};

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function emptyState(userId?: string): PaperState {
  return {
    userId: userId ?? newId(),
    cash: START_CASH,
    realizedPnl: 0,
    positions: {},
    trades: [],
    updatedAt: new Date().toISOString(),
  };
}

export function loadState(): PaperState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as PaperState;
    if (!parsed || typeof parsed.cash !== "number") return emptyState();
    return {
      ...emptyState(parsed.userId),
      ...parsed,
      positions: parsed.positions ?? {},
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
    };
  } catch {
    return emptyState();
  }
}

export function saveState(state: PaperState): PaperState {
  const next = { ...state, updatedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode — in-memory state still works */
  }
  return next;
}

/** Pure trade reducer — returns an error string instead of throwing. */
export function applyTrade(
  state: PaperState,
  input: { action: "buy" | "sell"; mint: string; symbol: string; amount: number; priceUsd: number },
): { ok: boolean; error?: string; state: PaperState } {
  const { action, mint, amount, priceUsd } = input;
  if (!mint || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Enter a valid amount", state };
  }
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    return { ok: false, error: "Live price unavailable for this market", state };
  }

  const totalUsd = +(amount * priceUsd).toFixed(6);
  const positions = { ...state.positions };
  const held = positions[mint];
  let cash = state.cash;
  let realizedPnl = state.realizedPnl;

  if (action === "buy") {
    if (cash < totalUsd) return { ok: false, error: "Insufficient demo cash", state };
    cash = +(cash - totalUsd).toFixed(6);
    const prevAmount = held?.amount ?? 0;
    const prevCost = (held?.avgCost ?? 0) * prevAmount;
    const nextAmount = +(prevAmount + amount).toFixed(9);
    positions[mint] = {
      mint,
      symbol: input.symbol.toUpperCase(),
      amount: nextAmount,
      avgCost: nextAmount ? +((prevCost + totalUsd) / nextAmount).toFixed(10) : priceUsd,
    };
  } else {
    if (!held || held.amount < amount) {
      return { ok: false, error: "Insufficient token holdings to sell", state };
    }
    cash = +(cash + totalUsd).toFixed(6);
    realizedPnl = +(realizedPnl + (priceUsd - held.avgCost) * amount).toFixed(6);
    const remaining = +(held.amount - amount).toFixed(9);
    if (remaining <= 0) delete positions[mint];
    else positions[mint] = { ...held, amount: remaining };
  }

  const trade: PaperTrade = {
    id: newId(),
    action,
    mint,
    symbol: input.symbol.toUpperCase(),
    amount,
    priceUsd,
    totalUsd,
    timestamp: new Date().toISOString(),
  };

  return {
    ok: true,
    state: { ...state, cash, realizedPnl, positions, trades: [trade, ...state.trades].slice(0, 200) },
  };
}

/** Best-effort backend mirror so signed-in users keep a server copy. */
export function syncTradeToBackend(
  state: PaperState,
  input: { action: "buy" | "sell"; mint: string; symbol: string; amount: number; priceUsd: number },
): void {
  void apiPost("/api/demo/trade", { userId: state.userId, ...input });
}

// ── Live markets ─────────────────────────────────────────────────────────────
export type MarketRow = {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  liquidityUsd: number;
  venue: string;
  image?: string;
};

function coerceMarket(r: any): MarketRow | null {
  const mint = r?.mint ?? r?.address ?? r?.tokenAddress ?? r?.id;
  const price = Number(r?.priceUsd ?? r?.price ?? r?.last ?? 0);
  if (!mint) return null;
  return {
    mint: String(mint),
    symbol: String(r?.symbol ?? r?.base ?? "—").toUpperCase(),
    name: String(r?.name ?? r?.pair ?? r?.symbol ?? ""),
    priceUsd: Number.isFinite(price) ? price : 0,
    change24h: Number(r?.change24h ?? r?.priceChange24h ?? r?.change ?? 0) || 0,
    volume24h: Number(r?.volume24h ?? r?.volume ?? 0) || 0,
    liquidityUsd: Number(r?.liquidityUsd ?? r?.liquidity ?? 0) || 0,
    venue: String(r?.venue ?? r?.exchange ?? r?.dex ?? "DEX").toUpperCase(),
    image: r?.image ?? r?.imageUrl ?? r?.logo ?? undefined,
  };
}

/** GET /api/v1/markets — live CEX + DEX ticker feed. */
export async function fetchMarkets(): Promise<MarketRow[]> {
  const mints = TOP_SOLANA_TOKENS.map((token) => token.mint).join(",");
  const json = await apiGet<any>(`/api/v1/markets?mints=${encodeURIComponent(mints)}`);
  const list: any[] = Array.isArray(json)
    ? json
    : Array.isArray(json?.markets)
      ? json.markets
      : Array.isArray(json?.data)
        ? json.data
        : [];
  return list.map(coerceMarket).filter((r): r is MarketRow => !!r && r.priceUsd > 0);
}

export type VenueDepth = {
  venue: string;
  pairAddress?: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  buys24h: number;
  sells24h: number;
  buyPressurePct: number | null;
  liquiditySharePct: number | null;
};

export type MarketOrderBook = {
  mint: string;
  timestamp: string;
  priceUsd: number;
  change24h: number;
  liquidityUsd: number;
  venueCount: number;
  bestBid: number;
  bestAsk: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  venues: VenueDepth[];
};

export type MarketStreamEvent = {
  type: "market_update";
  timestamp: string;
  markets: MarketRow[];
};

/** GET /api/v1/markets/:mint/orderbook — live venue depth and trade flow. */
export async function fetchMarketOrderBook(mint: string): Promise<MarketOrderBook | null> {
  return apiGet<MarketOrderBook>(`/api/v1/markets/${encodeURIComponent(mint)}/orderbook`);
}

export function marketStreamUrl(mints: string[]): string {
  return backendUrl(`/api/v1/markets/stream?mints=${encodeURIComponent(mints.join(","))}`);
}

/** DexScreener search fallback so the drawer always finds a market. */
export async function searchMarkets(query: string): Promise<MarketRow[]> {
  const q = query.trim().replace(/^\$/, "");
  if (!q) return [];
  try {
    const res = await fetch(
      `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];
    const best = new Map<string, MarketRow>();
    for (const p of pairs) {
      if (p?.chainId !== "solana" || !p?.baseToken?.address) continue;
      const row: MarketRow = {
        mint: p.baseToken.address,
        symbol: String(p.baseToken.symbol ?? "—").toUpperCase(),
        name: p.baseToken.name ?? "",
        priceUsd: Number(p.priceUsd) || 0,
        change24h: Number(p.priceChange?.h24) || 0,
        volume24h: Number(p.volume?.h24) || 0,
        liquidityUsd: Number(p.liquidity?.usd) || 0,
        venue: String(p.dexId ?? "DEX").toUpperCase(),
        image: p.info?.imageUrl,
      };
      const prev = best.get(row.mint);
      if (!prev || row.liquidityUsd > prev.liquidityUsd) best.set(row.mint, row);
    }
    return [...best.values()].sort((a, b) => b.liquidityUsd - a.liquidityUsd).slice(0, 40);
  } catch {
    return [];
  }
}

/** Refresh live prices for a set of mints straight from DexScreener. */
export async function fetchPricesForMints(mints: string[]): Promise<Record<string, number>> {
  if (!mints.length) return {};
  const out: Record<string, number> = {};
  const chunks: string[][] = [];
  for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`,
          { headers: { Accept: "application/json" } },
        );
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];
        const liq: Record<string, number> = {};
        for (const p of pairs) {
          const mint = p?.baseToken?.address;
          if (!mint) continue;
          const l = Number(p?.liquidity?.usd) || 0;
          if (l >= (liq[mint] ?? -1)) {
            liq[mint] = l;
            out[mint] = Number(p.priceUsd) || out[mint] || 0;
          }
        }
      } catch {
        /* partial results are fine */
      }
    }),
  );
  return out;
}
