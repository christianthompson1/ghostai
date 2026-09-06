/**
 * Live market directory and venue-depth summaries.
 *
 * The frontend talks to these routes instead of calling market providers
 * directly. DexScreener remains the upstream source for current Solana pairs.
 */
import { Router, type Request, type Response } from "express";

export const marketsRouter = Router();

const DEXSCREENER = "https://api.dexscreener.com";
const FETCH_TIMEOUT_MS = 6_000;

type DexPair = {
  chainId?: string;
  pairAddress?: string;
  dexId?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  txns?: { h24?: { buys?: number; sells?: number } };
  info?: { imageUrl?: string };
};

async function getPairs(mints: string[]): Promise<DexPair[]> {
  const clean = [...new Set(mints.map((mint) => mint.trim()).filter(Boolean))].slice(0, 100);
  if (!clean.length) return [];
  const response = await fetch(
    `${DEXSCREENER}/latest/dex/tokens/${clean.map(encodeURIComponent).join(",")}`,
    { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`Market provider returned ${response.status}`);
  const json = (await response.json()) as { pairs?: DexPair[] };
  return (json.pairs ?? []).filter((pair) => pair.chainId === "solana" && pair.baseToken?.address);
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bestPairs(pairs: DexPair[]): DexPair[] {
  const best = new Map<string, DexPair>();
  for (const pair of pairs) {
    const mint = pair.baseToken?.address;
    if (!mint) continue;
    const current = best.get(mint);
    if (!current || numeric(pair.liquidity?.usd) > numeric(current.liquidity?.usd)) {
      best.set(mint, pair);
    }
  }
  return [...best.values()];
}

function marketRows(pairs: DexPair[]) {
  return pairs.map((pair) => ({
    mint: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol,
    name: pair.baseToken?.name,
    priceUsd: numeric(pair.priceUsd),
    change24h: numeric(pair.priceChange?.h24),
    volume24h: numeric(pair.volume?.h24),
    liquidityUsd: numeric(pair.liquidity?.usd),
    venue: pair.dexId ?? "DEX",
    image: pair.info?.imageUrl,
  }));
}

// GET /api/v1/markets?mints=<comma-separated Solana mints>
marketsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.mints === "string" ? req.query.mints : "";
    const pairs = bestPairs(await getPairs(raw.split(",")));
    res.json({
      timestamp: new Date().toISOString(),
      markets: marketRows(pairs),
    });
  } catch {
    res.status(502).json({ error: "Live market data is temporarily unavailable" });
  }
});

// GET /api/v1/markets/stream?mints=<comma-separated Solana mints>
// Sends a fresh backend snapshot as soon as the upstream market poll changes.
marketsRouter.get("/stream", async (req: Request, res: Response) => {
  const raw = typeof req.query.mints === "string" ? req.query.mints : "";
  const mints = raw.split(",").map((mint) => mint.trim()).filter(Boolean).slice(0, 100);
  if (!mints.length) {
    res.status(400).json({ error: "At least one mint is required" });
    return;
  }

  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  let closed = false;
  let previous = "";
  const sendSnapshot = async () => {
    try {
      const rows = marketRows(bestPairs(await getPairs(mints)));
      const snapshot = JSON.stringify(rows);
      if (snapshot === previous) return;
      previous = snapshot;
      res.write(`event: market_update\ndata: ${JSON.stringify({
        type: "market_update",
        timestamp: new Date().toISOString(),
        markets: rows,
      })}\n\n`);
    } catch {
      if (!closed) res.write(`event: market_error\ndata: ${JSON.stringify({ message: "Market stream temporarily unavailable" })}\n\n`);
    }
  };

  await sendSnapshot();
  const timer = setInterval(() => { void sendSnapshot(); }, 4_000);
  const heartbeat = setInterval(() => { if (!closed) res.write(": keep-alive\n\n"); }, 15_000);
  req.on("close", () => {
    closed = true;
    clearInterval(timer);
    clearInterval(heartbeat);
  });
});

// GET /api/v1/markets/:mint/orderbook
// DexScreener exposes venue depth and executed trade flow rather than a
// consolidated limit-order book. The response keeps those live venue-level
// measures explicit so the UI never presents invented bid/ask values.
marketsRouter.get("/:mint/orderbook", async (req: Request, res: Response) => {
  try {
    const mint = String(req.params.mint ?? "").trim();
    if (!mint) {
      res.status(400).json({ error: "Mint address is required" });
      return;
    }
    const pairs = (await getPairs([mint])).sort(
      (a, b) => numeric(b.liquidity?.usd) - numeric(a.liquidity?.usd),
    );
    if (!pairs.length) {
      res.status(404).json({ error: "No live venues found for this market" });
      return;
    }

    const liquidityTotal = pairs.reduce((sum, pair) => sum + numeric(pair.liquidity?.usd), 0);
    const best = pairs[0];
    const quotes = pairs.map((pair) => numeric(pair.priceUsd)).filter((price) => price > 0);
    const bestBid = Math.max(...quotes);
    const bestAsk = Math.min(...quotes);
    const bidDepthUsd = pairs.reduce((sum, pair) => {
      const buys = numeric(pair.txns?.h24?.buys);
      const sells = numeric(pair.txns?.h24?.sells);
      const total = buys + sells;
      return sum + numeric(pair.liquidity?.usd) * (total ? buys / total : 0.5);
    }, 0);
    const askDepthUsd = pairs.reduce((sum, pair) => {
      const buys = numeric(pair.txns?.h24?.buys);
      const sells = numeric(pair.txns?.h24?.sells);
      const total = buys + sells;
      return sum + numeric(pair.liquidity?.usd) * (total ? sells / total : 0.5);
    }, 0);
    res.json({
      mint,
      timestamp: new Date().toISOString(),
      priceUsd: numeric(best.priceUsd),
      change24h: numeric(best.priceChange?.h24),
      liquidityUsd: liquidityTotal,
      venueCount: pairs.length,
      bestBid,
      bestAsk,
      bidDepthUsd,
      askDepthUsd,
      venues: pairs.slice(0, 8).map((pair) => {
        const buys = numeric(pair.txns?.h24?.buys);
        const sells = numeric(pair.txns?.h24?.sells);
        const total = buys + sells;
        return {
          venue: pair.dexId ?? "DEX",
          pairAddress: pair.pairAddress,
          priceUsd: numeric(pair.priceUsd),
          liquidityUsd: numeric(pair.liquidity?.usd),
          volume24h: numeric(pair.volume?.h24),
          buys24h: buys,
          sells24h: sells,
          buyPressurePct: total ? (buys / total) * 100 : null,
          liquiditySharePct: liquidityTotal
            ? (numeric(pair.liquidity?.usd) / liquidityTotal) * 100
            : null,
        };
      }),
    });
  } catch {
    res.status(502).json({ error: "Live venue depth is temporarily unavailable" });
  }
});