import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Menu, Flame } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useChat } from "@/hooks/useChat";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { Composer } from "@/components/chat/Composer";
import { TrendingRail } from "@/components/chat/TrendingRail";
import { ChatActionsContext } from "@/components/chat/ChatActionsContext";

const PRESETS = [
  { label: "🛡️ Audit a token", prompt: "Audit this token: " },
  { label: "🧾 Decode a transaction", prompt: "Decode this transaction: " },
  { label: "📈 SOL 7-day chart", prompt: "Show me a 7-day price chart for SOL" },
  { label: "🌊 Solana market pulse", prompt: "Give me the current Solana market pulse" },
];

export function ChatConsole() {
  const navigate = useNavigate();
  const chat = useChat();
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [trendingOpen, setTrendingOpen] = useState(false);

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  function handlePreset(p: string) {
    setInput(p);
    setSidebarOpen(false);
  }

  function handleSend() {
    const v = input.trim();
    if (!v) return;
    setInput("");
    chat.send(v);
  }

  function handlePickToken(t: { symbol: string; name: string; id: string }) {
    chat.sendCommand(
      "chart",
      { symbol: t.symbol, coingeckoId: t.id, name: t.name, timeframe: "1W" },
      `Show ${t.symbol} chart`,
    );
    setTrendingOpen(false);
  }

  return (
    <ChatActionsContext.Provider value={{ updateChartTimeframe: chat.updateChartTimeframe, sendCommand: chat.sendCommand }}>
      <div className="h-screen w-full flex overflow-hidden p-2 sm:p-4 gap-3 bg-[var(--background)]">
        {/* Left: history sidebar */}
        <div className="hidden lg:block w-72 shrink-0 glass rounded-2xl overflow-hidden">
          <Sidebar
            conversations={chat.conversations} activeId={chat.activeId}
            onSelect={chat.select} onNew={chat.newChat} onDelete={chat.remove}
            onSignOut={signOut} presets={PRESETS} onPreset={handlePreset}
          />
        </div>

        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden">
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

        {/* Center: chat console */}
        <main className="flex-1 flex flex-col min-w-0 glass rounded-2xl overflow-hidden relative">
          <header className="lg:hidden flex items-center justify-between gap-2 p-3 border-b border-white/10">
            <div className="flex items-center gap-2">
              <button onClick={() => setSidebarOpen(true)} className="btn-ghost" aria-label="Open menu">
                <Menu className="h-5 w-5" />
              </button>
              <span className="font-semibold">GHOST <span className="sky-text">AI</span></span>
            </div>
            <button onClick={() => setTrendingOpen(true)} className="btn-ghost" aria-label="Open trending">
              <Flame className="h-5 w-5" />
            </button>
          </header>

          <ChatFeed messages={chat.messages} pending={chat.pending} />
          <Composer value={input} onChange={setInput} onSend={handleSend} disabled={chat.pending} />
        </main>

        {/* Right: trending rail */}
        <div className="hidden xl:block w-64 shrink-0 glass rounded-2xl overflow-hidden">
          <TrendingRail onPickToken={handlePickToken} />
        </div>

        {trendingOpen ? (
          <div className="fixed inset-0 z-40 xl:hidden">
            <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setTrendingOpen(false)} />
            <div className="absolute inset-y-2 right-2 w-72 max-w-[85%] glass rounded-2xl overflow-hidden">
              <TrendingRail onPickToken={handlePickToken} onClose={() => setTrendingOpen(false)} />
            </div>
          </div>
        ) : null}
      </div>
    </ChatActionsContext.Provider>
  );
}
