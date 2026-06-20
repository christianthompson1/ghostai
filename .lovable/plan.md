# GHOST AI — Conversational Solana Intelligence Rebuild

Transform the current dashboard-style app into a ChatGPT-style conversational interface where Solana data (token cards, price charts, transaction decodes, market pulse) renders inline as rich frosted-glass components in the chat feed.

## 1. Secrets & Backend Auth Model

- Remove the user-managed `app_settings` table flow. `GEMINI_API_KEY` and `HELIUS_RPC_URL` will be stored as **Supabase Project Secrets** (server env) — I will request them via the secure secret tool (never in chat, never in code).
- All Solana/Gemini calls move into **Supabase Edge Functions** (`solana-chat`, `token-intel`, `tx-decode`, `market-pulse`, `price-history`) which read secrets from `Deno.env` using service-role context. The frontend invokes them via the Supabase client with the user's JWT for auth gating.
- Drop the existing `src/lib/solana.functions.ts` TanStack server-fn path (or thin it to a passthrough) since the user explicitly required Edge Functions.
- Drop the Settings page (no manual key input anymore).

## 2. Authentication

- Keep Supabase Email/Password.
- Add **Google Sign-In** via the Lovable-managed OAuth (`lovable.auth.signInWithOAuth("google", ...)`) and call `configure_social_auth` to enable the provider.
- `/auth` page gets a "Continue with Google" button styled as a glass pill, plus the email/password form.

## 3. Chat-First UI (replaces dashboard)

New route layout under `_authenticated`:
- `/` (chat) — main conversational interface.
- Left **sidebar**: prompt presets ("Audit token", "Decode tx", "Trending now", "Price chart"), conversation history list, new-chat button. Collapsible on mobile.
- Center **chat feed**: user bubbles + assistant messages that can embed rich cards.
- Bottom **input bar**: glass pill with textarea, send button, paste-address detection.

Install AI Elements primitives (`conversation`, `message`, `prompt-input`, `shimmer`, `tool`) and compose around them.

## 4. In-Chat Rich Components

Assistant messages render `parts[]`. Each tool result becomes a typed part rendered as a frosted card:
- **TokenIntelCard**: logo, name, symbol, supply, decimals, mint/freeze authority status, top-holder concentration bar, AI risk score (LOW/MED/HIGH) + reasoning. Powered by Helius DAS `getAsset` + `getTokenLargestAccounts`, summarized by Gemini 2.5 flash-lite.
- **PriceChartCard**: 7D / 30D toggle, rendered with `lightweight-charts`. Data via CoinGecko `market_chart` (free, no key) keyed by token symbol/contract; fallback error state if unmapped.
- **TxDecodeCard**: status pill, fee, programs touched, step-by-step plain-English explanation, failure reason if any. Powered by Helius Enhanced Transactions (`/v0/transactions`).
- **MarketPulseCard**: top movers, narrative summary, network slot/epoch. CoinGecko + Helius `getEpochInfo` + Gemini synthesis.
- **ErrorCard**: frosted red-tinted card with retry button (no mock fallback data).

Router classifier (in `solana-chat` edge fn) inspects the user's message:
- 32–44 char base58 → token-intel
- 64–88 char base58 → tx-decode
- "trending"/"pulse"/"market" → market-pulse
- "chart"/"price" + token ref → price-chart
- otherwise → plain Gemini chat reply

## 5. Liquid Glass Design System

Rewrite `src/styles.css` tokens & primitives to match the uploaded reference:
- Light: pure white base, translucent sky-blue (#00a2ff @ 12–20%) layers, soft pastel iridescent border-gradient (cyan→pink→peach), inner highlight + outer drop-shadow.
- Dark: obsidian `#06080d` base, neon cyan accents, same iridescent borders dimmed.
- New utility classes: `.glass`, `.glass-strong`, `.glass-pill`, `.glass-btn-primary` (gradient sky→violet glow), `.glass-btn-secondary`, `.glass-input`, `.glass-tab`, `.glass-toast`, `.iridescent-border`.
- Theme toggle in sidebar (persisted to `localStorage`, applied via `.dark` on `<html>`).
- All shadcn buttons/inputs re-skinned through these tokens (no per-component hex).

## 6. PWA

Manifest already exists; verify name "GHOST AI", icon, theme color `#00a2ff` (light) and ensure `display: standalone`. Add `apple-touch-icon` + iOS meta tags in `__root.tsx`. No service worker (manifest-only install).

## 7. Database

Add `conversations` and `messages` tables (user-scoped, RLS on `auth.uid()`):
- `conversations(id, user_id, title, created_at, updated_at)`
- `messages(id, conversation_id, role, parts jsonb, created_at)`

Standard GRANTs to `authenticated` + `service_role`. Drop old `app_settings` table.

## 8. File-Level Changes (technical detail)

**Remove/replace:**
- `src/routes/_authenticated/dashboard.tsx` → replace with `chat.tsx` (or convert `_authenticated/route.tsx` index)
- `src/routes/_authenticated/settings.tsx` → delete
- `src/lib/solana.functions.ts` → delete (logic moves to edge functions)

**Create:**
- `supabase/functions/solana-chat/index.ts` (router + Gemini)
- `supabase/functions/token-intel/index.ts`
- `supabase/functions/tx-decode/index.ts`
- `supabase/functions/market-pulse/index.ts`
- `supabase/functions/price-history/index.ts`
- `supabase/functions/_shared/cors.ts`, `helius.ts`, `gemini.ts`
- `src/routes/_authenticated/index.tsx` (chat shell)
- `src/components/chat/` — `ChatFeed.tsx`, `MessageBubble.tsx`, `PromptInput.tsx`, `Sidebar.tsx`, `ThemeToggle.tsx`
- `src/components/cards/` — `TokenIntelCard.tsx`, `PriceChartCard.tsx`, `TxDecodeCard.tsx`, `MarketPulseCard.tsx`, `ErrorCard.tsx`
- `src/hooks/useChat.ts`, `src/hooks/useTheme.ts`
- New migration for `conversations` + `messages` + drop `app_settings`

**Edit:**
- `src/routes/auth.tsx` — add Google button, restyle
- `src/routes/_authenticated/route.tsx` — sidebar + outlet layout
- `src/styles.css` — full token rewrite for both themes
- `src/routes/__root.tsx` — PWA/iOS head tags, theme bootstrap

## 9. Sequencing

1. Request `GEMINI_API_KEY` + `HELIUS_RPC_URL` as Supabase secrets (secure form).
2. Enable Google OAuth provider.
3. SQL migration (conversations/messages, drop app_settings).
4. Deploy edge functions.
5. Rewrite styles + build chat UI + cards + sidebar.
6. Add Google sign-in button to `/auth`.
7. Verify PWA manifest + theme toggle.

## What I'll Ask Before Coding

Just one confirmation: are you OK with me deleting the existing Settings/Dashboard pages and the user-managed `app_settings` table (since secrets now live server-side), and persisting your chat history in the database?
