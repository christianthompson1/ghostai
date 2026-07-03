import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/components/chat/ChatFeed";
import { decodeTransaction, fetchTokenMetrics, resolveTicker } from "@/lib/ghost-backend";

function extractTicker(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  // Skip anything that looks like a mint (32-44 base58) or tx sig (87-88).
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return null;
  if (/^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(t)) return null;
  let m = t.match(/^\$([A-Za-z0-9]{2,10})$/);
  if (m) return m[1];
  m = t.match(/^(?:analyze|audit|chart|show(?:\s+me)?|scan|check)\s+\$?([A-Za-z0-9]{2,10})$/i);
  if (m) return m[1];
  m = t.match(/^([A-Z]{2,10})$/);
  if (m) return m[1];
  return null;
}



type Conv = { id: string; title: string; updated_at: string };

export function useChat() {
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);

  const loadConversations = useCallback(async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    setConversations((data as Conv[] | null) ?? []);
  }, []);

  const loadMessages = useCallback(async (id: string) => {
    const { data } = await supabase
      .from("messages")
      .select("id, role, parts")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true });
    setMessages((data as ChatMessage[] | null) ?? []);
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);
  useEffect(() => {
    if (activeId) loadMessages(activeId);
    else setMessages([]);
  }, [activeId, loadMessages]);

  const newChat = useCallback(() => {
    setActiveId(null);
    setMessages([]);
  }, []);

  const select = useCallback((id: string) => setActiveId(id), []);

  const remove = useCallback(async (id: string) => {
    await supabase.from("conversations").delete().eq("id", id);
    if (activeId === id) newChat();
    loadConversations();
  }, [activeId, newChat, loadConversations]);

  async function ensureConv(text: string): Promise<{ convId: string; uid: string } | null> {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) return null;
    let convId = activeId;
    if (!convId) {
      const title = text.slice(0, 60);
      const { data: c, error } = await supabase
        .from("conversations").insert({ user_id: uid, title })
        .select("id, title, updated_at").single();
      if (error || !c) return null;
      convId = c.id;
      setActiveId(convId);
      setConversations((prev) => [c as Conv, ...prev]);
    }
    return { convId, uid };
  }

  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    const trimmed = text.trim();

    // ⛩️ Front-gate interceptor: if input is a Solana transaction signature
    // (87-88 base58 chars), bypass the Gemini reasoning model and route
    // directly to the Helius transaction decoder.
    const isTxSig = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(trimmed);


    setPending(true);
    const ctx = await ensureConv(text);
    if (!ctx) { setPending(false); return; }
    const { convId, uid } = ctx;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
    setMessages((m) => [...m, userMsg]);
    await supabase.from("messages").insert({
      conversation_id: convId, user_id: uid, role: "user", parts: userMsg.parts as any,
    });


    try {
      let parts: any[];
      const ticker = isTxSig ? null : extractTicker(trimmed);
      if (isTxSig) {
        // 🛰️ Route straight to the Ghost AI external backend for tx decoding.
        try {
          const decoded = await decodeTransaction(trimmed);
          const tx = decoded?.transaction ?? {};
          parts = [
            {
              type: "tx_decode",
              signature: decoded?.signature ?? trimmed,
              status: tx.transactionError ? "FAILED" : "SUCCESS",
              txType: tx.type ?? "TRANSACTION",
              source: tx.source ?? "helius",
              fee: tx.fee ?? 0,
              slot: tx.slot,
              timestamp: tx.timestamp,
              programs: Array.isArray(tx.instructions)
                ? Array.from(new Set(tx.instructions.map((i: any) => i.programId).filter(Boolean)))
                : [],
              explanation: tx.description ?? "Decoded via Ghost AI backend.",
            },
          ];
        } catch (e: any) {
          parts = [{ type: "error", message: e?.message ?? "Transaction decode failed" }];
        }
      } else if (ticker) {
        // 🎯 Ticker fast-path: DexScreener search → most-liquid pair → backend audit.
        const resolved = await resolveTicker(ticker);
        if (!resolved) {
          parts = [{
            type: "error",
            message: `Token ticker "${ticker.toUpperCase()}" not found. Please provide the contract address to initialize the glass analytics interface.`,
          }];
        } else {
          const metrics = await fetchTokenMetrics(resolved.address);
          parts = [
            {
              type: "token_intel",
              address: resolved.address,
              symbol: resolved.symbol,
              name: resolved.name,
              image: resolved.image,
              price: metrics?.priceUsd ?? resolved.priceUsd,
              change24h: resolved.change24h,
              supply: metrics?.totalSupply,
              marketCap: metrics?.fdv ?? resolved.fdv,
              liquidity: metrics?.liquidityUsd ?? resolved.liquidityUsd,
              volume24h: resolved.volume24h,
              risk: "LOW",
              riskScore: 20,
              risks: [],
              summary: `Auto-resolved ${resolved.symbol ?? ticker.toUpperCase()} from the most-liquid Solana pair on ${resolved.dex ?? "DexScreener"}.`,
            },
            {
              type: "price_chart",
              address: resolved.address,
              symbol: resolved.symbol,
              name: resolved.name,
              image: resolved.image,
              current: resolved.priceUsd,
              change: resolved.change24h,
              poolAddress: resolved.pairAddress,
              timeframe: "1D",
            },
          ];
        }
      } else {
        const history = messages.slice(-6).map((m) => ({
          role: m.role,
          content: m.parts.map((p: any) => p.type === "text" ? p.text : `[${p.type}]`).join(" "),
        }));
        const { data, error } = await supabase.functions.invoke("solana-chat", {
          body: { message: text, history },
        });
        if (error) throw error;
        parts = data?.parts ?? [{ type: "error", message: "No response" }];
      }

      const aiMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", parts };

      setMessages((m) => [...m, aiMsg]);
      await supabase.from("messages").insert({
        conversation_id: convId, user_id: uid, role: "assistant", parts: parts as any,
      });
      await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    } catch (e: any) {
      const aiMsg: ChatMessage = {
        id: crypto.randomUUID(), role: "assistant",
        parts: [{ type: "error", message: e.message ?? "Request failed" }],
      };
      setMessages((m) => [...m, aiMsg]);
    } finally {
      setPending(false);
    }
  }, [activeId, messages]);

  // Run a UI-driven command (e.g. chart timeframe, click-a-token).
  // If `inline` is true, the returned part replaces an existing part by id rather than appending.
  const runCommand = useCallback(async (command: string, args: Record<string, any>): Promise<any | null> => {
    try {
      const { data, error } = await supabase.functions.invoke("solana-chat", {
        body: { command, args },
      });
      if (error) throw error;
      return data;
    } catch (e) {
      console.error("runCommand failed", e);
      return null;
    }
  }, []);

  const sendCommand = useCallback(async (command: string, args: Record<string, any>, userLabel: string) => {
    setPending(true);
    const ctx = await ensureConv(userLabel);
    if (!ctx) { setPending(false); return; }
    const { convId, uid } = ctx;

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text: userLabel }] };
    setMessages((m) => [...m, userMsg]);
    await supabase.from("messages").insert({
      conversation_id: convId, user_id: uid, role: "user", parts: userMsg.parts as any,
    });

    const data = await runCommand(command, args);
    const parts = data?.parts ?? [{ type: "error", message: "No response" }];
    const aiMsg: ChatMessage = { id: crypto.randomUUID(), role: "assistant", parts };
    setMessages((m) => [...m, aiMsg]);
    await supabase.from("messages").insert({
      conversation_id: convId, user_id: uid, role: "assistant", parts: parts as any,
    });
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);
    setPending(false);
  }, [activeId, runCommand]);

  // Replace a single price_chart message-part in place (used by timeframe toggle)
  const updateChartTimeframe = useCallback(async (messageId: string, partIndex: number, timeframe: string) => {
    const msg = messages.find((m) => m.id === messageId);
    const current: any = msg?.parts[partIndex];
    if (!current) return;
    const query = current.address ?? current.symbol;
    if (!query) return;
    const data = await runCommand("chart", { timeframe, query });
    const newPart = data?.parts?.[0];
    if (!newPart) return;
    setMessages((all) => all.map((m) => {
      if (m.id !== messageId) return m;
      const next = [...m.parts];
      next[partIndex] = newPart;
      return { ...m, parts: next };
    }));
  }, [messages, runCommand]);

  return {
    conversations, activeId, messages, pending,
    send, newChat, select, remove,
    sendCommand, runCommand, updateChartTimeframe,
  };
}
