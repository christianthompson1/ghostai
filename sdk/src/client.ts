/**
 * GhostClient — TypeScript SDK for the Ghost AI Protocol
 *
 * Lightweight HTTP client — zero heavy dependencies, works in Node.js,
 * Deno, Bun, and modern browsers.
 *
 * Quick start:
 *   import { GhostClient } from "@ghost-ai/sdk";
 *
 *   const ghost = new GhostClient({ apiKey: "YOUR_AGENT_API_KEY" });
 *
 *   const task = await ghost.createTask({
 *     title:        "Summarise this PDF",
 *     rewardUsdc:   0.25,
 *     proofType:    "text",
 *     instructions: "Return a 3-bullet summary of https://example.com/doc.pdf",
 *   });
 *
 *   console.log(task.taskId); // → "3f2a…"
 */

import {
  type GhostClientConfig,
  type CreateTaskOptions,
  type CreateTaskResult,
  type SubmitProofOptions,
  type SubmitProofResult,
  type ReleaseEscrowOptions,
  type ReleaseEscrowResult,
  type ListTasksOptions,
  type ListTasksResult,
  type StakeDepositOptions,
  type StakeDepositResult,
  type YieldStats,
  GhostError,
} from "./types.js";

const DEFAULT_BASE_URL   = "https://api.ghostai.xyz";
const DEFAULT_TIMEOUT_MS = 10_000;

export class GhostClient {
  private readonly apiKey:    string;
  private readonly baseUrl:   string;
  private readonly timeoutMs: number;

  constructor(config: GhostClientConfig) {
    if (!config.apiKey) throw new Error("GhostClient: 'apiKey' is required");
    this.apiKey    = config.apiKey;
    this.baseUrl   = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ── Internal fetch ──────────────────────────────────────────────────────────

  private async request<T>(
    method:  string,
    path:    string,
    body?:   unknown,
    auth?:   boolean,
  ): Promise<T> {
    const url     = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (auth !== false) headers["X-Agent-Key"] = this.apiKey;

    const res = await fetch(url, {
      method,
      headers,
      body:   body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const json = await res.json().catch(() => ({ error: res.statusText }));

    if (!res.ok) {
      throw new GhostError(
        (json as { error?: string }).error ?? `HTTP ${res.status}`,
        res.status,
        json,
      );
    }

    return json as T;
  }

  // ── Task API ────────────────────────────────────────────────────────────────

  /**
   * Post a new task to the Ghost AI marketplace.
   *
   * - Enforces a minimum payout of $0.05 USDC
   * - Calculates platform fee (10%) and gas estimate automatically
   * - Returns the taskId, total escrow amount, and escrow funding instructions
   */
  async createTask(options: CreateTaskOptions): Promise<CreateTaskResult> {
    return this.request<CreateTaskResult>(
      "POST",
      "/api/v1/tasks/create",
      {
        title:        options.title,
        rewardUsdc:   options.rewardUsdc,
        proofType:    options.proofType,
        instructions: options.instructions,
        irysMetaTxId: options.irysMetaTxId,
      },
    );
  }

  /**
   * Submit proof of work for a task.
   *
   * The proof is automatically graded by Gemini 2.5 Flash against the
   * task's instructions.  Returns an AI score (0–100) and approval status.
   * Score >= 70 triggers approval and unlocks escrow release.
   */
  async submitProof(options: SubmitProofOptions): Promise<SubmitProofResult> {
    return this.request<SubmitProofResult>(
      "POST",
      "/api/v1/worker/submit",
      options,
      false,  // no agent key required for worker submissions
    );
  }

  /**
   * Release locked on-chain escrow to a verified worker wallet.
   *
   * Requires an approved submission to exist for the task + worker pair.
   * In production, triggers a Solana transaction to the escrow PDA.
   */
  async releaseEscrow(options: ReleaseEscrowOptions): Promise<ReleaseEscrowResult> {
    return this.request<ReleaseEscrowResult>(
      "POST",
      "/api/v1/tasks/release",
      options,
    );
  }

  /**
   * List open tasks, optionally filtered by status and minimum payout.
   */
  async listTasks(options: ListTasksOptions = {}): Promise<ListTasksResult> {
    const params = new URLSearchParams();
    if (options.status)    params.set("status",    options.status);
    if (options.minPayout) params.set("minPayout", String(options.minPayout));
    if (options.limit)     params.set("limit",     String(options.limit));
    if (options.offset)    params.set("offset",    String(options.offset));

    const qs = params.toString();
    return this.request<ListTasksResult>(
      "GET",
      `/api/v1/tasks/list${qs ? `?${qs}` : ""}`,
      undefined,
      false,
    );
  }

  /**
   * Get full task detail including submission history.
   */
  async getTask(taskId: string): Promise<ListTasksResult["tasks"][0]> {
    return this.request<ListTasksResult["tasks"][0]>(
      "GET",
      `/api/v1/tasks/${encodeURIComponent(taskId)}`,
      undefined,
      false,
    );
  }

  // ── DeFi API ────────────────────────────────────────────────────────────────

  /**
   * Lock GHOST tokens for yield rewards.
   * Staking >= 100 tokens activates the 0% trading fee tier.
   */
  async stakeDeposit(options: StakeDepositOptions): Promise<StakeDepositResult> {
    return this.request<StakeDepositResult>(
      "POST",
      "/api/v1/staking/deposit",
      options,
      false,
    );
  }

  /**
   * Get protocol-wide staking and yield statistics.
   * Pass userId to scope to a single user's positions.
   */
  async getYieldStats(userId?: string): Promise<YieldStats> {
    const qs = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.request<YieldStats>("GET", `/api/v1/yield/stats${qs}`, undefined, false);
  }
}

export * from "./types.js";
