/**
 * Ghost AI — Demo Trading Router
 *
 * All demo account state is persisted to server/data/demo-db.json via the
 * db module so user balances, positions, and trade history survive server
 * restarts and page refreshes.
 *
 * Routes (mounted under /api/demo):
 *
 *   POST /initialize          — create (or retrieve) a demo account
 *   POST /trade               — manual buy / sell
 *   GET  /account             — account state with live unrealised PnL
 *
 *   POST /auto-trade          — start a timed AI trade session
 *   GET  /auto-trade-status   — poll current auto-trade status
 *   DELETE /auto-trade        — cancel an in-flight auto-trade session
 *   GET  /auto-trade-history  — all past sessions for a user
 *
 * Live PnL:
 *   A background loop (every 2 s) keeps livePrices fresh via DexScreener.
 *   The /account endpoint uses these prices to compute per-position
 *   unrealised PnL in real-time without an upstream fetch per request.
 *
 * Equity formula:
 *   totalEquity = cashBalance + Σ(position.marketValue)
 *   (unrealizedPnl is embedded in marketValue — never double-counted)
 */

import { Router, type Request, type Response } from "express";
import {
  type DemoAccount,
  type TradeEntry,
  getAccount,
  hasAccount,
  saveAccount,
  getAllAccounts,
} from "../lib/db.js";
import {
  startAutoTrade,
  cancelAutoTrade,
} from "../lib/auto-trader.js";
import {
  getLatestAutoTradeForUser,
  getAutoTradeHistoryForUser,
} from "../lib/db.js";

export const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const PNL_REFRESH_MS         = 2_000;
const DEXSCREENER_TIMEOUT_MS = 4_000;

// ── Live price cache (in-memory; rebuilt automatically by background loop) ───

const livePrices = new Map<string, { priceUsd: number; updatedAt: number }>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * True FIFO cost-basis.
 * Buy trades enqueue lots; sell trades dequeue from the front.
 * Returns the weighted-average price of remaining lots, or null if none held.
 */
function avgEntryPrice(account: DemoAccount, mint: string): number | null {
  const lots: Array<{ amount: number; priceUsd: number }> = [];

  for (const trade of account.trades) {
    if (trade.mint !== mint) continue;
    if (trade.action === "buy") {
      lots.push({ amount: trade.amount, priceUsd: trade.priceUsd });
    } else {
      let remaining = trade.amount;
      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        if (lot.amount <= remaining) {
          remaining -= lot.amount;
          lots.shift();
        } else {
          lot.amount -= remaining;
          remaining   = 0;
        }
      }
    }
  }

  if (lots.length === 0) return null;
  const totalCost   = lots.reduce((s, l) => s + l.amount * l.priceUsd, 0);
  const totalTokens = lots.reduce((s, l) => s + l.amount, 0);
  return totalTokens > 0 ? totalCost / totalTokens : null;
}

function symbolForMint(account: DemoAccount, mint: string): string {
  const last = [...account.trades].reverse().find(t => t.mint === mint);
  return last?.symbol ?? mint.slice(0, 6) + "…";
}

// ── Background PnL price tracker ─────────────────────────────────────────────

async function refreshLivePrices(): Promise<void> {
  const allMints = new Set<string>();
  for (const acct of getAllAccounts()) {
    for (const mint of Object.keys(acct.portfolio)) allMints.add(mint);
  }
  if (allMints.size === 0) return;

  const BATCH_SIZE = 5;
  const mints      = [...allMints];

  for (let i = 0; i < mints.length; i += BATCH_SIZE) {
    await Promise.allSettled(
      mints.slice(i, i + BATCH_SIZE).map(async (mint) => {
        try {
          const res = await fetch(
            `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`,
            { signal: AbortSignal.timeout(DEXSCREENER_TIMEOUT_MS) }
          );
          if (!res.ok) return;

          const data = (await res.json()) as {
            pairs?: Array<{
              chainId:    string;
              priceUsd?:  string;
              liquidity?: { usd?: number };
            }>;
          };

          const pairs = (data.pairs ?? []).filter(p => p.chainId === "solana");
          if (pairs.length === 0) return;

          const best  = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
          const price = parseFloat(best.priceUsd ?? "0");
          if (price > 0) livePrices.set(mint, { priceUsd: price, updatedAt: Date.now() });
        } catch { /* keep previous cached price */ }
      })
    );
  }
}

const _pnlTimer = setInterval(() => { refreshLivePrices().catch(() => {}); }, PNL_REFRESH_MS);
if (_pnlTimer.unref) _pnlTimer.unref();

// ── POST /api/demo/initialize ─────────────────────────────────────────────────

router.post("/initialize", (req: Request, res: Response) => {
  try {
    const { userId: requestedId } = req.body as { userId?: string };
    const userId = (requestedId ?? "").trim() || generateId();

    if (hasAccount(userId)) {
      const existing = getAccount(userId)!;
      res.json({
        userId:     existing.userId,
        balanceUsd: existing.balanceUsd,
        portfolio:  existing.portfolio,
        trades:     existing.trades,
        createdAt:  existing.createdAt,
        note:       "Existing demo account returned from persistent store — balance was not reset",
      });
      return;
    }

    const account: DemoAccount = {
      userId,
      balanceUsd: 1000,
      portfolio:  {},
      trades:     [],
      createdAt:  new Date().toISOString(),
    };
    saveAccount(account);

    res.status(201).json({
      userId:     account.userId,
      balanceUsd: account.balanceUsd,
      portfolio:  account.portfolio,
      trades:     account.trades,
      createdAt:  account.createdAt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});

// ── POST /api/demo/trade ──────────────────────────────────────────────────────

router.post("/trade", (req: Request, res: Response) => {
  try {
    const { userId, action, mint, symbol, amount, priceUsd } = req.body as {
      userId?:   string;
      action?:   string;
      mint?:     string;
      symbol?:   string;
      amount?:   unknown;
      priceUsd?: unknown;
    };

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "'userId' is required" }); return;
    }
    if (action !== "buy" && action !== "sell") {
      res.status(400).json({ error: "'action' must be 'buy' or 'sell'" }); return;
    }
    if (!mint || typeof mint !== "string") {
      res.status(400).json({ error: "'mint' is required" }); return;
    }
    if (!symbol || typeof symbol !== "string") {
      res.status(400).json({ error: "'symbol' is required" }); return;
    }

    const tokenAmount = Number(amount);
    const tokenPrice  = Number(priceUsd);

    if (!Number.isFinite(tokenAmount) || tokenAmount <= 0) {
      res.status(400).json({ error: "'amount' must be a positive number" }); return;
    }
    if (!Number.isFinite(tokenPrice) || tokenPrice <= 0) {
      res.status(400).json({ error: "'priceUsd' must be a positive number" }); return;
    }

    const account = getAccount(userId.trim());
    if (!account) {
      res.status(404).json({ error: "Demo account not found — call POST /api/demo/initialize first" });
      return;
    }

    const totalUsd       = parseFloat((tokenAmount * tokenPrice).toFixed(6));
    const currentHolding = account.portfolio[mint] ?? 0;

    if (action === "buy") {
      if (account.balanceUsd < totalUsd) {
        res.status(422).json({
          error:     "Insufficient demo balance",
          required:  totalUsd,
          available: account.balanceUsd,
        });
        return;
      }
      account.balanceUsd      = parseFloat((account.balanceUsd - totalUsd).toFixed(6));
      account.portfolio[mint] = parseFloat((currentHolding + tokenAmount).toFixed(9));
      livePrices.set(mint, { priceUsd: tokenPrice, updatedAt: Date.now() });
    } else {
      if (currentHolding < tokenAmount) {
        res.status(422).json({
          error:     "Insufficient token holdings to sell",
          required:  tokenAmount,
          available: currentHolding,
        });
        return;
      }
      account.balanceUsd = parseFloat((account.balanceUsd + totalUsd).toFixed(6));
      const remaining    = parseFloat((currentHolding - tokenAmount).toFixed(9));
      if (remaining <= 0) {
        delete account.portfolio[mint];
        livePrices.delete(mint);
      } else {
        account.portfolio[mint] = remaining;
      }
    }

    const trade: TradeEntry = {
      id:        generateId(),
      action,
      mint,
      symbol:    symbol.toUpperCase(),
      amount:    tokenAmount,
      priceUsd:  tokenPrice,
      totalUsd,
      timestamp: new Date().toISOString(),
    };
    account.trades.push(trade);
    saveAccount(account);  // persist every mutation

    res.json({
      trade,
      account: {
        userId:     account.userId,
        balanceUsd: account.balanceUsd,
        portfolio:  account.portfolio,
        tradeCount: account.trades.length,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});

// ── GET /api/demo/account ─────────────────────────────────────────────────────

router.get("/account", (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };

  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "Query param 'userId' is required" });
    return;
  }

  const account = getAccount(userId.trim());
  if (!account) {
    res.status(404).json({ error: "Demo account not found" });
    return;
  }

  let totalUnrealizedPnl = 0;

  const positions = Object.entries(account.portfolio).map(([mint, amount]) => {
    const entry        = avgEntryPrice(account, mint);
    const liveData     = livePrices.get(mint);
    const currentPrice = liveData?.priceUsd ?? entry ?? 0;
    const entryPrice   = entry ?? currentPrice;

    const unrealizedPnl = parseFloat(((currentPrice - entryPrice) * amount).toFixed(6));
    const pnlPercent    = entryPrice > 0
      ? parseFloat((((currentPrice - entryPrice) / entryPrice) * 100).toFixed(4))
      : 0;

    totalUnrealizedPnl += unrealizedPnl;

    return {
      mint,
      symbol:          symbolForMint(account, mint),
      amount,
      entryPrice:      parseFloat(entryPrice.toFixed(8)),
      currentPrice:    parseFloat(currentPrice.toFixed(8)),
      priceUpdatedAt:  liveData?.updatedAt ?? null,
      unrealizedPnl,
      pnlPercent,
      marketValue:     parseFloat((currentPrice * amount).toFixed(6)),
    };
  });

  // totalEquity = cashBalance + market value of all holdings
  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalEquity      = parseFloat((account.balanceUsd + totalMarketValue).toFixed(6));

  res.json({
    userId:             account.userId,
    balanceUsd:         account.balanceUsd,
    portfolio:          account.portfolio,
    positions,
    totalUnrealizedPnl: parseFloat(totalUnrealizedPnl.toFixed(6)),
    totalMarketValue:   parseFloat(totalMarketValue.toFixed(6)),
    totalEquity,
    trades:             account.trades,
    createdAt:          account.createdAt,
    persistedAt:        new Date().toISOString(),  // signals to frontend that state is durable
  });
});

// ── POST /api/demo/auto-trade ─────────────────────────────────────────────────

router.post("/auto-trade", (req: Request, res: Response) => {
  try {
    const {
      userId,
      durationMinutes: rawMinutes,
      tradeAmountUsd:  rawAmount,
    } = req.body as {
      userId?:          string;
      durationMinutes?: unknown;
      tradeAmountUsd?:  unknown;
    };

    if (!userId || typeof userId !== "string") {
      res.status(400).json({ error: "'userId' is required" }); return;
    }

    const account = getAccount(userId.trim());
    if (!account) {
      res.status(404).json({ error: "Demo account not found — call POST /api/demo/initialize first" });
      return;
    }

    // Default: 5-minute trade, 10 % of balance (min $10, max $200)
    const durationMinutes = Math.max(1, Math.min(60, Number(rawMinutes) || 5));
    const defaultAmount   = Math.min(200, Math.max(10, account.balanceUsd * 0.10));
    const tradeAmountUsd  = Math.max(1, Math.min(account.balanceUsd, Number(rawAmount) || defaultAmount));

    const result = startAutoTrade({ userId: userId.trim(), durationMinutes, tradeAmountUsd });

    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }

    res.status(202).json({
      message:  `Auto-trade started — analyzing market, trade will execute in ~2s and close in ${durationMinutes} minute(s)`,
      session:  result.session,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected server error";
    res.status(500).json({ error: message });
  }
});

// ── GET /api/demo/auto-trade-status ──────────────────────────────────────────

router.get("/auto-trade-status", (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };

  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "Query param 'userId' is required" }); return;
  }

  const session = getLatestAutoTradeForUser(userId.trim());
  if (!session) {
    res.status(404).json({ error: "No auto-trade sessions found for this user" }); return;
  }

  // Compute countdown seconds remaining if still in EXECUTING_TRADE
  let secondsRemaining: number | null = null;
  if (session.status === "EXECUTING_TRADE" && session.expiresAt) {
    secondsRemaining = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
  }

  res.json({ session, secondsRemaining });
});

// ── DELETE /api/demo/auto-trade ───────────────────────────────────────────────

router.delete("/auto-trade", (req: Request, res: Response) => {
  const { userId } = req.body as { userId?: string };

  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "'userId' is required in body" }); return;
  }

  const cancelled = cancelAutoTrade(userId.trim());
  if (!cancelled) {
    res.status(404).json({ error: "No active auto-trade session found for this user" }); return;
  }

  res.json({ message: "Auto-trade session cancelled" });
});

// ── GET /api/demo/auto-trade-history ─────────────────────────────────────────

router.get("/auto-trade-history", (req: Request, res: Response) => {
  const { userId } = req.query as { userId?: string };

  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "Query param 'userId' is required" }); return;
  }

  const history = getAutoTradeHistoryForUser(userId.trim());
  res.json({
    userId:  userId.trim(),
    count:   history.length,
    sessions: history,
  });
});
