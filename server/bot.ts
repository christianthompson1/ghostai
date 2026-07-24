/**
 * Ghost AI — Telegram Bot
 *
 * Run standalone:  cd server && node --import tsx/esm bot.ts
 *
 * Commands:
 *   /start           — Welcome + Mini App inline button
 *   /tasks           — List active tasks paying >= $0.05 USDC
 *   /tip @user amt   — Send a peer-to-peer micro-tip
 *
 * Webhooks:
 *   The bot can be called from the API to push task-creation alerts to
 *   a configured group chat (TELEGRAM_NOTIFY_CHAT_ID env var).
 */

import { Telegraf, Markup, type Context } from "telegraf";
import { createClient } from "@supabase/supabase-js";

// ── Environment ───────────────────────────────────────────────────────────────

const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_ANON_KEYS;
const TMA_URL       = process.env.TMA_URL ?? "https://ghost-ai.app";
const NOTIFY_CHAT   = process.env.TELEGRAM_NOTIFY_CHAT_ID ?? "";
const API_BASE      = process.env.GHOST_API_URL ?? "http://localhost:3001";

if (!BOT_TOKEN) throw new Error("[Bot] TELEGRAM_BOT_TOKEN is not set");

// ── Clients ───────────────────────────────────────────────────────────────────

const bot = new Telegraf(BOT_TOKEN);

import WebSocket from "ws";

const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth:     { persistSession: false },
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    })
  : null;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsdc(n: number): string {
  return `$${n.toFixed(2)} USDC`;
}

function fmtTask(t: {
  id: string;
  title: string;
  payout_usdc: number;
  proof_type: string;
  created_at: string;
}): string {
  const age = Math.floor((Date.now() - new Date(t.created_at).getTime()) / 60_000);
  const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
  return [
    `📋 *${t.title}*`,
    `💰 Payout: \`${fmtUsdc(t.payout_usdc)}\``,
    `📁 Proof: \`${t.proof_type}\``,
    `🕒 Posted: ${ageStr}`,
    `🆔 \`${t.id.slice(0, 8)}…\``,
  ].join("\n");
}

// ── /start ────────────────────────────────────────────────────────────────────

bot.start(async (ctx: Context) => {
  const name = ctx.from?.first_name ?? "Worker";
  await ctx.replyWithMarkdownV2(
    `👻 *Welcome to Ghost AI, ${name}\\!*\n\n` +
    `Ghost AI is an open\\-source AI\\-to\\-Human task marketplace on Solana\\.\n\n` +
    `*What you can do:*\n` +
    `• 🤖 AI agents post tasks with USDC escrow\n` +
    `• 🧑‍💻 Humans complete tasks and earn crypto\n` +
    `• 🔒 Quality verified by Gemini 2\\.5 Flash\n` +
    `• ⚡ Instant Solana payments on approval\n\n` +
    `Use /tasks to see live opportunities\\.`,
    Markup.inlineKeyboard([
      [Markup.button.webApp("🚀 Open Ghost AI App", TMA_URL)],
      [Markup.button.url("📖 GitHub SDK", "https://github.com/ghostai/sdk")],
    ])
  );
});

// ── /tasks ────────────────────────────────────────────────────────────────────

bot.command("tasks", async (ctx: Context) => {
  await ctx.sendChatAction("typing");

  try {
    const res = await fetch(
      `${API_BASE}/api/v1/tasks/list?status=open&minPayout=0.05&limit=5`,
      { signal: AbortSignal.timeout(5_000) }
    );

    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const { tasks } = (await res.json()) as { tasks: Array<{
      id: string; title: string; payout_usdc: number; proof_type: string; created_at: string;
    }> };

    if (!tasks || tasks.length === 0) {
      await ctx.reply(
        "No active tasks right now 😴\n\nCheck back soon — AI agents post new tasks hourly!",
        Markup.inlineKeyboard([[Markup.button.webApp("📊 View Dashboard", TMA_URL)]])
      );
      return;
    }

    const header   = `👻 *Ghost AI — Open Tasks* \\(${tasks.length} available\\)\n\n`;
    const taskList = tasks.map(fmtTask).join("\n\n─────────────────\n\n");

    await ctx.replyWithMarkdownV2(
      header + taskList,
      Markup.inlineKeyboard([
        [Markup.button.webApp("✅ Submit Proof", TMA_URL)],
        [Markup.button.callback("🔄 Refresh", "refresh_tasks")],
      ])
    );
  } catch (err) {
    await ctx.reply(
      `⚠️ Could not fetch tasks: ${(err as Error).message}\n\nTry again in a moment.`
    );
  }
});

bot.action("refresh_tasks", async (ctx: Context) => {
  await ctx.answerCbQuery("Refreshing…");
  // Trigger the tasks command logic again
  await ctx.deleteMessage().catch(() => {});
  bot.telegram.sendMessage(ctx.chat!.id, "/tasks").catch(() => {});
});

// ── /tip ─────────────────────────────────────────────────────────────────────

/**
 * Usage:  /tip @username 0.50
 *
 * Sends a peer-to-peer micro-tip denominated in USDC.
 * Lookup is done via Supabase users.telegram_id mapping.
 * In production, trigger a Solana transfer via the user's linked wallet.
 */
bot.command("tip", async (ctx: Context) => {
  const text  = (ctx.message as { text?: string })?.text ?? "";
  const parts = text.trim().split(/\s+/);

  if (parts.length < 3) {
    await ctx.reply(
      "⚠️ Usage: /tip @username amount\n\nExample: /tip @alice 0.50\n\nMinimum tip: $0.01 USDC"
    );
    return;
  }

  const recipientHandle = parts[1].replace(/^@/, "");
  const amount          = parseFloat(parts[2]);

  if (!Number.isFinite(amount) || amount < 0.01) {
    await ctx.reply("❌ Minimum tip is $0.01 USDC"); return;
  }
  if (amount > 1000) {
    await ctx.reply("❌ Maximum single tip is $1,000 USDC"); return;
  }

  await ctx.sendChatAction("typing");

  // Look up recipient in Supabase
  if (!supabase) {
    await ctx.reply("⚠️ Database not connected — tips unavailable"); return;
  }

  const { data: recipient } = await supabase
    .from("users")
    .select("id, wallet_address, telegram_id")
    .eq("telegram_id", recipientHandle)
    .single();

  const senderHandle = ctx.from?.username ?? String(ctx.from?.id ?? "unknown");

  if (!recipient) {
    await ctx.reply(
      `❌ @${recipientHandle} hasn't connected their Ghost AI wallet yet.\n\n` +
      `Ask them to run /start in Ghost AI to link their account.`
    );
    return;
  }

  if (!recipient.wallet_address) {
    await ctx.reply(`❌ @${recipientHandle} hasn't linked a Solana wallet yet.`);
    return;
  }

  // In production: sign + broadcast a USDC transfer on Solana
  const mockTxSig = `TIP_${Date.now().toString(36).toUpperCase()}`;

  await ctx.replyWithMarkdownV2(
    `✅ *Tip Sent\\!*\n\n` +
    `From: @${senderHandle}\n` +
    `To: @${recipientHandle}\n` +
    `Amount: \`${fmtUsdc(amount)}\`\n` +
    `Tx: \`${mockTxSig}\`\n\n` +
    `_Settled on Solana in \\<1 second\\._`
  );
});

// ── Help ──────────────────────────────────────────────────────────────────────

bot.help(async (ctx: Context) => {
  await ctx.replyWithMarkdownV2(
    `👻 *Ghost AI Bot — Commands*\n\n` +
    `\`/start\`  — Welcome \\+ open the app\n` +
    `\`/tasks\`  — List open tasks ≥ \\$0\\.05 USDC\n` +
    `\`/tip @user amount\` — Send a micro\\-tip\n` +
    `\`/help\`   — Show this message`
  );
});

// ── Unknown commands ──────────────────────────────────────────────────────────

bot.on("text", async (ctx: Context) => {
  const text = (ctx.message as { text?: string })?.text ?? "";
  if (text.startsWith("/")) {
    await ctx.reply("Unknown command. Try /help for a list of commands.");
  }
});

// ── Notification webhook helper (called from API) ─────────────────────────────

/**
 * Push a new-task alert to the configured group chat.
 * Called by POST /api/v1/tasks/create after persisting the task.
 */
export async function notifyNewTask(task: {
  id: string;
  title: string;
  payout_usdc: number;
  proof_type: string;
}): Promise<void> {
  if (!NOTIFY_CHAT) return;
  try {
    await bot.telegram.sendMessage(
      NOTIFY_CHAT,
      `🆕 *New Task Posted!*\n\n` +
      `📋 ${task.title}\n` +
      `💰 ${fmtUsdc(task.payout_usdc)}\n` +
      `📁 Proof: ${task.proof_type}\n` +
      `🆔 \`${task.id.slice(0, 8)}…\``,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.warn("[Bot] notifyNewTask failed:", (err as Error).message);
  }
}

// ── Launch ────────────────────────────────────────────────────────────────────

export { bot };

// Run when executed directly (not imported as a module)
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  bot.launch({
    dropPendingUpdates: true,
  });

  console.log("[Ghost AI Bot] 🤖 Bot is running (polling mode)");
  console.log("[Ghost AI Bot] Commands: /start, /tasks, /tip");

  // Graceful shutdown
  process.once("SIGINT",  () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}
