import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pencil, Trash2, X, Check } from "lucide-react";
import { MessagePart } from "./MessagePart";
import logo from "@/assets/ghost-ai-logo.asset.json";

export type ChatMessage = { id: string; role: "user" | "assistant"; parts: any[] };

export function ChatFeed({
  messages, pending, onEdit, onDelete,
}: {
  messages: ChatMessage[];
  pending: boolean;
  onEdit?: (id: string, next: string) => void;
  onDelete?: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [removing, setRemoving] = useState<Set<string>>(new Set());

  // Smooth-scroll to the bottom whenever a new message arrives or the
  // assistant is thinking. First mount uses instant jump so history threads
  // do not visibly animate on load.
  const firstRenderRef = useRef(true);
  useLayoutEffect(() => {
    const node = bottomRef.current;
    if (!node) return;
    node.scrollIntoView({
      behavior: firstRenderRef.current ? "auto" : "smooth",
      block: "end",
    });
    firstRenderRef.current = false;
  }, [messages.length, pending]);

  // Reset the smooth-scroll flag when we switch conversations (list rebuilt).
  useEffect(() => {
    firstRenderRef.current = true;
  }, [messages[0]?.id]);

  function openMenu(id: string) {
    setMenuFor(id);
    setEditingId(null);
  }
  function closeMenu() {
    setMenuFor(null);
    setEditingId(null);
  }
  function beginEdit(msg: ChatMessage) {
    setEditingId(msg.id);
    setEditValue(msg.parts[0]?.text ?? "");
  }
  function commitEdit() {
    if (editingId && onEdit) onEdit(editingId, editValue);
    closeMenu();
  }
  function beginDelete(id: string) {
    setRemoving((s) => new Set(s).add(id));
    // Wait for the fade animation before removing from state.
    window.setTimeout(() => onDelete?.(id), 220);
    closeMenu();
  }

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
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-6 scroll-smooth relative">
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        {messages.map((m) => {
          const isUser = m.role === "user";
          const isMenuTarget = menuFor === m.id;
          const isEditing = editingId === m.id;
          const isRemoving = removing.has(m.id);
          return (
            <div
              key={m.id}
              className={`flex ${isUser ? "justify-end" : "justify-start"} transition-opacity duration-200 ${
                isRemoving ? "opacity-0 -translate-y-1" : ""
              }`}
            >
              <div
                onClick={isUser && !isEditing ? () => openMenu(m.id) : undefined}
                className={`${
                  isUser
                    ? "max-w-[85%] min-w-0 glass-pill px-4 py-2.5 text-sm break-all whitespace-pre-wrap overflow-hidden cursor-pointer select-text"
                    : "max-w-[95%] min-w-0 w-full flex flex-col gap-3 overflow-hidden"
                } ${isMenuTarget ? "relative z-[60] ring-2 ring-[color:var(--sky)] shadow-[0_10px_45px_-8px_rgba(56,189,248,0.55)]" : ""}`}
              >
                {isUser ? (
                  isEditing ? (
                    <div className="flex flex-col gap-2 min-w-[260px]">
                      <textarea
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        rows={Math.min(6, editValue.split("\n").length + 1)}
                        className="w-full bg-transparent outline-none resize-none text-sm break-all [word-break:break-word]"
                      />
                      <div className="flex justify-end gap-2">
                        <button onClick={closeMenu} className="pill pill-danger active:scale-95">
                          <X className="h-3 w-3" /> Cancel
                        </button>
                        <button onClick={commitEdit} className="pill pill-sky active:scale-95">
                          <Check className="h-3 w-3" /> Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <span className="block break-all whitespace-pre-wrap overflow-hidden max-w-full [word-break:break-word]">
                      {m.parts[0]?.text ?? ""}
                    </span>
                  )
                ) : (
                  m.parts.map((p, i) => <MessagePart key={i} part={p} messageId={m.id} partIndex={i} />)
                )}
              </div>

              {/* Floating liquid-glass menu next to the isolated bubble */}
              {isMenuTarget && !isEditing ? (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute right-3 sm:right-6 z-[70] mt-11 glass p-1.5 flex flex-col gap-1 backdrop-blur-md animate-scale-in"
                  style={{ minWidth: 160 }}
                >
                  <button
                    onClick={() => beginEdit(m)}
                    className="side-item !py-2 !text-xs hover:bg-white/40 dark:hover:bg-white/10"
                  >
                    <Pencil className="h-3.5 w-3.5 sky-text" /> Edit message
                  </button>
                  <button
                    onClick={() => beginDelete(m.id)}
                    className="side-item !py-2 !text-xs text-[color:var(--destructive)] hover:bg-[color:var(--destructive)]/10"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
        {pending ? (
          <div className="flex justify-start">
            <div className="glass-pill px-4 py-2.5 text-sm flex items-center gap-2 text-muted-foreground">
              <span className="spinner" />
              <span>GHOST is thinking…</span>
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {/* Backdrop-blur overlay dimming everything except the isolated bubble */}
      {menuFor ? (
        <div
          onClick={closeMenu}
          className="fixed inset-0 z-[50] backdrop-blur-md bg-black/30 animate-fade-in"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
