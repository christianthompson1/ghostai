-- ============================================================================
-- Ghost AI Protocol — Database Schema Migration
-- Version: 2026-07-07
-- Description: Core tables for the Ghost AI AI-to-Human task marketplace
-- ============================================================================

-- ── Extensions ────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Enums ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE task_status       AS ENUM ('open', 'submitted', 'approved', 'completed', 'disputed');
  CREATE TYPE submission_status AS ENUM ('pending', 'approved', 'rejected');
  CREATE TYPE proof_type_enum   AS ENUM ('url', 'text', 'image_url', 'github_pr');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Helper: auto-update updated_at ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- ── Table: agents ─────────────────────────────────────────────────────────────
-- External AI agents that post tasks onto the marketplace.
-- Each agent is identified by an API key (passed as X-Agent-Key header).

CREATE TABLE IF NOT EXISTS public.agents (
  id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key        TEXT        NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  wallet_address TEXT        NOT NULL,         -- Solana wallet that funds escrow
  name           TEXT,                         -- optional agent display name
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  total_tasks    INTEGER     NOT NULL DEFAULT 0,
  total_paid_usdc NUMERIC(18, 6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agents_api_key_idx ON public.agents (api_key);

CREATE TRIGGER agents_touch_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Table: users ──────────────────────────────────────────────────────────────
-- Human workers and platform participants.
-- Linked to Web3Auth (web3auth_id) and/or Telegram (telegram_id).

CREATE TABLE IF NOT EXISTS public.users (
  id               UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  web3auth_id      TEXT        UNIQUE,          -- Web3Auth sub claim
  telegram_id      TEXT        UNIQUE,          -- Telegram username (without @)
  wallet_address   TEXT        NOT NULL UNIQUE, -- Solana wallet for payouts
  reputation_score INTEGER     NOT NULL DEFAULT 0,
  tasks_completed  INTEGER     NOT NULL DEFAULT 0,
  total_earned_usdc NUMERIC(18, 6) NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_wallet_idx     ON public.users (wallet_address);
CREATE INDEX IF NOT EXISTS users_telegram_idx   ON public.users (telegram_id);
CREATE INDEX IF NOT EXISTS users_web3auth_idx   ON public.users (web3auth_id);

CREATE TRIGGER users_touch_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Table: tasks ──────────────────────────────────────────────────────────────
-- Tasks posted by AI agents.  Each task holds a USDC escrow that is
-- released to the worker upon approval.

CREATE TABLE IF NOT EXISTS public.tasks (
  id                UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id          UUID           NOT NULL REFERENCES public.agents (id) ON DELETE RESTRICT,
  irys_tx_id        TEXT,                       -- Irys/Arweave metadata storage tx
  escrow_address    TEXT,                        -- Solana PDA or escrow account
  payout_usdc       NUMERIC(18, 6) NOT NULL CHECK (payout_usdc >= 0.05),
  platform_fee_usdc NUMERIC(18, 6) NOT NULL DEFAULT 0,
  gas_estimate_sol  NUMERIC(18, 9) NOT NULL DEFAULT 0.001,
  total_escrow_usdc NUMERIC(18, 6) NOT NULL DEFAULT 0,
  title             TEXT           NOT NULL,
  instructions      TEXT           NOT NULL,
  proof_type        TEXT           NOT NULL DEFAULT 'text',
  status            task_status    NOT NULL DEFAULT 'open',
  worker_address    TEXT,                        -- set when submission approved
  created_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tasks_status_idx      ON public.tasks (status);
CREATE INDEX IF NOT EXISTS tasks_agent_idx       ON public.tasks (agent_id);
CREATE INDEX IF NOT EXISTS tasks_payout_idx      ON public.tasks (payout_usdc);
CREATE INDEX IF NOT EXISTS tasks_created_at_idx  ON public.tasks (created_at DESC);

CREATE TRIGGER tasks_touch_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Table: submissions ────────────────────────────────────────────────────────
-- Worker proof submissions.  Each submission is passed through Gemini 2.5 Flash
-- for automated quality scoring (ai_score) before approval.

CREATE TABLE IF NOT EXISTS public.submissions (
  id             UUID              PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id        UUID              NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  worker_address TEXT              NOT NULL,
  proof_text     TEXT              NOT NULL,
  irys_hash      TEXT,                          -- optional on-chain proof storage
  status         submission_status NOT NULL DEFAULT 'pending',
  ai_verdict     TEXT,                          -- Gemini one-line verdict
  ai_score       INTEGER CHECK (ai_score BETWEEN 0 AND 100),
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submissions_task_idx    ON public.submissions (task_id);
CREATE INDEX IF NOT EXISTS submissions_worker_idx  ON public.submissions (worker_address);
CREATE INDEX IF NOT EXISTS submissions_status_idx  ON public.submissions (status);

-- ── Table: stakes ─────────────────────────────────────────────────────────────
-- Users lock GHOST tokens for yield rewards and 0% trading fee tier.

CREATE TABLE IF NOT EXISTS public.stakes (
  id               UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID           NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  amount_staked    NUMERIC(18, 6) NOT NULL CHECK (amount_staked > 0),
  unlock_timestamp TIMESTAMPTZ    NOT NULL,
  yield_earned     NUMERIC(18, 6) NOT NULL DEFAULT 0,
  is_active        BOOLEAN        NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stakes_user_idx    ON public.stakes (user_id);
CREATE INDEX IF NOT EXISTS stakes_unlock_idx  ON public.stakes (unlock_timestamp);

-- ── Table: lending_positions ──────────────────────────────────────────────────
-- Idle escrow USDC deployed to Kamino/Lulo for yield while tasks are open.

CREATE TABLE IF NOT EXISTS public.lending_positions (
  id            UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id       UUID           NOT NULL REFERENCES public.tasks (id) ON DELETE CASCADE,
  protocol      TEXT           NOT NULL CHECK (protocol IN ('kamino', 'lulo')),
  amount_usdc   NUMERIC(18, 6) NOT NULL CHECK (amount_usdc > 0),
  apy_bps       INTEGER        NOT NULL CHECK (apy_bps >= 0),
  earned_usdc   NUMERIC(18, 6) NOT NULL DEFAULT 0,
  deposited_at  TIMESTAMPTZ    NOT NULL DEFAULT now(),
  withdrawn_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS lending_task_idx ON public.lending_positions (task_id);

-- ── Table: tips ───────────────────────────────────────────────────────────────
-- Peer-to-peer micro-tips between Telegram users.

CREATE TABLE IF NOT EXISTS public.tips (
  id              UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_telegram TEXT           NOT NULL,
  receiver_telegram TEXT         NOT NULL,
  amount_usdc     NUMERIC(18, 6) NOT NULL CHECK (amount_usdc >= 0.01),
  tx_signature    TEXT,                          -- Solana transaction signature
  created_at      TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tips_sender_idx   ON public.tips (sender_telegram);
CREATE INDEX IF NOT EXISTS tips_receiver_idx ON public.tips (receiver_telegram);

-- ── Row Level Security ────────────────────────────────────────────────────────
-- Minimal RLS: all tables readable by anon (marketplace is public).
-- Writes are gated by API key or auth session in application logic.

ALTER TABLE public.agents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stakes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lending_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tips              ENABLE ROW LEVEL SECURITY;

-- Public read access for marketplace browsing
CREATE POLICY "tasks_public_read"       ON public.tasks       FOR SELECT USING (true);
CREATE POLICY "submissions_public_read" ON public.submissions FOR SELECT USING (true);
CREATE POLICY "users_public_read"       ON public.users       FOR SELECT USING (true);

-- Service role has full access (used by backend API)
CREATE POLICY "agents_service_all"            ON public.agents            FOR ALL USING (true);
CREATE POLICY "users_service_all"             ON public.users             FOR ALL USING (true);
CREATE POLICY "tasks_service_all"             ON public.tasks             FOR ALL USING (true);
CREATE POLICY "submissions_service_all"       ON public.submissions       FOR ALL USING (true);
CREATE POLICY "stakes_service_all"            ON public.stakes            FOR ALL USING (true);
CREATE POLICY "lending_positions_service_all" ON public.lending_positions FOR ALL USING (true);
CREATE POLICY "tips_service_all"              ON public.tips              FOR ALL USING (true);

-- ── Grants ────────────────────────────────────────────────────────────────────

GRANT SELECT ON public.tasks        TO anon, authenticated;
GRANT SELECT ON public.submissions  TO anon, authenticated;
GRANT SELECT ON public.users        TO anon, authenticated;
GRANT ALL    ON public.agents            TO service_role;
GRANT ALL    ON public.users             TO service_role;
GRANT ALL    ON public.tasks             TO service_role;
GRANT ALL    ON public.submissions       TO service_role;
GRANT ALL    ON public.stakes            TO service_role;
GRANT ALL    ON public.lending_positions TO service_role;
GRANT ALL    ON public.tips              TO service_role;

-- ── Seed: default demo agent ──────────────────────────────────────────────────
-- A placeholder agent so the API can be tested immediately.

INSERT INTO public.agents (id, api_key, wallet_address, name)
VALUES (
  uuid_generate_v4(),
  'ghost_dev_key_replace_in_production',
  '11111111111111111111111111111111',
  'Ghost AI Dev Agent'
)
ON CONFLICT (api_key) DO NOTHING;
