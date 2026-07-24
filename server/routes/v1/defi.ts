/**
 * Ghost AI — DeFi Endpoints  (/api/v1/defi)
 *
 * Staking / Yield / Lending routes that connect the protocol treasury
 * to background DeFi protocols (Kamino / Lulo) for yield generation on
 * idle escrow funds.
 *
 * POST /api/v1/staking/deposit   — Lock protocol tokens for yield + 0% fee tier
 * POST /api/v1/lending/supply    — Route escrow capital to Kamino/Lulo
 * GET  /api/v1/yield/stats       — Protocol-wide staking balances + earned yield
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { supabase }      from "../../lib/supabase.js";

export const defiRouter = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const STAKING_BASE_APY_BPS  = 1200;  // 12 % baseline APY (in basis points)
const KAMINO_APY_BPS        = 800;   // 8 % from Kamino USDC supply
const LULO_APY_BPS          = 1100;  // 11 % from Lulo auto-routing
const MIN_STAKE_AMOUNT      = 1;     // 1 GHOST token minimum
const DEFAULT_LOCK_DAYS     = 30;    // default lock period for staking

// ── POST /api/v1/staking/deposit ──────────────────────────────────────────────

/**
 * Lock project tokens for yield rewards and 0% trading fee tier.
 *
 * Body:
 *   userId        string  — ghost user ID
 *   amountTokens  number  — quantity of GHOST tokens to stake
 *   lockDays?     number  — optional lock period (default 30 days)
 *
 * Effects:
 *   - Creates a `stakes` record with unlock_timestamp
 *   - Yields compound at STAKING_BASE_APY_BPS per year
 *   - Users staking >= 100 tokens get 0% trading fee tier
 */
defiRouter.post("/staking/deposit", async (req: Request, res: Response) => {
  try {
    const { userId, amountTokens, lockDays } = req.body as {
      userId?:       string;
      amountTokens?: unknown;
      lockDays?:     unknown;
    };

    if (!userId) { res.status(400).json({ error: "'userId' is required" }); return; }

    const amount   = Number(amountTokens);
    const lockDuration = Math.max(1, Math.min(365, Number(lockDays) || DEFAULT_LOCK_DAYS));

    if (!Number.isFinite(amount) || amount < MIN_STAKE_AMOUNT) {
      res.status(422).json({
        error:         `Minimum stake is ${MIN_STAKE_AMOUNT} GHOST token`,
        minimumAmount: MIN_STAKE_AMOUNT,
      }); return;
    }

    // Verify user exists
    const { data: user, error: userErr } = await supabase
      .from("users")
      .select("id, wallet_address")
      .eq("id", userId)
      .single();

    if (userErr || !user) { res.status(404).json({ error: "User not found" }); return; }

    // Calculate unlock timestamp
    const unlockDate = new Date();
    unlockDate.setDate(unlockDate.getDate() + lockDuration);

    const stakeId = uuidv4();
    const { error: insertErr } = await supabase.from("stakes").insert({
      id:               stakeId,
      user_id:          userId,
      amount_staked:    amount,
      unlock_timestamp: unlockDate.toISOString(),
      yield_earned:     0,
    });

    if (insertErr) {
      res.status(500).json({ error: "Failed to record stake", detail: insertErr.message }); return;
    }

    const yearlyYield = (amount * STAKING_BASE_APY_BPS) / 10_000;
    const periodYield = parseFloat(((yearlyYield * lockDuration) / 365).toFixed(6));
    const feeZero     = amount >= 100;

    res.status(201).json({
      stakeId,
      userId,
      walletAddress:    user.wallet_address,
      amountStaked:     amount,
      lockDays:         lockDuration,
      unlockAt:         unlockDate.toISOString(),
      estimatedYield:   periodYield,
      apyBps:           STAKING_BASE_APY_BPS,
      apyPercent:       STAKING_BASE_APY_BPS / 100,
      zeroFeeUnlocked:  feeZero,
      message: feeZero
        ? `Staked ${amount} GHOST — 0% trading fee tier activated for ${lockDuration} days.`
        : `Staked ${amount} GHOST — stake >= 100 tokens to activate 0% fee tier.`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/v1/lending/supply ───────────────────────────────────────────────

/**
 * Route idle escrow funds from an open task into a yield protocol.
 *
 * Body:
 *   taskId    string  — the open task whose idle USDC to deploy
 *   protocol  string  — "kamino" | "lulo" (default: auto-select highest APY)
 *
 * In production this would call the Kamino or Lulo program via Anchor.
 * The position is tracked in `lending_positions` so interest can be
 * unwound when the task is completed or disputed.
 */
defiRouter.post("/lending/supply", async (req: Request, res: Response) => {
  try {
    const { taskId, protocol: requestedProtocol } = req.body as {
      taskId?:   string;
      protocol?: string;
    };

    if (!taskId) { res.status(400).json({ error: "'taskId' is required" }); return; }

    const protocol = requestedProtocol === "kamino" ? "kamino" : "lulo";
    const apyBps   = protocol === "kamino" ? KAMINO_APY_BPS : LULO_APY_BPS;

    // Fetch task to get USDC amount
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, total_escrow_usdc, status, payout_usdc")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) { res.status(404).json({ error: "Task not found" }); return; }
    if (task.status !== "open") {
      res.status(409).json({ error: `Task escrow is not deployable (status: ${task.status})` }); return;
    }

    const positionId = uuidv4();

    // Check for existing position
    const { data: existing } = await supabase
      .from("lending_positions")
      .select("id")
      .eq("task_id", taskId)
      .is("withdrawn_at", null)
      .single();

    if (existing) {
      res.status(409).json({ error: "This task already has an active lending position" }); return;
    }

    const { error: insertErr } = await supabase.from("lending_positions").insert({
      id:           positionId,
      task_id:      taskId,
      protocol,
      amount_usdc:  task.total_escrow_usdc,
      apy_bps:      apyBps,
      earned_usdc:  0,
      deposited_at: new Date().toISOString(),
      withdrawn_at: null,
    });

    if (insertErr) {
      res.status(500).json({ error: "Failed to record lending position", detail: insertErr.message }); return;
    }

    const dailyYield = parseFloat(
      ((task.total_escrow_usdc * apyBps) / 10_000 / 365).toFixed(6)
    );

    res.status(201).json({
      positionId,
      taskId,
      protocol,
      amountUsdc:   task.total_escrow_usdc,
      apyBps,
      apyPercent:   apyBps / 100,
      estimatedDailyYieldUsdc: dailyYield,
      message: `$${task.total_escrow_usdc} USDC deployed to ${protocol.toUpperCase()} at ${apyBps / 100}% APY`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/v1/yield/stats ───────────────────────────────────────────────────

/**
 * Protocol-wide staking and yield statistics.
 * Aggregates all active stakes, lending positions, and earned yield.
 *
 * Optional query: ?userId=<id>  — scope to a single user
 */
defiRouter.get("/yield/stats", async (req: Request, res: Response) => {
  try {
    const { userId } = req.query as { userId?: string };

    // ── Staking stats ─────────────────────────────────────────────────────────
    let stakingQuery = supabase
      .from("stakes")
      .select("amount_staked, yield_earned, unlock_timestamp");
    if (userId) stakingQuery = stakingQuery.eq("user_id", userId);
    const { data: stakes } = await stakingQuery;

    const totalStaked       = (stakes ?? []).reduce((s, r) => s + (r.amount_staked ?? 0), 0);
    const totalYieldEarned  = (stakes ?? []).reduce((s, r) => s + (r.yield_earned ?? 0), 0);
    const activeStakes      = (stakes ?? []).filter(s => new Date(s.unlock_timestamp) > new Date());
    const estAnnualYield    = parseFloat(((totalStaked * STAKING_BASE_APY_BPS) / 10_000).toFixed(4));

    // ── Lending stats ─────────────────────────────────────────────────────────
    let lendingQuery = supabase
      .from("lending_positions")
      .select("amount_usdc, apy_bps, earned_usdc, protocol")
      .is("withdrawn_at", null);
    const { data: positions } = await lendingQuery;

    const totalDeployed     = (positions ?? []).reduce((s, r) => s + (r.amount_usdc ?? 0), 0);
    const totalEarnedUsdc   = (positions ?? []).reduce((s, r) => s + (r.earned_usdc ?? 0), 0);
    const byProtocol        = (positions ?? []).reduce<Record<string, number>>((acc, p) => {
      acc[p.protocol] = (acc[p.protocol] ?? 0) + p.amount_usdc;
      return acc;
    }, {});

    res.json({
      staking: {
        totalStakedTokens:   parseFloat(totalStaked.toFixed(4)),
        activeStakeCount:    activeStakes.length,
        totalStakeCount:     (stakes ?? []).length,
        totalYieldEarned:    parseFloat(totalYieldEarned.toFixed(6)),
        estimatedAnnualYield: estAnnualYield,
        baseApyBps:          STAKING_BASE_APY_BPS,
        baseApyPercent:      STAKING_BASE_APY_BPS / 100,
      },
      lending: {
        totalDeployedUsdc:   parseFloat(totalDeployed.toFixed(4)),
        totalEarnedUsdc:     parseFloat(totalEarnedUsdc.toFixed(6)),
        activePositions:     (positions ?? []).length,
        byProtocol,
        protocols: {
          kamino: { apyBps: KAMINO_APY_BPS, apyPercent: KAMINO_APY_BPS / 100 },
          lulo:   { apyBps: LULO_APY_BPS,   apyPercent: LULO_APY_BPS   / 100 },
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
