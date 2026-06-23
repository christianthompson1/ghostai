import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ChatMessage } from "@/components/chat/ChatFeed";

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
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.parts.map((p: any) => p.type === "text" ? p.text : `[${p.type}]`).join(" "),
      }));
      const { data, error } = await supabase.functions.invoke("solana-chat", {
        body: { message: text, history },
      });
      if (error) throw error;
      const parts = data?.parts ?? [{ type: "error", message: "No response" }];
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
