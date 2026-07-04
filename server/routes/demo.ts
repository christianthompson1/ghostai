/**
 * Ghost AI — Demo Trading Simulation Router
 *
 * In-memory endpoints that let the frontend run a simulated trading session
 * without touching real funds.  All state lives in a module-scoped Map and
 * resets when the server restarts.
 *
 * Routes (mounted under /api/demo):
 *   POST /initialize  — create a demo account with $1,000 starting balance
 *   POST /trade       — log a mock buy or sell action
 */

import { Router, type Request, type Response } from "express";

export const router = Router();

// ── In-memory store ───────────────────────────────────────────────────────────

interface TradeEntry {
  id: string;
  action: "buy" | "sell";
  mint: string;
  symbol: string;
  amount: number;       // number of tokens
  priceUsd: number;     // entry price per token in USD
  totalUsd: number;     // amount × priceUsd
  timestamp: string;    // ISO-8601
}

interface DemoAccount {
  userId: string;
  balanceUsd: number;   // remaining cash balance
  portfolio: Record<string, number>; // mint → token quantity held
  trades: TradeEntry[];
  createdAt: string;
}

// Keyed by userId
const accounts = new Map<string, DemoAccount>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ── POST /api/demo/initialize ─────────────────────────────────────────────────
/**
 * Body (all optional):
 *   { "userId": string }   — supply your own ID or omit to auto-generate one
 *
 * Creates a fresh demo account with $1,000 starting balance.
 * If the userId already exists the existing account is returned unchanged
 * (idempotent so the frontend can call this on page-load safely).
 */
router.post("/initialize", (req: Request, res: Response) => {
  try {
    const { userId: requestedId } = req.body as { userId?: string };
    const userId = (requestedId ?? "").trim() || generateId();

    // Idempotent — return existing account without resetting it
    if (accounts.has(userId)) {
      const existing = accounts.get(userId)!;
      res.json({
        userId: existing.userId,
        balanceUsd: existing.balanceUsd,
        portfolio: existing.portfolio,
        trades: existing.trades,
        createdAt: existing.createdAt,
        note: "Existing demo account returned — balance was not reset",
      });
      return;
    }

    const account: DemoAccount = {
      userId,
      balanceUsd: 1000,
      portfolio: {},
      trades: [],
      createdAt: new Date().toISOString(),
    };

    accounts.set(userId, account);

    res.status(201).json({
      userId: account.userId,
      balanceUsd: account.balanceUsd,
      portfolio: account.portfolio,
      trades: account.trades,
      createdAt: account.createdAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});

// ── POST /api/demo/trade ──────────────────────────────────────────────────────
/**
 * Body:
 *   {
 *     "userId":   string,          — ID returned from /initialize
 *     "action":   "buy" | "sell",
 *     "mint":     string,          — Solana mint address
 *     "symbol":   string,          — e.g. "SOL"
 *     "amount":   number,          — number of tokens
 *     "priceUsd": number           — entry price per token in USD
 *   }
 *
 * Buy  → deducts (amount × price) from balanceUsd, adds tokens to portfolio
 * Sell → adds (amount × price) to balanceUsd, removes tokens from portfolio
 *
 * Returns the updated account state plus the logged trade entry.
 */
router.post("/trade", (req: Request, res: Response) => {
  try {
    const {
      userId,
      action,
      mint,
      symbol,
      amount,
      priceUsd,
    } = req.body as {
      userId?: string;
      action?: string;
      mint?: string;
      symbol?: string;
      amount?: unknown;
      priceUsd?: unknown;
    };

    // ── Validation ────────────────────────────────────────────────────────────
    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "'userId' is required" });
      return;
    }
    if (action !== "buy" && action !== "sell") {
      res.status(400).json({ error: "'action' must be 'buy' or 'sell'" });
      return;
    }
    if (!mint || typeof mint !== "string") {
      res.status(400).json({ error: "'mint' is required" });
      return;
    }
    if (!symbol || typeof symbol !== "string") {
      res.status(400).json({ error: "'symbol' is required" });
      return;
    }

    const tokenAmount = Number(amount);
    const tokenPrice  = Number(priceUsd);

    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
      res.status(400).json({ error: "'amount' must be a positive number" });
      return;
    }
    if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) {
      res.status(400).json({ error: "'priceUsd' must be a positive number" });
      return;
    }

    // ── Account lookup ────────────────────────────────────────────────────────
    const account = accounts.get(userId.trim());
    if (!account) {
      res.status(404).json({
        error: "Demo account not found — call POST /api/demo/initialize first",
      });
      return;
    }

    const totalUsd = parseFloat((tokenAmount * tokenPrice).toFixed(6));
    const currentHolding = account.portfolio[mint] ?? 0;

    // ── Execute mock trade ────────────────────────────────────────────────────
    if (action === "buy") {
      if (account.balanceUsd < totalUsd) {
        res.status(422).json({
          error: "Insufficient demo balance",
          required: totalUsd,
          available: account.balanceUsd,
        });
        return;
      }
      account.balanceUsd = parseFloat((account.balanceUsd - totalUsd).toFixed(6));
      account.portfolio[mint] = parseFloat((currentHolding + tokenAmount).toFixed(9));
    } else {
      // sell
      if (currentHolding < tokenAmount) {
        res.status(422).json({
          error: "Insufficient token holdings to sell",
          required: tokenAmount,
          available: currentHolding,
        });
        return;
      }
      account.balanceUsd = parseFloat((account.balanceUsd + totalUsd).toFixed(6));
      const remaining = parseFloat((currentHolding - tokenAmount).toFixed(9));
      if (remaining === 0) {
        delete account.portfolio[mint];
      } else {
        account.portfolio[mint] = remaining;
      }
    }

    // ── Log the trade ─────────────────────────────────────────────────────────
    const trade: TradeEntry = {
      id: generateId(),
      action,
      mint,
      symbol: symbol.toUpperCase(),
      amount: tokenAmount,
      priceUsd: tokenPrice,
      totalUsd,
      timestamp: new Date().toISOString(),
    };
    account.trades.push(trade);

    res.json({
      trade,
      account: {
        userId: account.userId,
        balanceUsd: account.balanceUsd,
        portfolio: account.portfolio,
        tradeCount: account.trades.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});

// ── GET /api/demo/account ─────────────────────────────────────────────────────
/**
 * Query param: userId=<id>
 * Returns the current state of a demo account without making any changes.
 */
router.get("/account", (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };

  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "Query param 'userId' is required" });
    return;
  }

  const account = accounts.get(userId.trim());
  if (!account) {
    res.status(404).json({ error: "Demo account not found" });
    return;
  }

  res.json({
    userId: account.userId,
    balanceUsd: account.balanceUsd,
    portfolio: account.portfolio,
    trades: account.trades,
    createdAt: account.createdAt,
  });
});
