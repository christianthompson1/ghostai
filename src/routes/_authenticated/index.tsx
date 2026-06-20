import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Menu } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useChat } from "@/hooks/useChat";
import { Sidebar } from "@/components/chat/Sidebar";
import { ChatFeed } from "@/components/chat/ChatFeed";
import { Composer } from "@/components/chat/Composer";

export const Route = createFileRoute("/_authenticated/")({
  component: ChatPage,
});

const PRESETS = [
  { label: "🛡️ Audit a token", prompt: "Audit this token: " },
  { label: "🧾 Decode a transaction", prompt: "Decode this transaction: " },
  { label: "📈 SOL 7-day chart", prompt: "Show me a 7-day price chart for SOL" },
  { label: "🌊 Solana market pulse", prompt: "Give me the current Solana market pulse" },
];

function ChatPage() {
  const navigate = useNavigate();
  const chat = useChat();
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  return (
    <div className="h-screen w-full flex overflow-hidden">
      {/* Desktop sidebar */}
      <div className="hidden lg:block w-72 shrink-0 border-r border-border">
        <Sidebar
          conversations={chat.conversations}
          activeId={chat.activeId}
          onSelect={chat.select}
          onNew={chat.newChat}
          onDelete={chat.remove}
          onSignOut={signOut}
          presets={PRESETS}
          onPreset={handlePreset}
        />
      </div>

      {/* Mobile drawer */}
      {sidebarOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setSidebarOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85%]">
            <Sidebar
              conversations={chat.conversations}
              activeId={chat.activeId}
              onSelect={(id) => { chat.select(id); setSidebarOpen(false); }}
              onNew={() => { chat.newChat(); setSidebarOpen(false); }}
              onDelete={chat.remove}
              onSignOut={signOut}
              presets={PRESETS}
              onPreset={handlePreset}
              onClose={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="lg:hidden flex items-center gap-2 p-3 border-b border-border">
          <button onClick={() => setSidebarOpen(true)} className="btn-ghost" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-semibold">GHOST <span className="sky-text">AI</span></span>
        </header>

        <ChatFeed messages={chat.messages} pending={chat.pending} />
        <Composer value={input} onChange={setInput} onSend={handleSend} disabled={chat.pending} />
      </div>
    </div>
  );
}
