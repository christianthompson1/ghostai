import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Menu, Rocket } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useChat } from "@/hooks/useChat";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { Composer } from "@/components/chat/Composer";
import { PumpFunRail } from "@/components/chat/PumpFunRail";
import { ChatActionsContext } from "@/components/chat/ChatActionsContext";

const PRESETS = [
  { label: "🛡️ Audit $BONK", prompt: "Audit $BONK" },
  { label: "📈 $WIF 1H chart", prompt: "Show me a 1H chart for $WIF" },
  { label: "🚀 Pump.fun graduating", prompt: "Show me top pump.fun graduating tokens" },
  { label: "🌊 Solana market pulse", prompt: "Give me the current Solana market pulse" },
];

export function ChatConsole() {
  const navigate = useNavigate();
  const chat = useChat();
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);

  // Broadcast the newest assistant reply so voice mode can read it aloud.
  const lastSpokenRef = useRef<string | null>(null);
  useEffect(() => {
    const last = chat.messages[chat.messages.length - 1];
    if (!last || last.role !== "assistant" || last.id === lastSpokenRef.current) return;
    const text = last.parts.find((p: any) => p.type === "text")?.text;
    lastSpokenRef.current = last.id;
    if (text) window.dispatchEvent(new CustomEvent("ghost:assistant-reply", { detail: text }));
  }, [chat.messages]);


  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  function handlePreset(p: string) {
    setInput(p);
    setSidebarOpen(false);
  }

  const send = chat.send;
  const handleSend = useCallback(() => {
    setInput((v) => {
      const trimmed = v.trim();
      if (trimmed) send(trimmed);
      return trimmed ? "" : v;
    });
  }, [send]);


  function handlePickPumpToken(t: { mint: string; symbol: string }) {
    chat.sendCommand(
      "token_combo",
      { query: t.mint, timeframe: "1h" },
      `Analyze ${t.symbol} (${t.mint.slice(0, 6)}…)`,
    );
    setRailOpen(false);
  }

  return (
    <ChatActionsContext.Provider value={{ updateChartTimeframe: chat.updateChartTimeframe, sendCommand: chat.sendCommand }}>
      <div className="h-screen w-full flex overflow-hidden p-2 sm:p-4 gap-3 bg-[var(--background)]">
        <div className="hidden lg:block w-72 shrink-0 glass rounded-2xl overflow-hidden">
          <Sidebar
            conversations={chat.conversations} activeId={chat.activeId}
            onSelect={chat.select} onNew={chat.newChat} onDelete={chat.remove}
            onSignOut={signOut} presets={PRESETS} onPreset={handlePreset}
          />
        </div>

        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden animate-fade-in">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
            <div className="absolute inset-y-2 left-2 w-72 max-w-[85%] glass rounded-2xl overflow-hidden">
              <Sidebar
                conversations={chat.conversations} activeId={chat.activeId}
                onSelect={(id) => { chat.select(id); setSidebarOpen(false); }}
                onNew={() => { chat.newChat(); setSidebarOpen(false); }}
                onDelete={chat.remove} onSignOut={signOut}
                presets={PRESETS} onPreset={handlePreset}
                onClose={() => setSidebarOpen(false)}
              />
            </div>
          </div>
        ) : null}

        <main className="flex-1 flex flex-col min-w-0 glass rounded-2xl overflow-hidden relative">
          <header className="lg:hidden flex items-center justify-between gap-2 p-3 border-b border-white/20">
            <div className="flex items-center gap-2">
              <button onClick={() => setSidebarOpen(true)} className="btn-ghost active:scale-95" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </button>
              <span className="font-semibold">GHOST <span className="sky-text">AI</span></span>
            </div>
            <button onClick={() => setRailOpen(true)} className="btn-ghost active:scale-95" aria-label="Open pump.fun feed">
              <Rocket className="h-5 w-5" />
            </button>
          </header>

          <ChatFeed
            messages={chat.messages}
            pending={chat.pending}
            onEdit={chat.editMessage}
            onDelete={chat.deleteMessage}
          />
          <Composer value={input} onChange={setInput} onSend={handleSend} disabled={chat.pending} />
        </main>

        <div className="hidden xl:block w-72 shrink-0 glass rounded-2xl overflow-hidden">
          <PumpFunRail onPickToken={handlePickPumpToken} />
        </div>

        {railOpen ? (
          <div className="fixed inset-0 z-40 xl:hidden animate-fade-in">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setRailOpen(false)} />
            <div className="absolute inset-y-2 right-2 w-72 max-w-[85%] glass rounded-2xl overflow-hidden">
              <PumpFunRail onPickToken={handlePickPumpToken} onClose={() => setRailOpen(false)} />
            </div>
          </div>
        ) : null}
      </div>
    </ChatActionsContext.Provider>
  );
}
