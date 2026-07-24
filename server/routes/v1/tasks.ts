/**
 * Ghost AI — Core Protocol API  (/api/v1)
 *
 * Endpoints used by external AI agents, human workers, and the protocol
 * itself to create tasks, submit proofs, and release on-chain escrow.
 *
 * POST /api/v1/tasks/create   — Agent posts a new task
 * POST /api/v1/worker/submit  — Worker submits proof for verification
 * POST /api/v1/tasks/release  — Release locked escrow to worker wallet
 * GET  /api/v1/tasks/list     — List open tasks (filterable by min payout)
 * GET  /api/v1/tasks/:id      — Get task detail
 */

import { Router, type Request, type Response } from "express";
import { v4 as uuidv4 }  from "uuid";
import { supabase }       from "../../lib/supabase.js";
import { verifyProof }    from "../../lib/gemini.js";

export const tasksRouter = Router();

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_PAYOUT_USDC      = 0.05;    // protocol floor
const PLATFORM_FEE_PCT     = 0.10;    // 10 % platform fee
const GAS_ESTIMATE_SOL     = 0.001;   // ~0.001 SOL for rent + tx fees
const SOL_USD_ESTIMATE     = 150;     // used for gas → USD conversion in escrow calc

// ── Dev-mode agent (used when DB tables aren't yet provisioned) ────────────────

const DEV_AGENT_KEY = process.env.GHOST_DEV_AGENT_KEY ?? "ghost_dev_key_replace_in_production";
const DEV_AGENT     = { id: "dev-agent-00000000", wallet_address: "11111111111111111111111111111111" };

// ── Middleware: validate agent API key ────────────────────────────────────────

async function requireAgentKey(
  req:  Request,
  res:  Response,
  next: () => void,
): Promise<void> {
  const apiKey = (req.headers["x-agent-key"] as string | undefined)?.trim();
  if (!apiKey) {
    res.status(401).json({ error: "Missing X-Agent-Key header" });
    return;
  }

  // ── Dev bypass: skip DB if key matches the dev key ────────────────────────
  if (apiKey === DEV_AGENT_KEY) {
    (req as Request & { agent: typeof DEV_AGENT }).agent = DEV_AGENT;
    next();
    return;
  }

  // ── Production: look up key in Supabase agents table ─────────────────────
  try {
    const { data: agent, error } = await supabase
      .from("agents")
      .select("id, wallet_address")
      .eq("api_key", apiKey)
      .single();

    if (error || !agent) {
      // Distinguish "table missing" (DB not yet migrated) from "bad key"
      if (error?.message?.includes("relation") || error?.message?.includes("schema cache")) {
        res.status(503).json({
          error:   "Database not yet initialised — run the schema migration first",
          hint:    "Apply supabase/migrations/20260707000000_ghost_ai_protocol.sql via your Supabase dashboard or run: node --import tsx/esm server/scripts/apply-migration.ts",
          devKey:  "For testing, use X-Agent-Key: ghost_dev_key_replace_in_production",
        });
      } else {
        res.status(401).json({ error: "Invalid or unknown agent API key" });
      }
      return;
    }

    (req as Request & { agent: typeof agent }).agent = agent;
    next();
  } catch (err) {
    res.status(500).json({ error: "Auth check failed", detail: (err as Error).message });
  }
}

// ── POST /api/v1/tasks/create ─────────────────────────────────────────────────

/**
 * Body:
 *   title          string  — task title shown to workers
 *   rewardUsdc     number  — payout to the completing worker (must be >= $0.05)
 *   proofType      string  — "url" | "text" | "image_url" | "github_pr"
 *   instructions   string  — full task requirements the worker must satisfy
 *   irysMetaTxId?  string  — optional: pre-uploaded Irys metadata transaction ID
 *
 * Response:
 *   taskId, totalEscrowUsdc, platformFeeUsdc, gasEstimateSol, status
 */
tasksRouter.post("/tasks/create", requireAgentKey, async (req: Request, res: Response) => {
  try {
    const {
      title,
      rewardUsdc,
      proofType,
      instructions,
      irysMetaTxId,
    } = req.body as {
      title?:         string;
      rewardUsdc?:    unknown;
      proofType?:     string;
      instructions?:  string;
      irysMetaTxId?:  string;
    };

    // ── Validation ────────────────────────────────────────────────────────────
    if (!title || typeof title !== "string" || title.trim() === "") {
      res.status(400).json({ error: "'title' is required" }); return;
    }
    if (!instructions || typeof instructions !== "string" || instructions.trim() === "") {
      res.status(400).json({ error: "'instructions' is required" }); return;
    }

    const VALID_PROOF_TYPES = new Set(["url", "text", "image_url", "github_pr"]);
    if (!proofType || !VALID_PROOF_TYPES.has(proofType)) {
      res.status(400).json({
        error:  `'proofType' must be one of: ${[...VALID_PROOF_TYPES].join(", ")}`,
      }); return;
    }

    const payout = Number(rewardUsdc);
    if (!Number.isFinite(payout) || payout < MIN_PAYOUT_USDC) {
      res.status(422).json({
        error:          `Minimum payout is $${MIN_PAYOUT_USDC} USDC`,
        minimumPayout:  MIN_PAYOUT_USDC,
        receivedPayout: payout,
      }); return;
    }

    // ── Escrow calculation ────────────────────────────────────────────────────
    const platformFee     = parseFloat((payout * PLATFORM_FEE_PCT).toFixed(6));
    const gasUsd          = parseFloat((GAS_ESTIMATE_SOL * SOL_USD_ESTIMATE).toFixed(6));
    const totalEscrowUsdc = parseFloat((payout + platformFee + gasUsd).toFixed(6));

    const agentId = ((req as Request & { agent: { id: string } }).agent).id;
    const taskId  = uuidv4();

    // ── Persist to Supabase ───────────────────────────────────────────────────
    const { error: insertErr } = await supabase.from("tasks").insert({
      id:                taskId,
      agent_id:          agentId,
      irys_tx_id:        irysMetaTxId ?? null,
      escrow_address:    null,          // populated when on-chain escrow is funded
      payout_usdc:       payout,
      platform_fee_usdc: platformFee,
      gas_estimate_sol:  GAS_ESTIMATE_SOL,
      total_escrow_usdc: totalEscrowUsdc,
      title:             title.trim(),
      instructions:      instructions.trim(),
      proof_type:        proofType,
      status:            "open",
      worker_address:    null,
    });

    if (insertErr) {
      console.error("[Tasks/create] DB error:", insertErr.message);
      res.status(500).json({ error: "Failed to persist task", detail: insertErr.message });
      return;
    }

    res.status(201).json({
      taskId,
      title:             title.trim(),
      status:            "open",
      payoutUsdc:        payout,
      platformFeeUsdc:   platformFee,
      gasEstimateSol:    GAS_ESTIMATE_SOL,
      totalEscrowUsdc,
      proofType,
      irysMetaTxId:      irysMetaTxId ?? null,
      message:           "Task created. Fund the escrow address to activate it for workers.",
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/v1/worker/submit ────────────────────────────────────────────────

/**
 * Body:
 *   taskId         string  — the task to submit proof for
 *   workerAddress  string  — Solana wallet address of the submitting worker
 *   proofText      string  — the proof content (URL, text, etc.)
 *   irysHash?      string  — optional Irys transaction ID if proof stored on-chain
 *
 * Proof is passed to Gemini 2.5 Flash for automated quality scoring.
 * Score >= 70 → approved; < 70 → rejected with reasoning.
 */
tasksRouter.post("/worker/submit", async (req: Request, res: Response) => {
  try {
    const { taskId, workerAddress, proofText, irysHash } = req.body as {
      taskId?:        string;
      workerAddress?: string;
      proofText?:     string;
      irysHash?:      string;
    };

    if (!taskId)        { res.status(400).json({ error: "'taskId' is required" }); return; }
    if (!workerAddress) { res.status(400).json({ error: "'workerAddress' is required" }); return; }
    if (!proofText || proofText.trim() === "") {
      res.status(400).json({ error: "'proofText' is required" }); return;
    }

    // ── Fetch task ────────────────────────────────────────────────────────────
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, title, instructions, proof_type, status, payout_usdc")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) {
      res.status(404).json({ error: "Task not found" }); return;
    }
    if (task.status !== "open") {
      res.status(409).json({ error: `Task is not open (current status: ${task.status})` }); return;
    }

    // ── Gemini quality verification ───────────────────────────────────────────
    console.log(`[Tasks/submit] Verifying proof for task ${taskId} via Gemini…`);
    const verdict = await verifyProof(
      task.title,
      task.instructions,
      task.proof_type,
      proofText.trim(),
    );

    const submissionId     = uuidv4();
    const submissionStatus = verdict.approved ? "approved" : "rejected";

    // ── Persist submission ────────────────────────────────────────────────────
    const { error: subErr } = await supabase.from("submissions").insert({
      id:             submissionId,
      task_id:        taskId,
      worker_address: workerAddress,
      proof_text:     proofText.trim(),
      irys_hash:      irysHash ?? null,
      status:         submissionStatus,
      ai_verdict:     verdict.verdict,
      ai_score:       verdict.score,
    });

    if (subErr) {
      console.error("[Tasks/submit] DB error:", subErr.message);
      res.status(500).json({ error: "Failed to record submission", detail: subErr.message });
      return;
    }

    // ── Update task status if approved ────────────────────────────────────────
    if (verdict.approved) {
      await supabase
        .from("tasks")
        .update({ status: "submitted", worker_address: workerAddress })
        .eq("id", taskId);
    }

    res.status(201).json({
      submissionId,
      taskId,
      workerAddress,
      status:      submissionStatus,
      aiScore:     verdict.score,
      aiVerdict:   verdict.verdict,
      aiReasoning: verdict.reasoning,
      approved:    verdict.approved,
      message: verdict.approved
        ? "Proof approved. Call POST /api/v1/tasks/release to release escrow."
        : "Proof rejected — see aiReasoning for required improvements.",
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── POST /api/v1/tasks/release ────────────────────────────────────────────────

/**
 * Body:
 *   taskId         string  — task to release escrow for
 *   workerAddress  string  — wallet to receive the payout
 *
 * Verifies an approved submission exists, records the payout, and marks
 * the task as completed.  In production this would broadcast a Solana
 * transaction via @coral-xyz/anchor to release the on-chain escrow PDA.
 */
tasksRouter.post("/tasks/release", requireAgentKey, async (req: Request, res: Response) => {
  try {
    const { taskId, workerAddress } = req.body as {
      taskId?:        string;
      workerAddress?: string;
    };

    if (!taskId)        { res.status(400).json({ error: "'taskId' is required" }); return; }
    if (!workerAddress) { res.status(400).json({ error: "'workerAddress' is required" }); return; }

    // ── Verify task is in submitted state ──────────────────────────────────
    const { data: task } = await supabase
      .from("tasks")
      .select("id, status, payout_usdc, platform_fee_usdc, agent_id, worker_address")
      .eq("id", taskId)
      .single();

    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    if (task.status !== "submitted") {
      res.status(409).json({
        error: `Task cannot be released (status: ${task.status}). ` +
               "Task must have an approved submission first.",
      }); return;
    }
    if (task.worker_address && task.worker_address !== workerAddress) {
      res.status(403).json({ error: "Worker address does not match the approved submission" }); return;
    }

    // ── Verify approved submission exists ─────────────────────────────────
    const { data: submission } = await supabase
      .from("submissions")
      .select("id, ai_score, ai_verdict")
      .eq("task_id", taskId)
      .eq("worker_address", workerAddress)
      .eq("status", "approved")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!submission) {
      res.status(404).json({ error: "No approved submission found for this task and worker" });
      return;
    }

    // ── On-chain escrow release (production hook) ─────────────────────────
    // In production: build + send Anchor instruction to release the PDA escrow.
    // const txSig = await releaseEscrowPda(task.escrow_address, workerAddress, task.payout_usdc);
    const mockTxSig = `GH_${uuidv4().replace(/-/g, "").slice(0, 40).toUpperCase()}`;

    // ── Mark task completed ────────────────────────────────────────────────
    await supabase
      .from("tasks")
      .update({ status: "completed" })
      .eq("id", taskId);

    // ── Update worker reputation ───────────────────────────────────────────
    const { data: user } = await supabase
      .from("users")
      .select("id, reputation_score")
      .eq("wallet_address", workerAddress)
      .single();

    if (user) {
      await supabase
        .from("users")
        .update({ reputation_score: (user.reputation_score ?? 0) + 1 })
        .eq("id", user.id);
    }

    res.json({
      taskId,
      workerAddress,
      status:            "completed",
      payoutUsdc:        task.payout_usdc,
      platformFeeUsdc:   task.platform_fee_usdc,
      txSignature:       mockTxSig,
      aiScore:           submission.ai_score,
      message:           `$${task.payout_usdc} USDC released to ${workerAddress}`,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/v1/tasks/list ────────────────────────────────────────────────────

tasksRouter.get("/tasks/list", async (req: Request, res: Response) => {
  try {
    const {
      status   = "open",
      minPayout = String(MIN_PAYOUT_USDC),
      limit     = "20",
      offset    = "0",
    } = req.query as Record<string, string>;

    let query = supabase
      .from("tasks")
      .select("id, title, payout_usdc, platform_fee_usdc, total_escrow_usdc, proof_type, status, created_at")
      .eq("status", status)
      .gte("payout_usdc", parseFloat(minPayout))
      .order("created_at", { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    const { data: tasks, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }

    res.json({
      tasks:      tasks ?? [],
      count:      (tasks ?? []).length,
      minPayout:  parseFloat(minPayout),
      status,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── GET /api/v1/tasks/:id ─────────────────────────────────────────────────────

tasksRouter.get("/tasks/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { data: task, error } = await supabase
      .from("tasks")
      .select("*, submissions(id, worker_address, status, ai_score, ai_verdict, created_at)")
      .eq("id", id)
      .single();

    if (error || !task) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
