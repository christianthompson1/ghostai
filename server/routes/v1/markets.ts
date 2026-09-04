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

// GET /api/v1/markets?mints=<comma-separated Solana mints>
marketsRouter.get("/", async (req: Request, res: Response) => {
  try {
    const raw = typeof req.query.mints === "string" ? req.query.mints : "";
    const pairs = bestPairs(await getPairs(raw.split(",")));
    res.json({
      timestamp: new Date().toISOString(),
      markets: pairs.map((pair) => ({
        mint: pair.baseToken?.address,
        symbol: pair.baseToken?.symbol,
        name: pair.baseToken?.name,
        priceUsd: numeric(pair.priceUsd),
        change24h: numeric(pair.priceChange?.h24),
        volume24h: numeric(pair.volume?.h24),
        liquidityUsd: numeric(pair.liquidity?.usd),
        venue: pair.dexId ?? "DEX",
        image: pair.info?.imageUrl,
      })),
    });
  } catch {
    res.status(502).json({ error: "Live market data is temporarily unavailable" });
  }
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
    res.json({
      mint,
      timestamp: new Date().toISOString(),
      priceUsd: numeric(best.priceUsd),
      change24h: numeric(best.priceChange?.h24),
      liquidityUsd: liquidityTotal,
      venueCount: pairs.length,
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