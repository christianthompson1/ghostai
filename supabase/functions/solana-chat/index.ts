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

// Known Solana ecosystem tokens — symbol -> { mint, coingecko id }
type Known = { address?: string; coingeckoId: string; name: string; symbol: string };
const KNOWN: Record<string, Known> = {
  SOL:  { coingeckoId: "solana", name: "Solana", symbol: "SOL" },
  BONK: { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", coingeckoId: "bonk", name: "Bonk", symbol: "BONK" },
  WIF:  { address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", coingeckoId: "dogwifcoin", name: "dogwifhat", symbol: "WIF" },
  JUP:  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", coingeckoId: "jupiter-exchange-solana", name: "Jupiter", symbol: "JUP" },
  JTO:  { address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", coingeckoId: "jito-governance-token", name: "Jito", symbol: "JTO" },
  PYTH: { address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", coingeckoId: "pyth-network", name: "Pyth", symbol: "PYTH" },
  USDC: { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", coingeckoId: "usd-coin", name: "USD Coin", symbol: "USDC" },
  RAY:  { address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", coingeckoId: "raydium", name: "Raydium", symbol: "RAY" },
  ORCA: { address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", coingeckoId: "orca", name: "Orca", symbol: "ORCA" },
  MSOL: { address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", coingeckoId: "msol", name: "Marinade SOL", symbol: "mSOL" },
};

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

function resolveSymbol(text: string): Known | null {
  const upper = text.toUpperCase();
  // explicit $SYMBOL or whole-word symbol match
  for (const sym of Object.keys(KNOWN)) {
    const re = new RegExp(`(^|[^A-Z0-9])\\$?${sym}([^A-Z0-9]|$)`);
    if (re.test(upper)) return KNOWN[sym];
  }
  // by lowercase name
  const lower = text.toLowerCase();
  for (const k of Object.values(KNOWN)) {
    if (lower.includes(k.name.toLowerCase())) return k;
  }
  return null;
}

async function coingeckoMeta(id: string) {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false`);
  if (!r.ok) return null;
  return r.json();
}

async function tokenIntel(address: string | null, known?: Known | null) {
  const meta = known ? await coingeckoMeta(known.coingeckoId).catch(() => null) : null;
  const md = meta?.market_data;
  const genesis = meta?.genesis_date ? new Date(meta.genesis_date) : null;
  const ageDays = genesis ? Math.floor((Date.now() - genesis.getTime()) / 86400000) : null;

  // SOL has no SPL mint
  const isNative = known?.symbol === "SOL" && !address;

  let onchain: any = { mintAuthority: null, freezeAuthority: null, supply: null, decimals: null, image: null, name: null, symbol: null, holders: [], top10Concentration: 0, topHolderPct: 0 };

  if (address) {
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
    onchain = {
      mintAuthority: asset?.token_info?.mint_authority ?? null,
      freezeAuthority: asset?.token_info?.freeze_authority ?? null,
      supply: supply?.value?.uiAmountString ?? null,
      decimals: supply?.value?.decimals ?? null,
      image: asset?.content?.links?.image ?? asset?.content?.metadata?.image ?? null,
      name: asset?.content?.metadata?.name ?? null,
      symbol: asset?.content?.metadata?.symbol ?? null,
      holders,
      top10Concentration: total > 0 ? (top10 / total) * 100 : 0,
      topHolderPct: total > 0 ? (top1 / total) * 100 : 0,
    };
  }

  // Risk scoring
  let score = 0;
  if (onchain.top10Concentration > 50) score += 35;
  else if (onchain.top10Concentration > 30) score += 20;
  else if (onchain.top10Concentration > 15) score += 8;
  if (onchain.topHolderPct > 25) score += 25;
  if (onchain.mintAuthority) score += 15;
  if (onchain.freezeAuthority) score += 10;
  if (ageDays !== null && ageDays < 90) score += 10;
  if (isNative) score = 0;
  score = Math.min(100, score);
  const risk = score >= 60 ? "HIGH" : score >= 35 ? "MEDIUM" : score > 0 ? "LOW" : "MINIMAL";

  const name = known?.name ?? onchain.name ?? meta?.name ?? "Unknown";
  const symbol = known?.symbol ?? onchain.symbol ?? meta?.symbol?.toUpperCase() ?? "—";
  const image = meta?.image?.large ?? meta?.image?.small ?? onchain.image ?? null;

  const summary = await gemini(
    `Write a 3-4 sentence professional security & overview audit. Token: ${name} (${symbol}). Age: ${ageDays ?? "unknown"} days. Risk score: ${risk} (${score}/100). Top 10 wallets hold ${onchain.top10Concentration.toFixed(1)}% of supply, top wallet ${onchain.topHolderPct.toFixed(1)}%. Mint authority ${onchain.mintAuthority ? "ACTIVE (can mint more)" : "revoked"}. Freeze authority ${onchain.freezeAuthority ? "ACTIVE (can freeze wallets)" : "revoked"}. Market cap $${md?.market_cap?.usd?.toLocaleString() ?? "n/a"}.`,
    "You are GHOST AI's on-chain security analyst. Be direct, concrete, no disclaimers, no hype."
  ).catch((e) => { logErr("intel-summary", e); return ""; });

  return {
    type: "token_intel",
    address: address ?? null,
    name, symbol, image,
    decimals: onchain.decimals,
    supply: onchain.supply,
    totalSupply: md?.total_supply ?? null,
    circulatingSupply: md?.circulating_supply ?? null,
    maxSupply: md?.max_supply ?? null,
    marketCap: md?.market_cap?.usd ?? null,
    price: md?.current_price?.usd ?? null,
    change24h: md?.price_change_percentage_24h ?? null,
    ageDays,
    genesisDate: meta?.genesis_date ?? null,
    mintAuthority: onchain.mintAuthority,
    freezeAuthority: onchain.freezeAuthority,
    topHolderPct: Number(onchain.topHolderPct.toFixed(2)),
    top10Concentration: Number(onchain.top10Concentration.toFixed(2)),
    riskScore: score,
    risk,
    summary,
  };
}

const DAYS_MAP: Record<string, 1 | 7 | 30 | 365> = { "1D": 1, "1W": 7, "1M": 30, "1Y": 365 };

async function priceChart(opts: { address?: string | null; coingeckoId?: string | null; days: 1 | 7 | 30 | 365; symbol?: string; name?: string }) {
  const { days } = opts;
  let url: string;
  if (opts.coingeckoId) {
    url = `https://api.coingecko.com/api/v3/coins/${opts.coingeckoId}/market_chart?vs_currency=usd&days=${days}`;
  } else if (opts.address) {
    url = `https://api.coingecko.com/api/v3/coins/solana/contract/${opts.address}/market_chart?vs_currency=usd&days=${days}`;
  } else {
    url = `https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`;
  }
  let r = await fetch(url);
  if (!r.ok) {
    r = await fetch(`https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=${days}`);
  }
  if (!r.ok) throw new Error("Price data unavailable");
  const j = await r.json();
  const prices: [number, number][] = j.prices ?? [];
  // dedupe and ensure ascending time (lightweight-charts requirement)
  const seen = new Set<number>();
  const points = prices
    .map(([t, p]) => ({ time: Math.floor(t / 1000), value: p }))
    .filter((p) => (seen.has(p.time) ? false : (seen.add(p.time), true)))
    .sort((a, b) => a.time - b.time);

  return {
    type: "price_chart",
    address: opts.address ?? null,
    coingeckoId: opts.coingeckoId ?? null,
    symbol: opts.symbol ?? "SOL",
    name: opts.name ?? "Solana",
    days,
    points,
    current: points.at(-1)?.value ?? null,
    change: points.length > 1 ? ((points.at(-1)!.value - points[0].value) / points[0].value) * 100 : 0,
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
    fee: tx.fee, slot: tx.slot, timestamp: tx.timestamp,
    txType: tx.type, source: tx.source, description: tx.description,
    error: tx.transactionError ?? null,
    programs: [...new Set((tx.instructions ?? []).map((i: any) => i.programId))].slice(0, 6),
    explanation,
  };
}

async function trending(limit = 12) {
  const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=solana-ecosystem&order=volume_desc&per_page=${limit}&page=1&price_change_percentage=24h`);
  if (!r.ok) throw new Error("Trending unavailable");
  const data = await r.json();
  return (data as any[]).map((c) => ({
    id: c.id, symbol: (c.symbol ?? "").toUpperCase(), name: c.name, image: c.image,
    price: c.current_price, change24h: c.price_change_percentage_24h,
    marketCap: c.market_cap, volume: c.total_volume,
  }));
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

function classify(text: string): { kind: string; address?: string; days?: 1 | 7 | 30 | 365; known?: Known | null } {
  const t = text.toLowerCase();
  const sigMatch = text.match(SIG_RE);
  const addrMatch = text.match(ADDR_RE);
  if (sigMatch && sigMatch[0].length >= 64) return { kind: "tx", address: sigMatch[0] };

  const wantsAudit = /\b(audit|security|rug|safe|safety|check|overview|holders?|authority)\b/.test(t);
  const wantsChart = /\b(chart|price|graph)\b/.test(t);
  const wantsPulse = /\b(trend|pulse|market|movers?)\b/.test(t) && !wantsChart && !wantsAudit;

  let days: 1 | 7 | 30 | 365 = 7;
  if (/\b1d\b|24h|today/.test(t)) days = 1;
  else if (/\b1y\b|year/.test(t)) days = 365;
  else if (/\b1m\b|month|30/.test(t)) days = 30;
  else if (/\b1w\b|week/.test(t)) days = 7;

  if (wantsPulse) return { kind: "pulse" };

  const known = resolveSymbol(text);

  if (wantsChart) return { kind: "chart", address: addrMatch?.[0], days, known };
  if (wantsAudit) return { kind: "token", address: addrMatch?.[0], known };
  if (addrMatch) return { kind: "token", address: addrMatch[0], known };

  return { kind: "chat" };
}

function validatePayload(raw: any) {
  if (!raw || typeof raw !== "object") throw new ClientError("Invalid request body");
  // Command path (button-driven UI actions)
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

You have deep, expert-level knowledge of:
- Solana history, founders (Anatoly Yakovenko, Raj Gokal), launch (March 2020 mainnet beta, $0.22 ICO price), tokenomics, validator economics
- Proof of History, Tower BFT, Gulf Stream, Sealevel, Turbine, Pipelining, Cloudbreak, Archivers
- SPL tokens, the Token-2022 program, PDAs, CPI, rent, lamports, compute units
- DeFi on Solana: Jupiter, Raydium, Orca, Kamino, MarginFi, Drift, Jito, marinade, Pyth, Switchboard
- NFTs (Metaplex, cNFTs, MPL Core), wallet infrastructure, MEV, liquid staking
- Broader Web3 concepts: AMMs, oracles, bridges, ZK proofs, MEV, EVM vs SVM

Answer conversational and historical questions thoroughly and beautifully. Use markdown — headings, bold, lists, inline code for addresses/program IDs. Be specific with numbers, dates, and protocol details. Never refuse to answer a legitimate Web3 question. Never tell the user to paste an address unless they actually need on-chain data.

If the user does want live on-chain data (token audit, transaction decode, price chart, market pulse), the system will render those as structured cards alongside your reply — you don't need to ask for addresses.`;

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

    // ---------- Command mode (UI button actions) ----------
    if (payload.mode === "command") {
      const { command, args } = payload;
      try {
        if (command === "trending") {
          const list = await trending(args.limit ?? 12);
          return Response.json({ trending: list }, { headers: corsHeaders });
        }
        if (command === "chart") {
          const days = (DAYS_MAP[args.timeframe as string] ?? args.days ?? 7) as 1 | 7 | 30 | 365;
          const sym = typeof args.symbol === "string" ? args.symbol.toUpperCase() : null;
          const known = sym && KNOWN[sym] ? KNOWN[sym] : (args.coingeckoId ? { coingeckoId: args.coingeckoId, name: args.name ?? "", symbol: args.symbol ?? "", address: args.address } as Known : null);
          const part = await priceChart({
            address: known?.address ?? args.address ?? null,
            coingeckoId: known?.coingeckoId ?? args.coingeckoId ?? null,
            symbol: known?.symbol ?? args.symbol ?? "SOL",
            name: known?.name ?? args.name ?? "Solana",
            days,
          });
          return Response.json({ parts: [part] }, { headers: corsHeaders });
        }
        if (command === "audit") {
          const sym = typeof args.symbol === "string" ? args.symbol.toUpperCase() : null;
          const known = sym && KNOWN[sym] ? KNOWN[sym] : null;
          const addr = args.address ?? known?.address ?? null;
          const part = await tokenIntel(addr, known);
          return Response.json({ parts: [part] }, { headers: corsHeaders });
        }
        throw new ClientError("Unknown command");
      } catch (e) {
        logErr(`command:${command}`, e);
        return Response.json({ parts: [{ type: "error", message: "We couldn't complete that action. Please try again." }] }, { headers: corsHeaders });
      }
    }

    // ---------- Chat mode ----------
    const { message, history } = payload;
    const intent = classify(message);
    const parts: any[] = [];

    try {
      if (intent.kind === "tx" && intent.address) {
        parts.push(await txDecode(intent.address));
      } else if (intent.kind === "pulse") {
        parts.push(await marketPulse());
      } else if (intent.kind === "chart") {
        const k = intent.known ?? null;
        parts.push(await priceChart({
          address: intent.address ?? k?.address ?? null,
          coingeckoId: k?.coingeckoId ?? null,
          symbol: k?.symbol ?? "SOL",
          name: k?.name ?? "Solana",
          days: intent.days ?? 7,
        }));
      } else if (intent.kind === "token") {
        parts.push(await tokenIntel(intent.address ?? intent.known?.address ?? null, intent.known ?? null));
      } else {
        // Pure conversational web3 question — answer thoroughly
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
      // For chat questions, never surface an error block — fall back to a plain reply
      if (intent.kind === "chat") {
        parts.push({ type: "text", text: "I hit a temporary issue reaching my reasoning model. Please try again in a moment." });
      } else {
        parts.push({ type: "error", message: "We couldn't complete that request. Please try again." });
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
