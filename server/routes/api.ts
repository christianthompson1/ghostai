/**
 * Ghost AI — API Router
 *
 * All backend API endpoints are registered here.
 * Add sub-routers per domain (tokens, solana, chat, etc.) as the engine grows.
 */

import { Router, type Request, type Response } from "express";

export const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a Helius REST API key from the HELIUS_RPC_URL env var.
 * The URL format is: https://mainnet.helius-rpc.com/?api-key=<KEY>
 */
function getHeliusApiKey(): string {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) throw new Error("HELIUS_RPC_URL secret is not set");

  let apiKey: string | null;
  try {
    apiKey = new URL(rpcUrl).searchParams.get("api-key");
  } catch {
    throw new Error("HELIUS_RPC_URL is not a valid URL");
  }

  if (!apiKey) throw new Error("No api-key param found in HELIUS_RPC_URL");
  return apiKey;
}

// ── Directory ────────────────────────────────────────────────────────────────

router.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "Ghost AI API",
    endpoints: [
      { method: "POST", path: "/api/debug-transaction", description: "Decode a Solana transaction via Helius" },
      { method: "GET",  path: "/api/token-metrics",    description: "Fetch token supply, liquidity, and FDV from DexScreener" },
    ],
  });
});

// ── POST /api/debug-transaction ───────────────────────────────────────────────
/**
 * Body: { "input": "<free-text or raw signature>" }
 *
 * Scans the input for an 88-character base58 Solana transaction signature,
 * extracts it cleanly (strips surrounding text), fetches the decoded
 * transaction from Helius Enhanced Transactions API, and returns the result.
 */
router.post("/debug-transaction", async (req: Request, res: Response) => {
  try {
    const { input } = req.body as { input?: unknown };

    if (!input || typeof input !== "string" || input.trim() === "") {
      res.status(400).json({ error: "Body must contain a non-empty 'input' string" });
      return;
    }

    // Match a standalone base58 Solana signature (87–88 chars).
    // Negative lookahead/lookbehind ensures we don't clip a longer token.
    const SIG_RE = /(?<![1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{87,88})(?![1-9A-HJ-NP-Za-km-z])/;
    const match = input.match(SIG_RE);

    if (!match) {
      res.status(422).json({
        error: "No Solana transaction signature found",
        hint: "A signature is 87–88 base58 characters (alphabet: 1-9 A-H J-N P-Z a-k m-z)",
      });
      return;
    }

    const signature = match[1];

    const apiKey = getHeliusApiKey(); // throws if missing/malformed

    const heliusRes = await fetch(
      `https://api.helius.xyz/v0/transactions/${encodeURIComponent(signature)}?api-key=${encodeURIComponent(apiKey)}`,
      { headers: { Accept: "application/json" } }
    );

    if (!heliusRes.ok) {
      const body = await heliusRes.text().catch(() => "");
      res.status(heliusRes.status).json({
        error: "Helius API returned an error",
        heliusStatus: heliusRes.status,
        detail: body,
      });
      return;
    }

    const transaction = await heliusRes.json();
    res.json({ signature, transaction });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});

// ── GET /api/token-metrics ────────────────────────────────────────────────────
/**
 * Query param: mint=<Solana mint address>
 *
 * Fetches all trading pairs for the token from DexScreener, picks the most
 * liquid Solana pair, and returns total supply, liquidity (USD), and FDV.
 *
 * Total supply is derived from: totalSupply = FDV / priceUsd
 * (FDV = fully diluted value = totalSupply × price)
 */
router.get("/token-metrics", async (req: Request, res: Response) => {
  try {
    const { mint } = req.query as { mint?: string };

    if (!mint || typeof mint !== "string" || mint.trim() === "") {
      res.status(400).json({ error: "Query param 'mint' is required" });
      return;
    }

    const dexRes = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint.trim())}`,
      { headers: { Accept: "application/json" } }
    );

    if (!dexRes.ok) {
      res.status(dexRes.status).json({
        error: "DexScreener API returned an error",
        dexStatus: dexRes.status,
      });
      return;
    }

    const data = (await dexRes.json()) as {
      pairs?: Array<{
        chainId: string;
        pairAddress: string;
        dexId: string;
        baseToken: { address: string; symbol: string; name: string };
        priceUsd?: string;
        liquidity?: { usd?: number };
        fdv?: number;
        marketCap?: number;
        pairCreatedAt?: number;
      }>;
    };

    if (!data.pairs || data.pairs.length === 0) {
      res.status(404).json({ error: "No trading pairs found for this mint address" });
      return;
    }

    // Prefer Solana pairs; fall back to all pairs if none tagged "solana"
    const solanaPairs = data.pairs.filter((p) => p.chainId === "solana");
    const pool = solanaPairs.length > 0 ? solanaPairs : data.pairs;

    // Pick the pair with the highest liquidity in USD
    const best = pool.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
    )[0];

    const priceUsd = parseFloat(best.priceUsd ?? "0");
    const fdv = best.fdv ?? 0;
    const liquidityUsd = best.liquidity?.usd ?? 0;

    // Derive total supply from FDV ÷ price (accurate to the token's decimal layout)
    const totalSupply = priceUsd > 0 ? Math.round(fdv / priceUsd) : null;

    res.json({
      mint: best.baseToken.address,
      symbol: best.baseToken.symbol,
      name: best.baseToken.name,
      priceUsd,
      totalSupply,           // derived: FDV / price
      liquidityUsd,          // USD value locked in the best pool
      fdv,                   // fully diluted valuation in USD
      pairAddress: best.pairAddress,
      dex: best.dexId,
      pairCreatedAt: best.pairCreatedAt ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});
