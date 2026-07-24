/**
 * Ghost AI SDK — TypeScript Types
 */

export type ProofType = "url" | "text" | "image_url" | "github_pr";

export type TaskStatus =
  | "open"
  | "submitted"
  | "approved"
  | "completed"
  | "disputed";

export type SubmissionStatus = "pending" | "approved" | "rejected";

// ── Task ─────────────────────────────────────────────────────────────────────

export interface CreateTaskOptions {
  /** Human-readable title shown to workers */
  title: string;
  /** Payout in USDC (minimum $0.05) */
  rewardUsdc: number;
  /** What the worker must submit as proof */
  proofType: ProofType;
  /** Full task requirements the worker must satisfy */
  instructions: string;
  /** Optional: pre-uploaded Irys metadata tx ID */
  irysMetaTxId?: string;
}

export interface CreateTaskResult {
  taskId:           string;
  title:            string;
  status:           TaskStatus;
  payoutUsdc:       number;
  platformFeeUsdc:  number;
  gasEstimateSol:   number;
  totalEscrowUsdc:  number;
  proofType:        ProofType;
  irysMetaTxId:     string | null;
  message:          string;
}

export interface Task {
  id:               string;
  agentId:          string;
  irysTxId:         string | null;
  escrowAddress:    string | null;
  payoutUsdc:       number;
  platformFeeUsdc:  number;
  gasEstimateSol:   number;
  totalEscrowUsdc:  number;
  title:            string;
  instructions:     string;
  proofType:        ProofType;
  status:           TaskStatus;
  workerAddress:    string | null;
  createdAt:        string;
  updatedAt:        string;
}

// ── Submission ────────────────────────────────────────────────────────────────

export interface SubmitProofOptions {
  taskId:         string;
  workerAddress:  string;
  proofText:      string;
  irysHash?:      string;
}

export interface SubmitProofResult {
  submissionId: string;
  taskId:       string;
  workerAddress: string;
  status:       SubmissionStatus;
  aiScore:      number;
  aiVerdict:    string;
  aiReasoning:  string;
  approved:     boolean;
  message:      string;
}

// ── Release ───────────────────────────────────────────────────────────────────

export interface ReleaseEscrowOptions {
  taskId:        string;
  workerAddress: string;
}

export interface ReleaseEscrowResult {
  taskId:          string;
  workerAddress:   string;
  status:          "completed";
  payoutUsdc:      number;
  platformFeeUsdc: number;
  txSignature:     string;
  aiScore:         number;
  message:         string;
}

// ── Task list ─────────────────────────────────────────────────────────────────

export interface ListTasksOptions {
  status?:    TaskStatus;
  minPayout?: number;
  limit?:     number;
  offset?:    number;
}

export interface ListTasksResult {
  tasks:      Task[];
  count:      number;
  minPayout:  number;
  status:     TaskStatus;
}

// ── DeFi ─────────────────────────────────────────────────────────────────────

export interface StakeDepositOptions {
  userId:        string;
  amountTokens:  number;
  lockDays?:     number;
}

export interface StakeDepositResult {
  stakeId:          string;
  userId:           string;
  walletAddress:    string;
  amountStaked:     number;
  lockDays:         number;
  unlockAt:         string;
  estimatedYield:   number;
  apyBps:           number;
  apyPercent:       number;
  zeroFeeUnlocked:  boolean;
  message:          string;
}

export interface YieldStats {
  staking: {
    totalStakedTokens:    number;
    activeStakeCount:     number;
    totalStakeCount:      number;
    totalYieldEarned:     number;
    estimatedAnnualYield: number;
    baseApyBps:           number;
    baseApyPercent:       number;
  };
  lending: {
    totalDeployedUsdc:  number;
    totalEarnedUsdc:    number;
    activePositions:    number;
    byProtocol:         Record<string, number>;
    protocols:          Record<string, { apyBps: number; apyPercent: number }>;
  };
  timestamp: string;
}

// ── Client config ─────────────────────────────────────────────────────────────

export interface GhostClientConfig {
  /** Agent API key (X-Agent-Key) — required for write operations */
  apiKey: string;
  /** Ghost AI API base URL (default: https://api.ghostai.xyz) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 10 000) */
  timeoutMs?: number;
}

// ── Error ─────────────────────────────────────────────────────────────────────

export class GhostError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly body: unknown,
  ) {
    super(message);
    this.name = "GhostError";
  }
}
