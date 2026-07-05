/**
 * Public market-data helpers used by the Demo Trading dashboard.
 *
 *   • fetchLivePrices     – DexScreener /tokens (batched) for our Top 50 list
 *   • fetchTokenSnapshot  – DexScreener /tokens/:addr for a single mint
 *   • fetchPumpTrending   – GET /api/pumpfun/trending on the Replit backend
 */
import { GHOST_BACKEND } from "./ghost-backend";

const DEXSCREENER = "https://api.dexscreener.com";

/** Curated set of high-liquidity Solana tokens (mint addresses). */
export const TOP_SOLANA_TOKENS: Array<{ symbol: string; name: string; mint: string }> = [
  { symbol: "SOL",   name: "Solana",              mint: "So11111111111111111111111111111111111111112" },
  { symbol: "BONK",  name: "Bonk",                mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { symbol: "WIF",   name: "dogwifhat",           mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm" },
  { symbol: "JUP",   name: "Jupiter",             mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
  { symbol: "JTO",   name: "Jito",                mint: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL" },
  { symbol: "PYTH",  name: "Pyth Network",        mint: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3" },
  { symbol: "RAY",   name: "Raydium",             mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R" },
  { symbol: "ORCA",  name: "Orca",                mint: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE" },
  { symbol: "MEW",   name: "cat in a dogs world", mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5" },
  { symbol: "POPCAT",name: "Popcat",              mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr" },
  { symbol: "PENGU", name: "Pudgy Penguins",      mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv" },
  { symbol: "FART",  name: "Fartcoin",            mint: "9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump" },
  { symbol: "AI16Z", name: "ai16z",               mint: "HeLp6NuQkmYB4pYWo2zYs22mESHXPQYzXbB8n4V98jwC" },
  { symbol: "GOAT",  name: "Goatseus Maximus",    mint: "CzLSujWBLFsSjncfkh59rUFqvafWcY5tzedWJSuypump" },
  { symbol: "MOTHER",name: "Mother Iggy",         mint: "3S8qX1MsMqRbiwKg2cQyx7nis1oHMgaCuc9c4VfvVdPN" },
  { symbol: "PNUT",  name: "Peanut the Squirrel", mint: "2qEHjDLDLbuBgRYvsxhc5D6uDWAivNFZGan56P1tpump" },
  { symbol: "MOODENG", name: "Moo Deng",          mint: "ED5nyyWEzpPPiWimP8vYm7sD7TD3LAt3Q3gRTWHzPJBY" },
  { symbol: "RETARDIO", name: "Retardio",         mint: "6ogzHhzdrQr9Pgv6hZ2MNze7UrzBMAFyBBWUYp1Fhitx" },
  { symbol: "MICHI", name: "michi",               mint: "5mbK36SZ7J19An8jFochhQS4of8g6BwUjbeCSxBSoWdp" },
  { symbol: "BOME",  name: "BOOK OF MEME",        mint: "ukHH6c7mMyiWCf1b9pnWe25TSpkDDt3H5pQZgZ74J82" },
  { symbol: "GIGA",  name: "Gigachad",            mint: "63LfDmNb3MQ8mw9MtZ2To9bEA2M71kZUUGq5tiJxcqj9" },
  { symbol: "SLERF", name: "Slerf",               mint: "7BgBvyjrZX1YKz4oh9mjb8ZScatkkwb8DzFx7LoiVkM3" },
  { symbol: "MYRO",  name: "Myro",                mint: "HhJpBhRRn4g56VsyLuT8DL5Bv31HkXqsrahTTUCZeZg4" },
  { symbol: "TRUMP", name: "Official Trump",      mint: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN" },
  { symbol: "MELANIA",name:"Melania Meme",        mint: "FUAfBo2jgks6gB4Z4LfZkqSZgzNucisEHqnNebaRxM1P" },
  { symbol: "ACT",   name: "Act I: The AI Prophecy", mint: "GJAFwWjJ3vnTsrQVabjBVK2TYB1YtRCQXRDfDgUnpump" },
  { symbol: "CHILLGUY", name: "Just a chill guy", mint: "Df6yfrKC8kZE3KNkrHERKzAetSxbrWeniQfyJY4Jpump" },
  { symbol: "FWOG",  name: "Fwog",                mint: "A8C3xuqscfmyLrte3VmTqrAq8kgMASius9AFNANwpump" },
  { symbol: "SIGMA", name: "Sigma",               mint: "5SVG3T9CNQsm2kEwzbRq6hASqh1oGfjqTtLXYUibpump" },
  { symbol: "USA",   name: "American Coin",       mint: "69kdRLyP5DTRkpHraaSZAQbWmAwzF9guKjZfzMXzpump" },
  { symbol: "SC",    name: "Shark Cat",           mint: "8vCAUbxejdtaxn6jnX5uaQTyTZLmXALg9u1bvFCAjtx7" },
  { symbol: "ZEUS",  name: "Zeus Network",        mint: "ZEUS1aR7aX8DFFJf5QjWj2ftDDdNTroMNGo8YoQm3Gq" },
  { symbol: "DRIFT", name: "Drift",               mint: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7" },
  { symbol: "TNSR",  name: "Tensor",              mint: "TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6" },
  { symbol: "W",     name: "Wormhole",            mint: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ" },
  { symbol: "KMNO",  name: "Kamino",              mint: "KMNo3nJsBXfcpJTVhZcXLW7RmTwTt4GVFE7suUBo9sS" },
  { symbol: "RENDER",name: "Render",              mint: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof" },
  { symbol: "HNT",   name: "Helium",              mint: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux" },
  { symbol: "MOBILE",name: "Helium Mobile",       mint: "mb1eu7TzEc71KxDpsmsKoucSSuuoGLv1drys1oP2jh6" },
  { symbol: "IO",    name: "io.net",              mint: "BZLbGTNCSFfoth2GYDtwr7e4imWzpR5jqcUuGEwr646K" },
  { symbol: "GRIFFAIN",name:"griffain.com",       mint: "KENJSUYLASHUMfHyy5o4Hp2FdNqZg1AsUPhfH2kYvEP" },
  { symbol: "ARC",   name: "AI Rig Complex",      mint: "61V8vBaqAGMpgDQi4JcAwo1dmBGHsyhzodcPqnEVpump" },
  { symbol: "ZEREBRO",name:"Zerebro",             mint: "8x5VqbHA8D7NkD52uNuS5nnt3PwA8pLD34ymskeSo2Wn" },
  { symbol: "AVA",   name: "AVA AI",              mint: "DKu9kykSfbN5LBfFXtNNDPaX35o4Fv6vJ9FKk7pZpump" },
  { symbol: "PIPPIN",name: "pippin",              mint: "Dfh5DzRgSvvCFDoYc2ciTkMrbDfRKybA4SoFbPmApump" },
  { symbol: "NEIRO", name: "Neiro on Solana",     mint: "CTg3ZgYx79zrE1MteDVkmkcGniiFrK1hJ6yiabropump" },
  { symbol: "SNAI",  name: "SNAI",                mint: "Hjw6bEcHtbHGpQr8onG3izfJY5DJiWdt7YgkxTdaZLPT" },
  { symbol: "SWARMS",name: "swarms",              mint: "74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump" },
  { symbol: "STONKS",name: "Stonks",              mint: "5voS9evDjxF589WuEub5i4ti7FWQmZUsAvdnrxHopump" },
  { symbol: "SPX",   name: "SPX6900 (Wormhole)",  mint: "J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr" },
  { symbol: "ANALOS",name: "Analos",              mint: "7iT1GRYYhEop2nV1dyCwK2MGyLmPHq47WhPGSwiqcUg5" },
];

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
};

/** Batch DexScreener /tokens (up to 30 mints per request). */
export async function fetchLivePrices(): Promise<LiveTokenRow[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < TOP_SOLANA_TOKENS.length; i += 30) {
    chunks.push(TOP_SOLANA_TOKENS.slice(i, i + 30).map((t) => t.mint));
  }
  const meta = new Map(TOP_SOLANA_TOKENS.map((t) => [t.mint, t]));
  const rows: LiveTokenRow[] = [];

  await Promise.all(
    chunks.map(async (mints) => {
      try {
        const res = await fetch(`${DEXSCREENER}/latest/dex/tokens/${mints.join(",")}`, {
          headers: { Accept: "application/json" },
        });
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];

        // Keep the most-liquid Solana pair per base mint
        const bestByMint = new Map<string, any>();
        for (const p of pairs) {
          if (p?.chainId !== "solana") continue;
          const mint = p?.baseToken?.address;
          if (!mint || !meta.has(mint)) continue;
          const prev = bestByMint.get(mint);
          if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) {
            bestByMint.set(mint, p);
          }
        }
        for (const [mint, p] of bestByMint) {
          const m = meta.get(mint)!;
          rows.push({
            mint,
            symbol: p.baseToken?.symbol ?? m.symbol,
            name: p.baseToken?.name ?? m.name,
            priceUsd: Number(p.priceUsd) || 0,
            change24h: Number(p.priceChange?.h24) || 0,
            liquidityUsd: Number(p.liquidity?.usd) || 0,
            volume24h: Number(p.volume?.h24) || 0,
            image: p.info?.imageUrl,
            pairAddress: p.pairAddress,
          });
        }
      } catch {
        /* soft-fail: partial rows are fine */
      }
    }),
  );

  // Sort by 24h volume descending — most active first
  rows.sort((a, b) => b.volume24h - a.volume24h);
  return rows;
}

/** Snapshot for a single mint — used by the chart panel. */
export async function fetchTokenSnapshot(mint: string): Promise<LiveTokenRow | null> {
  try {
    const res = await fetch(`${DEXSCREENER}/latest/dex/tokens/${mint}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    const pairs: any[] = Array.isArray(json?.pairs) ? json.pairs : [];
    const sol = pairs.filter((p) => p?.chainId === "solana");
    if (!sol.length) return null;
    sol.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const p = sol[0];
    return {
      mint,
      symbol: p.baseToken?.symbol ?? mint.slice(0, 4),
      name: p.baseToken?.name ?? "",
      priceUsd: Number(p.priceUsd) || 0,
      change24h: Number(p.priceChange?.h24) || 0,
      liquidityUsd: Number(p.liquidity?.usd) || 0,
      volume24h: Number(p.volume?.h24) || 0,
      image: p.info?.imageUrl,
      pairAddress: p.pairAddress,
    };
  } catch {
    return null;
  }
}

export type PumpTrendingRow = {
  mint: string;
  name: string;
  symbol: string;
  imageUri: string | null;
  marketCapUsd: number;
  progress: number;
};

/** GET /api/pumpfun/trending — polled every 1s from the demo dashboard. */
export async function fetchPumpTrending(): Promise<PumpTrendingRow[]> {
  try {
    const res = await fetch(`${GHOST_BACKEND}/api/pumpfun/trending`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const json = await res.json().catch(() => null);
    const tokens: any[] = Array.isArray(json?.tokens) ? json.tokens : [];
    return tokens.map((t) => ({
      mint: t.mint,
      name: t.name ?? "",
      symbol: t.symbol ?? "",
      imageUri: t.imageUri ?? null,
      marketCapUsd: Number(t.marketCapUsd) || 0,
      progress: Number(t.progress) || 0,
    }));
  } catch {
    return [];
  }
}
