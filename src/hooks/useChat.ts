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

  const send = useCallback(async (text: string) => {
    if (!text.trim()) return;
    setPending(true);
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) { setPending(false); return; }

    // Ensure conversation
    let convId = activeId;
    if (!convId) {
      const title = text.slice(0, 60);
      const { data: c, error } = await supabase
        .from("conversations")
        .insert({ user_id: uid, title })
        .select("id, title, updated_at")
        .single();
      if (error || !c) { setPending(false); return; }
      convId = c.id;
      setActiveId(convId);
      setConversations((prev) => [c as Conv, ...prev]);
    }

    // Optimistic user message
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] };
    setMessages((m) => [...m, userMsg]);
    await supabase.from("messages").insert({
      conversation_id: convId, user_id: uid, role: "user", parts: userMsg.parts as any,
    });

    // Call edge function
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

  return { conversations, activeId, messages, pending, send, newChat, select, remove };
}
