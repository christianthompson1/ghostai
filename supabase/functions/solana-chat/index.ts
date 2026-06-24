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

const SOL_NATIVE = "So11111111111111111111111111111111111111112";

class ClientError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

function logErr(scope: string, e: unknown) {
  console.error(`[solana-chat:${scope}]`, e instanceof Error ? e.stack ?? e.message : e);
}

// ---------------- TTL cache + in-flight dedup ----------------
type CacheEntry = { v: any; exp: number };
const _cache = new Map<string, CacheEntry>();
const _inflight = new Map<string, Promise<any>>();
async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = _cache.get(key);
  const now = Date.now();
  if (hit && hit.exp > now) return hit.v as T;
  const pending = _inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    try {
      const v = await fn();
      _cache.set(key, { v, exp: Date.now() + ttlMs });
      return v;
    } finally { _inflight.delete(key); }
  })();
  _inflight.set(key, p);
  return p;
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

async function gemini(prompt: string, system?: string, model = "gemini-2.5-flash", maxTokens = 1600) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const body: any = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.6, maxOutputTokens: maxTokens },
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

// ---------------- DexScreener resolver ----------------
type Resolved = {
  address: string;
  symbol: string;
  name: string;
  image: string | null;
  poolAddress: string | null;
  priceUsd: number | null;
  change24h: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  pairUrl: string | null;
};

async function dexResolve(query: string): Promise<Resolved | null> {
  const q = query.trim();
  if (!q) return null;
  const isAddr = ADDR_RE.test(q) && q.length >= 32 && q.length <= 44;
  const cleanQ = q.replace(/^\$/, "").toLowerCase();
  const url = isAddr
    ? `https://api.dexscreener.com/latest/dex/tokens/${q}`
    : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(cleanQ)}`;
  return cached(`dex:${url}`, 20_000, async () => {
    const r = await fetch(url);
    if (!r.ok) return null;
    const j = await r.json();
    const pairs: any[] = (j?.pairs ?? []).filter((p: any) => p.chainId === "solana");
    if (!pairs.length) return null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const top = pairs[0];
    const base = top.baseToken;
    return {
      address: base.address,
      symbol: (base.symbol ?? "").toUpperCase(),
      name: base.name ?? base.symbol,
      image: top.info?.imageUrl ?? null,
      poolAddress: top.pairAddress ?? null,
      priceUsd: top.priceUsd ? Number(top.priceUsd) : null,
      change24h: top.priceChange?.h24 ?? null,
      marketCap: top.marketCap ?? top.fdv ?? null,
      liquidityUsd: top.liquidity?.usd ?? null,
      volume24h: top.volume?.h24 ?? null,
      pairUrl: top.url ?? null,
    } as Resolved;
  });
}

// ---------------- RugCheck ----------------
async function rugCheck(address: string) {
  return cached(`rug:${address}`, 60_000, async () => {
   try {
    const [summaryR, fullR] = await Promise.all([
      fetch(`https://api.rugcheck.xyz/v1/tokens/${address}/report/summary`),
      fetch(`https://api.rugcheck.xyz/v1/tokens/${address}/report`),
    ]);
    const summary = summaryR.ok ? await summaryR.json() : null;
    const full = fullR.ok ? await fullR.json() : null;
    return {
      score: summary?.score_normalised ?? summary?.score ?? null,
      risks: (summary?.risks ?? []).slice(0, 6).map((r: any) => ({
        name: r.name, level: r.level, description: r.description, score: r.score,
      })),
      mintAuthority: full?.token?.mintAuthority ?? null,
      freezeAuthority: full?.token?.freezeAuthority ?? null,
      supply: full?.token?.supply ?? null,
      decimals: full?.token?.decimals ?? null,
      totalLPProviders: full?.totalLPProviders ?? null,
      totalMarketLiquidity: full?.totalMarketLiquidity ?? null,
      rugged: full?.rugged ?? false,
      lpLockedPct: full?.markets?.[0]?.lp?.lpLockedPct ?? null,
    };
   } catch (e) { logErr("rugcheck", e); return null; }
  });
}

// ---------------- Token Intel (DexScreener + RugCheck) ----------------
async function tokenIntel(input: string) {
  const resolved = await dexResolve(input);
  if (!resolved) throw new ClientError("Token not found on DexScreener");
  const rug = await rugCheck(resolved.address);

  // Compose risk
  let score = rug?.score ?? 0;
  if (rug?.mintAuthority) score = Math.max(score, 65);
  if (rug?.rugged) score = 100;
  score = Math.min(100, Math.max(0, score));
  const risk = score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : score > 0 ? "LOW" : "MINIMAL";

  const summary = await gemini(
    `Write a 3-4 sentence professional security & overview audit. Token: ${resolved.name} (${resolved.symbol}). Risk score: ${risk} (${score}/100). Mint authority ${rug?.mintAuthority ? "ACTIVE — supply can be inflated" : "revoked"}. Freeze authority ${rug?.freezeAuthority ? "ACTIVE — wallets can be frozen" : "revoked"}. Liquidity: $${(rug?.totalMarketLiquidity ?? resolved.liquidityUsd ?? 0).toLocaleString()}. LP providers: ${rug?.totalLPProviders ?? "n/a"}. Market cap: $${resolved.marketCap?.toLocaleString() ?? "n/a"}. Top risks: ${(rug?.risks ?? []).map((r: any) => r.name).join(", ") || "none flagged"}.`,
    "You are GHOST AI's on-chain security analyst. Be direct, concrete, no disclaimers, no hype."
  ).catch((e) => { logErr("intel-summary", e); return ""; });

  return {
    type: "token_intel",
    address: resolved.address,
    name: resolved.name,
    symbol: resolved.symbol,
    image: resolved.image,
    poolAddress: resolved.poolAddress,
    pairUrl: resolved.pairUrl,
    price: resolved.priceUsd,
    change24h: resolved.change24h,
    marketCap: resolved.marketCap,
    liquidity: rug?.totalMarketLiquidity ?? resolved.liquidityUsd,
    volume24h: resolved.volume24h,
    supply: rug?.supply ?? null,
    decimals: rug?.decimals ?? null,
    mintAuthority: rug?.mintAuthority ?? null,
    freezeAuthority: rug?.freezeAuthority ?? null,
    lpProviders: rug?.totalLPProviders ?? null,
    lpLockedPct: rug?.lpLockedPct ?? null,
    rugged: rug?.rugged ?? false,
    risks: rug?.risks ?? [],
    riskScore: score,
    risk,
    summary,
  };
}

// ---------------- Multi-timeframe chart (GeckoTerminal OHLCV) ----------------
type TF = "1m" | "5m" | "1h" | "1D" | "7D" | "1M" | "6M" | "1Y";
const TF_CONFIG: Record<TF, { tf: "minute" | "hour" | "day"; agg: number; limit: number }> = {
  "1m": { tf: "minute", agg: 1, limit: 60 },
  "5m": { tf: "minute", agg: 5, limit: 72 },
  "1h": { tf: "hour", agg: 1, limit: 24 },
  "1D": { tf: "hour", agg: 1, limit: 24 },
  "7D": { tf: "hour", agg: 4, limit: 42 },
  "1M": { tf: "day", agg: 1, limit: 30 },
  "6M": { tf: "day", agg: 1, limit: 180 },
  "1Y": { tf: "day", agg: 7, limit: 52 },
};

async function priceChart(opts: { input?: string; resolved?: Resolved | null; timeframe: TF }) {
  const tf = (TF_CONFIG[opts.timeframe] ? opts.timeframe : "1D") as TF;
  let resolved = opts.resolved ?? null;
  if (!resolved && opts.input) {
    resolved = await dexResolve(opts.input);
  }
  if (!resolved) throw new ClientError("Token not found");
  if (!resolved.poolAddress) throw new ClientError("No tradeable pool found for this token");

  const cfg = TF_CONFIG[tf];
  const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${resolved.poolAddress}/ohlcv/${cfg.tf}?aggregate=${cfg.agg}&limit=${cfg.limit}`;
  const raw = await cached<number[][]>(`gt:${url}`, 15_000, async () => {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new ClientError("Price data unavailable");
    const j = await r.json();
    return j?.data?.attributes?.ohlcv_list ?? [];
  });
  const seen = new Set<number>();
  const points = raw
    .map((row) => ({ time: row[0], value: row[4] }))
    .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
    .sort((a, b) => a.time - b.time);

  const first = points[0]?.value ?? 0;
  const last = points.at(-1)?.value ?? 0;

  return {
    type: "price_chart",
    address: resolved.address,
    poolAddress: resolved.poolAddress,
    symbol: resolved.symbol,
    name: resolved.name,
    image: resolved.image,
    timeframe: tf,
    points,
    current: last || resolved.priceUsd,
    change: first > 0 ? ((last - first) / first) * 100 : 0,
  };
}

// ---------------- Transaction decode ----------------
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
    fee: tx.fee, slot: tx.slot, timestamp: tx.timestamp,
    txType: tx.type, source: tx.source, description: tx.description,
    error: tx.transactionError ?? null,
    programs: [...new Set((tx.instructions ?? []).map((i: any) => i.programId))].slice(0, 6),
    explanation,
  };
}

// ---------------- Pump.fun graduation tracker ----------------
async function pumpfunGraduating(limit = 20) {
  return cached(`pumpfun:${limit}`, 25_000, async () => {
   const urls = [
    `https://frontend-api-v3.pump.fun/coins?offset=0&limit=${limit}&sort=progress&order=DESC&includeNsfw=false`,
    `https://frontend-api-v2.pump.fun/coins?offset=0&limit=${limit}&sort=progress&order=DESC&includeNsfw=false`,
    `https://frontend-api.pump.fun/coins?offset=0&limit=${limit}&sort=progress&order=DESC&includeNsfw=false`,
   ];
   let coins: any[] | null = null;
   let lastErr: any = null;
   for (const u of urls) {
    try {
      const r = await fetch(u, {
        headers: {
          "accept": "application/json",
          "user-agent": "Mozilla/5.0 (compatible; GhostAI/1.0)",
          "origin": "https://pump.fun",
          "referer": "https://pump.fun/",
        },
      });
      if (!r.ok) { lastErr = `${r.status}`; continue; }
      const j = await r.json();
      coins = Array.isArray(j) ? j : (j?.coins ?? null);
      if (coins?.length) break;
    } catch (e) { lastErr = e; }
   }
   if (coins?.length) {
    return coins.slice(0, limit).map((c: any) => {
      const mc = c.usd_market_cap ?? c.market_cap ?? 0;
      const progress = Math.min(100, (mc / 69000) * 100);
      return {
        mint: c.mint, name: c.name, symbol: c.symbol,
        image: c.image_uri ?? c.image ?? null,
        progress: Number(progress.toFixed(2)),
        marketCap: mc,
        createdAt: c.created_timestamp ?? null,
        description: c.description ?? null,
      };
    });
   }

   // Fallback: GeckoTerminal — pump.fun pools sorted by FDV proximity to graduation
   logErr("pumpfun-fallback", `pumpfun unreachable: ${lastErr}; using GeckoTerminal`);
   try {
    const r = await fetch(
      `https://api.geckoterminal.com/api/v2/networks/solana/dexes/pumpfun/pools?page=1&sort=h24_volume_usd_desc`,
      { headers: { accept: "application/json" } }
    );
    if (!r.ok) throw new Error(`gt ${r.status}`);
    const j = await r.json();
    const pools: any[] = j?.data ?? [];
    return pools.slice(0, limit).map((p: any) => {
      const a = p.attributes ?? {};
      const mc = Number(a.fdv_usd ?? a.market_cap_usd ?? 0);
      const progress = Math.min(100, (mc / 69000) * 100);
      const baseMint = (a.address ?? "").split("_")[0] ?? a.address;
      return {
        mint: baseMint,
        name: a.name ?? "",
        symbol: (a.name ?? "").split("/")[0]?.trim() ?? "",
        image: null,
        progress: Number(progress.toFixed(2)),
        marketCap: mc,
        createdAt: a.pool_created_at ?? null,
        description: null,
      };
    }).sort((a, b) => b.progress - a.progress);
   } catch (e) {
    logErr("pumpfun", e);
    throw new ClientError("Pump.fun feed temporarily unavailable");
   }
  });
}

// ---------------- Trending (legacy compat) ----------------
async function trending(limit = 12) {
  return cached(`trending:${limit}`, 30_000, async () => {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=solana-ecosystem&order=volume_desc&per_page=${limit}&page=1&price_change_percentage=24h`);
    if (!r.ok) throw new Error("Trending unavailable");
    const data = await r.json();
    return (data as any[]).map((c) => ({
      id: c.id, symbol: (c.symbol ?? "").toUpperCase(), name: c.name, image: c.image,
      price: c.current_price, change24h: c.price_change_percentage_24h,
      marketCap: c.market_cap, volume: c.total_volume,
    }));
  });
}

async function marketPulse() {
  const [movers, epoch] = await Promise.all([
    trending(8).catch(() => []),
    rpc("getEpochInfo", []).catch(() => null),
  ]);
  const summary = await gemini(
    `Write 3 concise sentences on the current Solana market pulse. No hype, no advice. Data: ${JSON.stringify(movers.slice(0, 6))} Epoch: ${JSON.stringify(epoch)}`,
    "You are a Solana analyst."
  ).catch((e) => { logErr("pulse", e); return "Market summary unavailable."; });
  return { type: "market_pulse", movers, epoch, summary };
}

// ---------------- Intent classifier ----------------
function classify(text: string): { kind: string; query?: string; signature?: string; timeframe?: TF } {
  const t = text.toLowerCase();
  const sigMatch = text.match(SIG_RE);
  if (sigMatch && sigMatch[0].length >= 64) return { kind: "tx", signature: sigMatch[0] };

  const wantsAudit = /\b(audit|security|rug|safe|safety|check|overview|holders?|authority)\b/.test(t);
  const wantsChart = /\b(chart|price|graph|candle)\b/.test(t);
  const wantsPulse = /\b(trend|pulse|market|movers?)\b/.test(t) && !wantsChart && !wantsAudit;
  const wantsPump = /\b(pump|graduat|bonding)\b/.test(t);

  let timeframe: TF = "1D";
  if (/\b1m\b|1\s*min/.test(t)) timeframe = "1m";
  else if (/\b5m\b|5\s*min/.test(t)) timeframe = "5m";
  else if (/\b1h\b|hour/.test(t)) timeframe = "1h";
  else if (/\b1d\b|24h|today|day/.test(t)) timeframe = "1D";
  else if (/\b7d\b|week/.test(t)) timeframe = "7D";
  else if (/\b1mo\b|month/.test(t)) timeframe = "1M";
  else if (/\b6mo\b|6\s*months/.test(t)) timeframe = "6M";
  else if (/\b1y\b|year/.test(t)) timeframe = "1Y";

  if (wantsPump) return { kind: "pumpfun" };
  if (wantsPulse) return { kind: "pulse" };

  // Extract token query: $TICKER, raw address, or last quoted word
  const addrMatch = text.match(ADDR_RE);
  const dollarMatch = text.match(/\$([A-Za-z][A-Za-z0-9]{1,10})/);
  const query = addrMatch?.[0] ?? dollarMatch?.[1] ?? null;

  if (wantsChart && query) return { kind: "chart", query, timeframe };
  if (wantsAudit && query) return { kind: "token", query };
  if (addrMatch) return { kind: "token", query: addrMatch[0] };
  if (dollarMatch) return { kind: "token", query: dollarMatch[1] };

  return { kind: "chat" };
}

function validatePayload(raw: any) {
  if (!raw || typeof raw !== "object") throw new ClientError("Invalid request body");
  if (raw.command) {
    return { mode: "command" as const, command: String(raw.command), args: raw.args ?? {} };
  }
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
  return { mode: "chat" as const, message: trimmed, history: safeHistory };
}

async function authenticate(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) throw new ClientError("Unauthorized", 401);
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

const CHAT_SYSTEM = `You are GHOST AI — the official conversational terminal of Ghost Protocol, a Solana on-chain intelligence platform.

You have deep, expert-level knowledge of Solana, SVM, Pump.fun, Jupiter, Raydium, Orca, Helius, Metaplex, DeFi, NFTs, MEV, validators, PoH, tokenomics, and Web3 broadly.

Answer conversational and historical questions thoroughly. Use markdown — headings, bold, lists, inline code for addresses/program IDs. Be specific with numbers, dates, protocol details. Never refuse legitimate Web3 questions. When mentioning a Solana token, refer to it as $TICKER or include its full mint address verbatim — the UI will auto-attach interactive copy chips.

If users want live on-chain data (token audit, transaction decode, price chart, pump.fun graduations, market pulse), the system renders cards alongside your reply — you don't need to ask for addresses.`;

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
    const payload = validatePayload(raw);

    // ---------- Command mode (UI actions) ----------
    if (payload.mode === "command") {
      const { command, args } = payload;
      try {
        if (command === "trending") {
          const list = await trending(args.limit ?? 12);
          return Response.json({ trending: list }, { headers: corsHeaders });
        }
        if (command === "pumpfun") {
          const list = await pumpfunGraduating(args.limit ?? 20);
          return Response.json({ pumpfun: list }, { headers: corsHeaders });
        }
        if (command === "resolve") {
          const r = await dexResolve(String(args.query ?? ""));
          return Response.json({ resolved: r }, { headers: corsHeaders });
        }
        if (command === "chart") {
          const part = await priceChart({
            input: args.query ?? args.address ?? args.symbol,
            timeframe: (args.timeframe as TF) ?? "1D",
          });
          return Response.json({ parts: [part] }, { headers: corsHeaders });
        }
        if (command === "audit") {
          const part = await tokenIntel(String(args.query ?? args.address ?? args.symbol ?? ""));
          return Response.json({ parts: [part] }, { headers: corsHeaders });
        }
        if (command === "token_combo") {
          // Click-a-token from pumpfun list: chart + audit
          const query = String(args.query ?? args.address ?? "");
          const [chartP, intelP] = await Promise.allSettled([
            priceChart({ input: query, timeframe: (args.timeframe as TF) ?? "1D" }),
            tokenIntel(query),
          ]);
          const parts: any[] = [];
          if (chartP.status === "fulfilled") parts.push(chartP.value);
          if (intelP.status === "fulfilled") parts.push(intelP.value);
          if (!parts.length) parts.push({ type: "error", message: "Token data unavailable" });
          return Response.json({ parts }, { headers: corsHeaders });
        }
        throw new ClientError("Unknown command");
      } catch (e) {
        logErr(`command:${command}`, e);
        const msg = e instanceof ClientError ? e.message : "We couldn't complete that action. Please try again.";
        return Response.json({ parts: [{ type: "error", message: msg }] }, { headers: corsHeaders });
      }
    }

    // ---------- Chat mode ----------
    const { message, history } = payload;
    const intent = classify(message);
    const parts: any[] = [];

    try {
      if (intent.kind === "tx" && intent.signature) {
        parts.push(await txDecode(intent.signature));
      } else if (intent.kind === "pulse") {
        parts.push(await marketPulse());
      } else if (intent.kind === "pumpfun") {
        const list = await pumpfunGraduating(20);
        parts.push({ type: "text", text: `Top **${list.length}** Pump.fun tokens closest to graduation:` });
        parts.push({ type: "pumpfun_list", items: list });
      } else if (intent.kind === "chart" && intent.query) {
        parts.push(await priceChart({ input: intent.query, timeframe: intent.timeframe ?? "1D" }));
      } else if (intent.kind === "token" && intent.query) {
        parts.push(await tokenIntel(intent.query));
      } else {
        const ctx = history.slice(-6).map((h) => `${h.role}: ${h.content}`).join("\n");
        const text = await gemini(
          `${ctx ? `Recent conversation:\n${ctx}\n\n` : ""}User: ${message}`,
          CHAT_SYSTEM,
          "gemini-2.5-flash",
          2200
        );
        parts.push({ type: "text", text: text || "I couldn't generate a response — try rephrasing the question." });
      }
    } catch (e) {
      logErr(`intent:${intent.kind}`, e);
      if (intent.kind === "chat") {
        parts.push({ type: "text", text: "I hit a temporary issue reaching my reasoning model. Please try again in a moment." });
      } else {
        const msg = e instanceof ClientError ? e.message : "We couldn't complete that request. Please try again.";
        parts.push({ type: "error", message: msg });
      }
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
