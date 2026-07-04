/**
 * Ghost AI — API Router
 *
 * All backend API endpoints are registered here.
 * Sub-routers are mounted by domain (demo, etc.).
 */

import { Router, type Request, type Response } from "express";
import { router as demoRouter } from "./demo.js";

export const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the Helius REST API key from the HELIUS_RPC_URL env var.
 * Expected format: https://mainnet.helius-rpc.com/?api-key=<KEY>
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

// USDC mint — used as the output token when requesting Jupiter route quotes
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

// ── Sub-routers ───────────────────────────────────────────────────────────────

router.use("/demo", demoRouter);

// ── Directory ─────────────────────────────────────────────────────────────────

router.get("/", (_req: Request, res: Response) => {
  res.json({
    message: "Ghost AI API",
    endpoints: [
      { method: "POST", path: "/api/debug-transaction",  description: "Decode a Solana transaction via Helius" },
      { method: "GET",  path: "/api/token-metrics",      description: "Token supply, liquidity, FDV (DexScreener) + Jupiter route intel" },
      { method: "POST", path: "/api/demo/initialize",    description: "Create a demo account with $1,000 starting balance" },
      { method: "POST", path: "/api/demo/trade",         description: "Log a mock buy/sell action on a demo account" },
    ],
  });
});

// ── POST /api/debug-transaction ───────────────────────────────────────────────
/**
 * Body: { "input": "<free-text or raw signature>" }
 *
 * Scans the input for an 88-character base58 Solana transaction signature,
 * extracts it cleanly, fetches the decoded transaction from Helius Enhanced
 * Transactions API, and returns the structured result.
 */
router.post("/debug-transaction", async (req: Request, res: Response) => {
  try {
    const { input } = req.body as { input?: unknown };

    if (!input || typeof input !== "string" || input.trim() === "") {
      res.status(400).json({ error: "Body must contain a non-empty 'input' string" });
      return;
    }

    // Match a standalone base58 Solana signature (87–88 chars).
    // Lookaround prevents matching a substring of a longer token.
    const SIG_RE =
      /(?<![1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{87,88})(?![1-9A-HJ-NP-Za-km-z])/;
    const match = input.match(SIG_RE);

    if (!match) {
      res.status(422).json({
        error: "No Solana transaction signature found",
        hint: "A signature is 87–88 base58 characters (alphabet: 1-9 A-H J-N P-Z a-k m-z)",
      });
      return;
    }

    const signature = match[1];
    const apiKey = getHeliusApiKey();

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
 * Fetches DexScreener data (supply, liquidity, FDV) and cross-references it
 * against Jupiter Aggregator to provide:
 *   - jupiterPrice:      reference price from Jupiter's on-chain oracle
 *   - priceDeviation:   % difference between DexScreener and Jupiter prices
 *   - routePlan:        which AMMs Jupiter routes through for best execution
 *   - priceImpactPct:   estimated price impact for a $1,000 notional swap
 *   - slippageWarning:  true when price impact exceeds 1 %
 *
 * These fields let the frontend warn users before they enter a high-slippage trade.
 */
router.get("/token-metrics", async (req: Request, res: Response) => {
  try {
    const { mint } = req.query as { mint?: string };

    if (!mint || typeof mint !== "string" || mint.trim() === "") {
      res.status(400).json({ error: "Query param 'mint' is required" });
      return;
    }

    const cleanMint = mint.trim();

    // ── DexScreener fetch ─────────────────────────────────────────────────────
    const dexRes = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(cleanMint)}`,
      { headers: { Accept: "application/json" } }
    );

    if (!dexRes.ok) {
      res.status(dexRes.status).json({
        error: "DexScreener API returned an error",
        dexStatus: dexRes.status,
      });
      return;
    }

    // ── DexScreener: pick the most liquid Solana pair ─────────────────────────
    const dexData = (await dexRes.json()) as {
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

    if (!dexData.pairs || dexData.pairs.length === 0) {
      res.status(404).json({ error: "No trading pairs found for this mint address" });
      return;
    }

    const solanaPairs = dexData.pairs.filter((p) => p.chainId === "solana");
    const pool = solanaPairs.length > 0 ? solanaPairs : dexData.pairs;
    const best = pool.sort(
      (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
    )[0];

    const dexPriceUsd  = parseFloat(best.priceUsd ?? "0");
    const fdv          = best.fdv ?? 0;
    const liquidityUsd = best.liquidity?.usd ?? 0;
    const totalSupply  = fdv > 0 && dexPriceUsd > 0
      ? Math.round(fdv / dexPriceUsd)
      : null;

    // ── Jupiter swap/v1/quote: route plan + price impact + price reference ────
    // Confirmed-live endpoint as of 2026-07.
    // We use a 1,000,000 base-unit test swap (≈ $1 at 6-decimal tokens).
    // Jupiter's `swapUsdValue` field returns the USD value of the input amount,
    // so we also surface that as a price cross-reference without needing a
    // separate price API.
    let routePlan: string[] = [];
    let priceImpactPct: number | null = null;
    let slippageWarning = false;
    let jupiterSwapUsdValue: number | null = null;
    let priceDeviation: number | null = null;

    try {
      const quoteUrl =
        `https://api.jup.ag/swap/v1/quote` +
        `?inputMint=${encodeURIComponent(cleanMint)}` +
        `&outputMint=${encodeURIComponent(USDC_MINT)}` +
        `&amount=1000000` +
        `&slippageBps=50`;

      const quoteRes = await fetch(quoteUrl, {
        headers: { Accept: "application/json" },
      });

      if (quoteRes.ok) {
        const quote = (await quoteRes.json()) as {
          priceImpactPct?: string | number;
          swapUsdValue?:   string | number;
          routePlan?: Array<{
            swapInfo?: { label?: string; ammKey?: string };
            percent?: number;
          }>;
        };

        // Price impact
        if (quote.priceImpactPct != null) {
          const parsed = parseFloat(String(quote.priceImpactPct));
          if (Number.isFinite(parsed)) {
            priceImpactPct  = parsed;
            slippageWarning = parsed > 1; // warn when impact exceeds 1 %
          }
        }

        // Route plan — which AMMs Jupiter uses for best execution
        if (Array.isArray(quote.routePlan)) {
          routePlan = quote.routePlan.map(
            (step) => step.swapInfo?.label ?? step.swapInfo?.ammKey ?? "Unknown"
          );
        }

        // Price cross-reference via swapUsdValue
        //
        // swapUsdValue = total USD value of the 1,000,000 base-unit input.
        // pricePerBaseUnit = swapUsdValue / 1,000,000  (USD per 1 base unit)
        //
        // To compare against DexScreener's priceUsd (per *whole* token) we need
        // the token's decimal count.  We infer it from the ratio:
        //   dexPriceUsd = pricePerBaseUnit × 10^decimals
        //   → decimals ≈ round( log10( dexPriceUsd / pricePerBaseUnit ) )
        //
        // This is exact for any standard decimal count (0–18) and lets us
        // express the Jupiter price in the same unit as DexScreener.
        if (quote.swapUsdValue != null) {
          const totalUsdValue    = parseFloat(String(quote.swapUsdValue));
          const pricePerBaseUnit = totalUsdValue / 1_000_000;

          if (pricePerBaseUnit > 0 && dexPriceUsd > 0) {
            // Clamp to realistic Solana token decimal range (0–18)
            const inferredDecimals = Math.min(
              18,
              Math.max(0, Math.round(Math.log10(dexPriceUsd / pricePerBaseUnit)))
            );
            // Normalize to whole-token USD price using the inferred decimals
            const jupiterWholePriceUsd = parseFloat(
              (pricePerBaseUnit * Math.pow(10, inferredDecimals)).toFixed(10)
            );
            if (Number.isFinite(jupiterWholePriceUsd) && jupiterWholePriceUsd > 0) {
              jupiterSwapUsdValue = jupiterWholePriceUsd;
              // Both sides are now whole-token USD — deviation is unit-consistent
              const dev = ((dexPriceUsd - jupiterWholePriceUsd) / jupiterWholePriceUsd) * 100;
              priceDeviation = Number.isFinite(dev)
                ? parseFloat(dev.toFixed(4))
                : null;
            }
          }
        }
      }
    } catch {
      // Non-fatal — Jupiter route intel unavailable; core metrics still returned
    }

    // ── Compose response ──────────────────────────────────────────────────────
    res.json({
      mint: best.baseToken.address,
      symbol: best.baseToken.symbol,
      name: best.baseToken.name,

      // DexScreener data
      priceUsd: dexPriceUsd,
      totalSupply,
      liquidityUsd,
      fdv,
      pairAddress: best.pairAddress,
      dex: best.dexId,
      pairCreatedAt: best.pairCreatedAt ?? null,

      // Jupiter Aggregator route intelligence
      jupiter: {
        jupiterPriceUsd: jupiterSwapUsdValue,    // whole-token USD price (inferred via decimal normalization)
        priceDeviation,                          // % diff vs DexScreener (+ = DEX pricier, null if unavailable)
        routePlan,                               // AMMs in the optimal execution path
        priceImpactPct,                          // estimated impact for 1,000,000 base-unit swap
        slippageWarning,                         // true when priceImpact > 1 %
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});
