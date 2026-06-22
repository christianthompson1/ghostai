import { MessagePart } from "./MessagePart";
import logo from "@/assets/ghost-ai-logo.asset.json";

export type ChatMessage = { id: string; role: "user" | "assistant"; parts: any[] };

export function ChatFeed({ messages, pending }: { messages: ChatMessage[]; pending: boolean }) {
  if (messages.length === 0 && !pending) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md flex flex-col items-center gap-4">
          <img src={logo.url} alt="" className="h-16 w-16 rounded-2xl object-cover" />
          <h1 className="text-2xl font-bold tracking-tight">
            GHOST <span className="sky-text">AI</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            Ask about any Solana token, paste a transaction signature, or request a price chart.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-6">
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={m.role === "user"
              ? "max-w-[85%] glass-pill px-4 py-2.5 text-sm"
              : "max-w-[95%] w-full flex flex-col gap-3"
            }>
              {m.role === "user" ? (
                <span>{m.parts[0]?.text ?? ""}</span>
              ) : (
                m.parts.map((p, i) => <MessagePart key={i} part={p} messageId={m.id} partIndex={i} />)
              )}
            </div>
          </div>
        ))}
        {pending ? (
          <div className="flex justify-start">
            <div className="glass-pill px-4 py-2.5 text-sm flex items-center gap-2 text-muted-foreground">
              <span className="spinner" />
              <span>GHOST is thinking…</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
