/**
 * Ghost AI — Supabase Client Singleton
 *
 * Initialised once at module load; re-used by all route handlers.
 * Uses the ANON key for standard Row Level Security enforcement.
 * For privileged operations (e.g. bypassing RLS in server-side flows),
 * swap to the SERVICE_ROLE key via createClient(url, serviceKey).
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const SUPABASE_URL      = process.env.SUPABASE_URL      ?? "";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEYS ?? "";  // env var name as provisioned

function makeClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn("[Supabase] SUPABASE_URL / SUPABASE_ANON_KEYS not set — DB calls will fail");
  }
  return createClient(SUPABASE_URL || "https://placeholder.supabase.co", SUPABASE_ANON_KEY || "placeholder", {
    auth:     { persistSession: false },
    realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
  });
}

export const supabase: SupabaseClient = makeClient();

if (SUPABASE_URL) console.log("[Supabase] Client initialised →", SUPABASE_URL);

// ── Typed helpers ─────────────────────────────────────────────────────────────

export type TaskStatus       = "open" | "submitted" | "approved" | "completed" | "disputed";
export type SubmissionStatus = "pending" | "approved" | "rejected";

export interface Agent {
  id:             string;
  api_key:        string;
  wallet_address: string;
  created_at:     string;
}

export interface GhostUser {
  id:               string;
  web3auth_id:      string | null;
  telegram_id:      string | null;
  wallet_address:   string;
  reputation_score: number;
  created_at:       string;
}

export interface Task {
  id:               string;
  agent_id:         string;
  irys_tx_id:       string | null;
  escrow_address:   string | null;
  payout_usdc:      number;
  platform_fee_usdc: number;
  gas_estimate_sol: number;
  total_escrow_usdc: number;
  title:            string;
  instructions:     string;
  proof_type:       string;
  status:           TaskStatus;
  worker_address:   string | null;
  created_at:       string;
  updated_at:       string;
}

export interface Submission {
  id:             string;
  task_id:        string;
  worker_address: string;
  proof_text:     string;
  irys_hash:      string | null;
  status:         SubmissionStatus;
  ai_verdict:     string | null;
  ai_score:       number | null;
  created_at:     string;
}

export interface Stake {
  id:               string;
  user_id:          string;
  amount_staked:    number;
  unlock_timestamp: string;
  yield_earned:     number;
  created_at:       string;
}

export interface LendingPosition {
  id:            string;
  task_id:       string;
  protocol:      string;
  amount_usdc:   number;
  apy_bps:       number;
  earned_usdc:   number;
  deposited_at:  string;
  withdrawn_at:  string | null;
}
