import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Helpers ----------
async function loadKeys(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("app_settings")
    .select("gemini_api_key, helius_rpc_url")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    gemini: data?.gemini_api_key ?? null,
    helius: data?.helius_rpc_url ?? null,
  };
}

async function helius(rpc: string, method: string, params: unknown[]) {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`Helius RPC ${method} failed: ${res.status}`);
  const j: any = await res.json();
  if (j.error) throw new Error(`Helius RPC error: ${j.error.message ?? "unknown"}`);
  return j.result;
}

async function heliusEnhanced(rpcUrl: string, path: string) {
  // Extract base host + api-key from the rpc url, then hit the enhanced API
  const u = new URL(rpcUrl);
  const apiKey = u.searchParams.get("api-key");
  if (!apiKey) throw new Error("Helius RPC URL must include an ?api-key= param");
  const base = `https://api.helius.xyz`;
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${base}${path}${sep}api-key=${apiKey}`);
  if (!res.ok) throw new Error(`Helius API ${path} failed: ${res.status}`);
  return res.json();
}

async function gemini(apiKey: string, prompt: string, system?: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  const body: any = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1400 },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Gemini error: ${res.status} ${t.slice(0, 200)}`);
  }
  const j: any = await res.json();
  return (
    j?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("\n") ??
    "No response from Gemini."
  );
}

function requireKeys(k: { gemini: string | null; helius: string | null }) {
  if (!k.gemini || !k.helius) {
    throw new Error("Missing API keys. Open Settings and add your Gemini API key and Helius RPC URL.");
  }
  return { gemini: k.gemini, helius: k.helius };
}

// ---------- Settings ----------
export const getSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("app_settings")
      .select("gemini_api_key, helius_rpc_url, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      hasGemini: !!data?.gemini_api_key,
      hasHelius: !!data?.helius_rpc_url,
      // Masked previews only (never return full secrets)
      geminiMasked: data?.gemini_api_key ? mask(data.gemini_api_key) : "",
      heliusMasked: data?.helius_rpc_url ? mask(data.helius_rpc_url) : "",
      updatedAt: data?.updated_at ?? null,
    };
  });

function mask(s: string) {
  if (s.length <= 8) return "•".repeat(s.length);
  return s.slice(0, 4) + "•".repeat(Math.max(4, s.length - 8)) + s.slice(-4);
}

export const saveSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      gemini_api_key: z.string().trim().min(10).max(400).optional().or(z.literal("")),
      helius_rpc_url: z
        .string()
        .trim()
        .url()
        .max(500)
        .optional()
        .or(z.literal("")),
    }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const payload: {
      user_id: string;
      gemini_api_key?: string;
      helius_rpc_url?: string;
    } = { user_id: userId };
    if (data.gemini_api_key) payload.gemini_api_key = data.gemini_api_key;
    if (data.helius_rpc_url) payload.helius_rpc_url = data.helius_rpc_url;
    const { error } = await supabase.from("app_settings").upsert(payload, {
      onConflict: "user_id",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- AI Security Auditor ----------
export const auditContract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ address: z.string().trim().min(32).max(64) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const keys = requireKeys(await loadKeys(context.supabase, context.userId));

    const [account, supply, largest] = await Promise.all([
      helius(keys.helius, "getAccountInfo", [data.address, { encoding: "jsonParsed" }]),
      helius(keys.helius, "getTokenSupply", [data.address]).catch(() => null),
      helius(keys.helius, "getTokenLargestAccounts", [data.address]).catch(() => null),
    ]);

    const summary = {
      address: data.address,
      owner: account?.value?.owner ?? null,
      executable: account?.value?.executable ?? false,
      lamports: account?.value?.lamports ?? 0,
      parsedType: account?.value?.data?.parsed?.type ?? null,
      mintAuthority: account?.value?.data?.parsed?.info?.mintAuthority ?? null,
      freezeAuthority: account?.value?.data?.parsed?.info?.freezeAuthority ?? null,
      supply: supply?.value ?? null,
      topHolders: largest?.value?.slice(0, 5) ?? [],
    };

    const report = await gemini(
      keys.gemini,
      `Audit this Solana on-chain account and produce a concise security report.
Return markdown with these sections: ## Verdict (one of: LOW / MEDIUM / HIGH / CRITICAL risk),
## Key Findings (bullets, each starting with a 🟢 🟡 🔴 emoji),
## Authorities & Control,
## Holder Concentration,
## Recommendation.

Raw on-chain data (JSON):
${JSON.stringify(summary, null, 2)}`,
      "You are a senior Solana security auditor. Be precise, conservative, and call out rug-pull vectors (mint authority not revoked, freeze authority, single-wallet concentration, upgradeable programs).",
    );

    return { summary, report };
  });

// ---------- Transaction Decoder ----------
export const decodeTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ signature: z.string().trim().min(64).max(128) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const keys = requireKeys(await loadKeys(context.supabase, context.userId));

    const tx = await helius(keys.helius, "getTransaction", [
      data.signature,
      { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
    ]);
    if (!tx) throw new Error("Transaction not found.");

    const slim = {
      signature: data.signature,
      slot: tx.slot,
      blockTime: tx.blockTime,
      fee: tx.meta?.fee,
      err: tx.meta?.err,
      status: tx.meta?.err ? "FAILED" : "SUCCESS",
      logMessages: tx.meta?.logMessages?.slice(0, 30) ?? [],
      instructions:
        tx.transaction?.message?.instructions?.map((i: any) => ({
          program: i.program ?? i.programId,
          type: i.parsed?.type ?? null,
          info: i.parsed?.info ?? null,
        })) ?? [],
    };

    const explanation = await gemini(
      keys.gemini,
      `Explain this Solana transaction in plain English to a developer.
Return markdown: ## Summary (one paragraph), ## What Happened (numbered steps), ${
        slim.status === "FAILED" ? "## Failure Reason (deep dive)," : ""
      } ## Programs Involved, ## Net Effect.

Transaction (JSON):
${JSON.stringify(slim, null, 2)}`,
      "You are a Solana protocol expert and transaction debugger. Be direct, technical but readable.",
    );

    return { tx: slim, explanation };
  });

// ---------- Market Pulse ----------
export const marketPulse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const keys = requireKeys(await loadKeys(context.supabase, context.userId));

    // Trending tokens from public CoinGecko (no auth required) — Solana ecosystem
    let trending: any[] = [];
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=solana-ecosystem&order=volume_desc&per_page=8&page=1&price_change_percentage=24h",
      );
      if (res.ok) {
        const j: any = await res.json();
        trending = j.map((c: any) => ({
          id: c.id,
          symbol: c.symbol,
          name: c.name,
          image: c.image,
          price: c.current_price,
          change24h: c.price_change_percentage_24h,
          volume: c.total_volume,
          marketCap: c.market_cap,
        }));
      }
    } catch {
      /* ignore */
    }

    // Current slot/epoch from Helius
    const epochInfo = await helius(keys.helius, "getEpochInfo", []).catch(() => null);

    const summary = await gemini(
      keys.gemini,
      `Write a sharp 4-sentence market pulse for Solana right now, based on this data.
Tone: concise, neutral, no hype, no financial advice. End with one notable mover.

Trending Solana tokens (24h):
${JSON.stringify(trending, null, 2)}

Network state: ${JSON.stringify(epochInfo)}`,
      "You are a Solana market analyst. Keep it factual and brief.",
    ).catch((e) => `_Market summary unavailable: ${e.message}_`);

    return { trending, epochInfo, summary, generatedAt: new Date().toISOString() };
  });

// ---------- Token Insight Scanner ----------
export const tokenInsight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ address: z.string().trim().min(32).max(64) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const keys = requireKeys(await loadKeys(context.supabase, context.userId));

    const [supply, largest, metadata] = await Promise.all([
      helius(keys.helius, "getTokenSupply", [data.address]).catch(() => null),
      helius(keys.helius, "getTokenLargestAccounts", [data.address]).catch(() => null),
      heliusEnhanced(keys.helius, `/v0/token-metadata?`)
        .then((r: any) => r) // not used directly
        .catch(() => null),
      ]);

    // POST token-metadata
    let meta: any = null;
    try {
      const u = new URL(keys.helius);
      const apiKey = u.searchParams.get("api-key");
      const r = await fetch(`https://api.helius.xyz/v0/token-metadata?api-key=${apiKey}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mintAccounts: [data.address], includeOffChain: true }),
      });
      if (r.ok) {
        const j: any = await r.json();
        meta = j?.[0] ?? null;
      }
    } catch { /* ignore */ }

    const holders = largest?.value ?? [];
    const total = Number(supply?.value?.uiAmountString ?? supply?.value?.amount ?? 0);
    const top10 = holders.slice(0, 10).reduce((acc: number, h: any) => acc + Number(h.uiAmount ?? 0), 0);
    const top1 = Number(holders[0]?.uiAmount ?? 0);
    const concentration = total > 0 ? (top10 / total) * 100 : 0;
    const topHolderPct = total > 0 ? (top1 / total) * 100 : 0;

    let riskScore = 0;
    if (concentration > 50) riskScore += 40;
    else if (concentration > 30) riskScore += 25;
    else if (concentration > 15) riskScore += 10;
    if (topHolderPct > 25) riskScore += 25;
    if (!meta?.offChainMetadata?.metadata?.name && !meta?.onChainMetadata?.metadata?.data?.name)
      riskScore += 10;
    if (meta?.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.mintAuthority) riskScore += 15;
    if (meta?.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.freezeAuthority) riskScore += 10;
    riskScore = Math.min(100, riskScore);

    const risk =
      riskScore >= 60 ? "HIGH" : riskScore >= 35 ? "MEDIUM" : riskScore > 0 ? "LOW" : "MINIMAL";

    return {
      address: data.address,
      name:
        meta?.onChainMetadata?.metadata?.data?.name ??
        meta?.offChainMetadata?.metadata?.name ??
        "Unknown",
      symbol:
        meta?.onChainMetadata?.metadata?.data?.symbol ??
        meta?.offChainMetadata?.metadata?.symbol ??
        "—",
      image: meta?.offChainMetadata?.metadata?.image ?? null,
      supply: supply?.value ?? null,
      decimals: supply?.value?.decimals ?? null,
      mintAuthority: meta?.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.mintAuthority ?? null,
      freezeAuthority: meta?.onChainAccountInfo?.accountInfo?.data?.parsed?.info?.freezeAuthority ?? null,
      topHolders: holders.slice(0, 10),
      metrics: {
        riskScore,
        risk,
        top10Concentration: Number(concentration.toFixed(2)),
        topHolderPct: Number(topHolderPct.toFixed(2)),
      },
    };
  });
