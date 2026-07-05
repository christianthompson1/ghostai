/**
 * Ghost AI — Demo Trading Simulation Router
 *
 * In-memory endpoints that let the frontend run a simulated trading session
 * without touching real funds.  All state lives in module-scoped Maps and
 * resets when the server restarts.
 *
 * Routes (mounted under /api/demo):
 *   POST /initialize  — create a demo account with $1,000 starting balance
 *   POST /trade       — log a mock buy or sell action
 *   GET  /account     — read account state with live unrealised PnL
 *
 * Live PnL tracking:
 *   A background loop (PNL_REFRESH_MS) fetches the current market price
 *   for every mint held across all demo accounts via DexScreener.  The
 *   /account endpoint then attaches per-position data:
 *     entryPrice     — weighted average cost basis from buy trades
 *     currentPrice   — last fetched live price (null until first refresh)
 *     unrealizedPnl  — (currentPrice − entryPrice) × amount
 *     pnlPercent     — percentage return vs entry
 */

import { Router, type Request, type Response } from "express";

export const router = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const PNL_REFRESH_MS   = 2_000;   // how often to refresh live prices
const DEXSCREENER_TIMEOUT_MS = 4_000;

// ── In-memory store ───────────────────────────────────────────────────────────

interface TradeEntry {
  id:        string;
  action:    "buy" | "sell";
  mint:      string;
  symbol:    string;
  amount:    number;
  priceUsd:  number;
  totalUsd:  number;
  timestamp: string;
}

interface DemoAccount {
  userId:    string;
  balanceUsd: number;
  portfolio:  Record<string, number>;  // mint → quantity
  trades:     TradeEntry[];
  createdAt:  string;
}

/** Keyed by userId. */
const accounts = new Map<string, DemoAccount>();

/**
 * Live price cache for PnL computation.
 * Populated by the background refresh loop — never by request handlers.
 */
const livePrices = new Map<string, { priceUsd: number; updatedAt: number }>();

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * True FIFO cost-basis for a mint.
 *
 * Buy trades enqueue lots {amount, priceUsd}.
 * Sell trades dequeue from the front of the queue.
 * The returned value is the weighted average price of whatever lots remain.
 */
function avgEntryPrice(account: DemoAccount, mint: string): number | null {
  // Build a queue of buy lots in chronological order
  const lots: Array<{ amount: number; priceUsd: number }> = [];

  for (const trade of account.trades) {
    if (trade.mint !== mint) continue;

    if (trade.action === "buy") {
      lots.push({ amount: trade.amount, priceUsd: trade.priceUsd });
    } else {
      // Consume lots FIFO
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

/** Derive the symbol for a mint from the most recent trade on that mint. */
function symbolForMint(account: DemoAccount, mint: string): string {
  const last = [...account.trades].reverse().find(t => t.mint === mint);
  return last?.symbol ?? mint.slice(0, 6) + "…";
}

// ── Background PnL tracker ────────────────────────────────────────────────────

/**
 * Collect every unique mint held across all accounts, then fetch its
 * current price from DexScreener in parallel batches of 5.
 * Runs every PNL_REFRESH_MS milliseconds.
 */
async function refreshLivePrices(): Promise<void> {
  const allMints = new Set<string>();
  for (const acct of accounts.values()) {
    for (const mint of Object.keys(acct.portfolio)) allMints.add(mint);
  }
  if (allMints.size === 0) return;

  const mints      = [...allMints];
  const BATCH_SIZE = 5;

  for (let i = 0; i < mints.length; i += BATCH_SIZE) {
    const batch = mints.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(
      batch.map(async (mint) => {
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

          const best  = pairs.sort(
            (a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0)
          )[0];
          const price = parseFloat(best.priceUsd ?? "0");
          if (price > 0) livePrices.set(mint, { priceUsd: price, updatedAt: Date.now() });
        } catch {
          // Non-fatal — keep the previous cached price
        }
      })
    );
  }
}

// Self-start when the module is imported (called once on server boot)
const _pnlTimer = setInterval(() => { refreshLivePrices().catch(() => {}); }, PNL_REFRESH_MS);
// Allow Node.js to exit cleanly even if this interval is still pending
if (_pnlTimer.unref) _pnlTimer.unref();

// ── POST /api/demo/initialize ─────────────────────────────────────────────────

router.post("/initialize", (req: Request, res: Response) => {
  try {
    const { userId: requestedId } = req.body as { userId?: string };
    const userId = (requestedId ?? "").trim() || generateId();

    if (accounts.has(userId)) {
      const existing = accounts.get(userId)!;
      res.json({
        userId:     existing.userId,
        balanceUsd: existing.balanceUsd,
        portfolio:  existing.portfolio,
        trades:     existing.trades,
        createdAt:  existing.createdAt,
        note:       "Existing demo account returned — balance was not reset",
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
    accounts.set(userId, account);

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

    const account = accounts.get(userId.trim());
    if (!account) {
      res.status(404).json({ error: "Demo account not found — call POST /api/demo/initialize first" });
      return;
    }

    const totalUsd      = parseFloat((tokenAmount * tokenPrice).toFixed(6));
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

      // Seed the live price cache immediately so PnL is available before the next tick
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
      if (remaining === 0) {
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

  const account = accounts.get(userId.trim());
  if (!account) {
    res.status(404).json({ error: "Demo account not found" });
    return;
  }

  // ── Build live positions with unrealised PnL ───────────────────────────────
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

  // totalEquity = cash balance + current market value of all positions
  // (unrealizedPnl is already embedded in marketValue; adding it again would double-count)
  const totalMarketValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const totalEquity      = parseFloat((account.balanceUsd + totalMarketValue).toFixed(6));

  res.json({
    userId:            account.userId,
    balanceUsd:        account.balanceUsd,
    portfolio:         account.portfolio,
    positions,
    totalUnrealizedPnl: parseFloat(totalUnrealizedPnl.toFixed(6)),
    totalMarketValue:   parseFloat(totalMarketValue.toFixed(6)),
    totalEquity,
    trades:    account.trades,
    createdAt: account.createdAt,
  });
});
