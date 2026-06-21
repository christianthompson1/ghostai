// deno-lint-ignore-file no-explicit-any
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")!;
const HELIUS_RPC_URL = Deno.env.get("HELIUS_RPC_URL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const MAX_MESSAGE_LEN = 4000;
const MAX_HISTORY = 20;
const MAX_HISTORY_CONTENT_LEN = 2000;

const ADDR_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;
const SIG_RE = /\b[1-9A-HJ-NP-Za-km-z]{64,88}\b/;

class ClientError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function logErr(scope: string, e: unknown) {
  console.error(`[solana-chat:${scope}]`, e instanceof Error ? e.stack ?? e.message : e);
}

async function rpc(method: string, params: any[]) {
  const r = await fetch(HELIUS_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`Helius ${method} ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

function heliusApiKey() {
  return new URL(HELIUS_RPC_URL).searchParams.get("api-key") ?? "";
}

async function gemini(prompt: string, system?: string, model = "gemini-2.5-flash") {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const body: any = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    logErr("gemini", `${r.status} ${txt.slice(0, 500)}`);
    throw new Error("AI model unavailable");
  }
  const j = await r.json();
  return j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") ?? "";
}

async function tokenIntel(address: string) {
  const [asset, largest, supply] = await Promise.all([
    fetch(HELIUS_RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: address } }),
    }).then((r) => r.json()).then((j) => j.result).catch(() => null),
    rpc("getTokenLargestAccounts", [address]).catch(() => null),
    rpc("getTokenSupply", [address]).catch(() => null),
  ]);

  const holders = largest?.value ?? [];
  const total = Number(supply?.value?.uiAmountString ?? 0);
  const top10 = holders.slice(0, 10).reduce((a: number, h: any) => a + Number(h.uiAmount ?? 0), 0);
  const top1 = Number(holders[0]?.uiAmount ?? 0);
  const concentration = total > 0 ? (top10 / total) * 100 : 0;
  const topHolderPct = total > 0 ? (top1 / total) * 100 : 0;

  const meta = asset?.content?.metadata ?? {};
  const mintAuthority = asset?.token_info?.mint_authority ?? null;
  const freezeAuthority = asset?.token_info?.freeze_authority ?? null;

  let score = 0;
  if (concentration > 50) score += 40; else if (concentration > 30) score += 25; else if (concentration > 15) score += 10;
  if (topHolderPct > 25) score += 25;
  if (mintAuthority) score += 15;
  if (freezeAuthority) score += 10;
  if (!meta.name) score += 10;
  score = Math.min(100, score);
  const risk = score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : score > 0 ? "LOW" : "MINIMAL";

  const summary = await gemini(
    `Briefly summarize on-chain safety in 2-3 sentences. Token: ${meta.name ?? "Unknown"} (${meta.symbol ?? "?"}). Risk: ${risk} (${score}/100). Top10 holders own ${concentration.toFixed(1)}%, top wallet ${topHolderPct.toFixed(1)}%. Mint authority ${mintAuthority ? "ACTIVE" : "revoked"}. Freeze authority ${freezeAuthority ? "ACTIVE" : "revoked"}.`,
    "You are a concise Solana security auditor. No hype, no disclaimers."
  ).catch((e) => { logErr("intel-summary", e); return ""; });

  return {
    type: "token_intel",
    address,
    name: meta.name ?? "Unknown",
    symbol: meta.symbol ?? "—",
    image: asset?.content?.links?.image ?? meta.image ?? null,
    decimals: supply?.value?.decimals ?? null,
    supply: supply?.value?.uiAmountString ?? null,
    mintAuthority,
    freezeAuthority,
    topHolderPct: Number(topHolderPct.toFixed(2)),
    top10Concentration: Number(concentration.toFixed(2)),
    riskScore: score,
    risk,
    summary,
  };
}

async function priceChart(address: string | null, days: 7 | 30) {
  let url = address
    ? `https://api.coingecko.com/api/v3/coins/solana/contract/${address}/market_chart?vs_currency=usd&days=${days}`
    : `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`;
  let r = await fetch(url);
  if (!r.ok && address) {
    r = await fetch(`https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`);
  }
  if (!r.ok) throw new Error("Price data unavailable");
  const j = await r.json();
  const prices: [number, number][] = j.prices ?? [];
  return {
    type: "price_chart",
    address,
    days,
    points: prices.map(([t, p]) => ({ time: Math.floor(t / 1000), value: p })),
    current: prices.at(-1)?.[1] ?? null,
    change: prices.length > 1 ? ((prices.at(-1)![1] - prices[0][1]) / prices[0][1]) * 100 : 0,
  };
}

async function txDecode(signature: string) {
  const apiKey = heliusApiKey();
  const r = await fetch(`https://api.helius.xyz/v0/transactions?api-key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transactions: [signature] }),
  });
  if (!r.ok) throw new Error("Transaction lookup unavailable");
  const arr = await r.json();
  const tx = arr[0];
  if (!tx) throw new Error("Transaction not found");

  const explanation = await gemini(
    `Explain this Solana transaction in plain English. Status: ${tx.transactionError ? "FAILED" : "SUCCESS"}. Type: ${tx.type}. Source: ${tx.source}. Fee: ${tx.fee} lamports. Description: ${tx.description ?? "n/a"}. ${tx.transactionError ? `Error: ${JSON.stringify(tx.transactionError)}` : ""} Instructions: ${JSON.stringify(tx.instructions?.slice(0, 6) ?? [])}`,
    "You are a Solana protocol expert. Give 3-5 sentences explaining what happened and why (if it failed)."
  ).catch((e) => { logErr("tx-explain", e); return "Explanation unavailable."; });

  return {
    type: "tx_decode",
    signature,
    status: tx.transactionError ? "FAILED" : "SUCCESS",
    fee: tx.fee,
    slot: tx.slot,
    timestamp: tx.timestamp,
    txType: tx.type,
    source: tx.source,
    description: tx.description,
    error: tx.transactionError ?? null,
    programs: [...new Set((tx.instructions ?? []).map((i: any) => i.programId))].slice(0, 6),
    explanation,
  };
}

async function marketPulse() {
  const [trending, epoch] = await Promise.all([
    fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=solana-ecosystem&order=volume_desc&per_page=8&page=1&price_change_percentage=24h")
      .then((r) => r.ok ? r.json() : []).catch(() => []),
    rpc("getEpochInfo", []).catch(() => null),
  ]);
  const movers = (trending as any[]).map((c: any) => ({
    id: c.id, symbol: c.symbol, name: c.name, image: c.image,
    price: c.current_price, change24h: c.price_change_percentage_24h,
    volume: c.total_volume,
  }));
  const summary = await gemini(
    `Write 3 concise sentences on the current Solana market pulse based on this data. No hype, no advice. Data: ${JSON.stringify(movers.slice(0, 6))} Epoch: ${JSON.stringify(epoch)}`,
    "You are a Solana analyst."
  ).catch((e) => { logErr("pulse", e); return "Market summary unavailable."; });
  return { type: "market_pulse", movers, epoch, summary };
}

function classify(text: string): { kind: string; address?: string; days?: 7 | 30 } {
  const t = text.toLowerCase();
  const sigMatch = text.match(SIG_RE);
  const addrMatch = text.match(ADDR_RE);
  if (sigMatch && sigMatch[0].length >= 64) return { kind: "tx", address: sigMatch[0] };
  if (t.includes("trend") || t.includes("pulse") || t.includes("market")) return { kind: "pulse" };
  if (t.includes("chart") || t.includes("price")) {
    const days = t.includes("30") || t.includes("month") ? 30 : 7;
    return { kind: "chart", address: addrMatch?.[0], days: days as 7 | 30 };
  }
  if (addrMatch) return { kind: "token", address: addrMatch[0] };
  return { kind: "chat" };
}

function validatePayload(raw: any): { message: string; history: { role: string; content: string }[] } {
  if (!raw || typeof raw !== "object") throw new ClientError("Invalid request body");
  const { message, history } = raw;
  if (typeof message !== "string") throw new ClientError("Field 'message' must be a string");
  const trimmed = message.trim();
  if (!trimmed) throw new ClientError("Message is empty");
  if (trimmed.length > MAX_MESSAGE_LEN) throw new ClientError(`Message exceeds ${MAX_MESSAGE_LEN} characters`);

  let safeHistory: { role: string; content: string }[] = [];
  if (history !== undefined && history !== null) {
    if (!Array.isArray(history)) throw new ClientError("Field 'history' must be an array");
    if (history.length > MAX_HISTORY) throw new ClientError(`History exceeds ${MAX_HISTORY} entries`);
    safeHistory = history.slice(-MAX_HISTORY).map((h: any, i: number) => {
      if (!h || typeof h !== "object") throw new ClientError(`History[${i}] invalid`);
      const role = h.role === "assistant" || h.role === "user" || h.role === "system" ? h.role : null;
      if (!role) throw new ClientError(`History[${i}].role invalid`);
      const content = typeof h.content === "string" ? h.content.slice(0, MAX_HISTORY_CONTENT_LEN) : "";
      return { role, content };
    });
  }
  return { message: trimmed, history: safeHistory };
}

async function authenticate(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    throw new ClientError("Unauthorized", 401);
  }
  const token = auth.slice(7).trim();
  if (!token) throw new ClientError("Unauthorized", 401);
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sb.auth.getUser(token);
  if (error || !data?.user) throw new ClientError("Unauthorized", 401);
  return data.user.id;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    if (!GEMINI_API_KEY || !HELIUS_RPC_URL) {
      logErr("config", "Missing required server secrets");
      return new Response(JSON.stringify({ parts: [{ type: "error", message: "Service is temporarily unavailable" }] }), {
        status: 200, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    await authenticate(req);

    let raw: any;
    try { raw = await req.json(); } catch { throw new ClientError("Invalid JSON body"); }
    const { message } = validatePayload(raw);

    const intent = classify(message);
    const parts: any[] = [];

    try {
      if (intent.kind === "token" && intent.address) {
        parts.push(await tokenIntel(intent.address));
      } else if (intent.kind === "tx" && intent.address) {
        parts.push(await txDecode(intent.address));
      } else if (intent.kind === "chart") {
        parts.push(await priceChart(intent.address ?? null, intent.days ?? 7));
      } else if (intent.kind === "pulse") {
        parts.push(await marketPulse());
      } else {
        const sys = "You are GHOST AI, a conversational Solana intelligence assistant. Be concise (2-4 sentences) and friendly. If the user wants on-chain data, suggest they paste a token mint address or transaction signature.";
        const text = await gemini(`user: ${message}`, sys);
        parts.push({ type: "text", text });
      }
    } catch (e) {
      logErr(`intent:${intent.kind}`, e);
      parts.push({ type: "error", message: "We couldn't complete that request. Please try again." });
    }

    return new Response(JSON.stringify({ parts }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (e: any) {
    if (e instanceof ClientError) {
      return new Response(JSON.stringify({ error: e.message }), {
        status: e.status, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }
    logErr("fatal", e);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
