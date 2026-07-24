# Ghost AI

Conversational Solana intelligence terminal + AI-to-Human task marketplace built under the Ghost Protocol ecosystem.

## Stack

- **Frontend**: TanStack Start (React 19, TanStack Router, TanStack Query) + Vite 8 + Tailwind CSS 4
- **Auth / DB**: Supabase (project `gsvjgfcgwktfabkszkvq` via `SUPABASE_URL`)
- **UI**: shadcn/ui (Radix primitives), liquid-glass design system
- **Backend engine**: Express + TypeScript at `/server` (isolated, port 3001)
- **AI**: Google Gemini 2.5 Flash for proof quality verification
- **Blockchain**: Solana via Helius RPC (enhanced transaction parsing)
- **Telegram**: Telegraf bot at `server/bot.ts`
- **SDK**: Open-source TypeScript client at `/sdk`

## Running the project

### Frontend (port 5000)
```bash
npm run dev
```
Workflow: **Start application** — runs automatically.

### Backend server (port 3001)
```bash
cd server && node --import tsx/esm index.ts
```
Workflow: **Backend Server** — runs automatically.

### Telegram Bot (standalone)
```bash
cd server && node --import tsx/esm bot.ts
```

## Architecture rule

> All backend API endpoints, routes, and token calculations live **exclusively** in `/server`.  
> `/src` and `/public` are the Lovable-built frontend — do **not** modify them.

## /server layout

```
server/
├── index.ts              # Express entry (port 3001, CORS, middleware)
├── bot.ts                # Telegram bot (Telegraf) — run standalone
├── routes/
│   ├── api.ts            # Legacy market/demo/pumpfun sub-routers
│   ├── v1/               # Ghost AI Protocol API v1
│   │   ├── router.ts     # Mounts tasks + defi routers at /api/v1
│   │   ├── tasks.ts      # POST create/submit/release, GET list/:id
│   │   └── defi.ts       # POST staking/lending, GET yield/stats
│   ├── demo.ts           # Demo trading simulator (persistent JSON DB)
│   ├── market.ts         # OHLCV candles (CoinGecko + synthetic)
│   └── pumpfun.ts        # Live Pump.fun graduation tracker
├── lib/
│   ├── supabase.ts       # Supabase singleton client (ws transport)
│   ├── gemini.ts         # Gemini 2.5 Flash quality verification
│   ├── auto-trader.ts    # 5-minute AI trading engine
│   ├── candle-builder.ts # OHLCV: CoinGecko / pumpfun-live / synthetic
│   ├── db.ts             # Demo account JSON persistence
│   ├── sol-price.ts      # SOL/USD price (30s cache)
│   └── pumpportal-ws.ts  # PumpPortal WebSocket client
├── scripts/
│   └── apply-migration.ts # Apply Supabase schema via Management API
├── data/
│   └── demo-db.json      # Persistent demo account state
├── package.json
└── tsconfig.json
```

## /sdk layout

```
sdk/
├── src/
│   ├── client.ts    # GhostClient — main SDK export
│   └── types.ts     # TypeScript interfaces
├── examples/
│   └── post-task.ts # 5-line task creation example
├── package.json
├── tsconfig.json
└── README.md
```

## Protocol API v1 — Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET  | `/api/v1/` | — | Protocol directory |
| POST | `/api/v1/tasks/create` | `X-Agent-Key` | Post task (min $0.05 USDC) |
| POST | `/api/v1/worker/submit` | — | Submit proof (Gemini verified) |
| POST | `/api/v1/tasks/release` | `X-Agent-Key` | Release on-chain escrow |
| GET  | `/api/v1/tasks/list` | — | List open tasks |
| GET  | `/api/v1/tasks/:id` | — | Task detail + submissions |
| POST | `/api/v1/staking/deposit` | `userId` | Lock GHOST tokens for yield |
| POST | `/api/v1/lending/supply` | — | Deploy escrow to Kamino/Lulo |
| GET  | `/api/v1/yield/stats` | — | Protocol staking + yield stats |

## Supabase Schema Migration

The Ghost AI Protocol schema needs to be applied to Supabase once.

### Option A — Supabase Dashboard (recommended)
1. Go to your [Supabase SQL Editor](https://supabase.com/dashboard/project/gsvjgfcgwktfabkszkvq/sql)
2. Copy and paste: `supabase/migrations/20260707000000_ghost_ai_protocol.sql`
3. Click **Run**

### Option B — Management API script
```bash
# Get your access token at https://supabase.com/dashboard/account/tokens
SUPABASE_ACCESS_TOKEN=sbp_xxxx \
node --import tsx/esm server/scripts/apply-migration.ts
```

### Tables created
| Table | Purpose |
|---|---|
| `agents` | External AI agents with API keys |
| `users` | Human workers (Web3Auth + Telegram linked) |
| `tasks` | Marketplace tasks with USDC escrow |
| `submissions` | Worker proofs with Gemini AI scores |
| `stakes` | Locked GHOST tokens for yield |
| `lending_positions` | Idle escrow deployed to Kamino/Lulo |
| `tips` | P2P micro-tips between Telegram users |

## Environment variables

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` | Telegraf bot token from @BotFather |
| `GEMINI_API_KEY` | Google Gemini 2.5 Flash (proof verification) |
| `SUPABASE_URL` | Supabase project REST URL |
| `SUPABASE_ANON_KEYS` | Supabase anon/public key |
| `HELIUS_RPC_URL` | Helius enhanced Solana RPC |
| `SESSION_SECRET` | Session signing secret |
| `GHOST_DEV_AGENT_KEY` | Override dev agent key (default: `ghost_dev_key_replace_in_production`) |
| `TELEGRAM_NOTIFY_CHAT_ID` | Group chat ID for new-task push notifications |
| `GHOST_API_URL` | Ghost API base URL (used by bot + SDK) |

See `.env.example` for the full list with descriptions.

## User preferences

- Backend code must stay in `/server` — never bleed into `/src` or `/public`.
- Preserve the existing frontend exactly as Lovable built it.
- Use `node --import tsx/esm` (not `ts-node`) for all TypeScript execution.
- Demo account state persists in `server/data/demo-db.json` (gitignored).
