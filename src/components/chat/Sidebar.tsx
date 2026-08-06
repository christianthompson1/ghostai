import { Plus, MessageSquare, Sun, Moon, LogOut, Trash2, X, LineChart, ClipboardList, UserRound, Home, Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { WalletButton } from "@/components/wallet/WalletButton";
import logo from "@/assets/ghost-ai-logo.asset.json";
import { useTheme } from "@/hooks/useTheme";

type Conv = { id: string; title: string; updated_at: string };

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onSignOut,
  presets,
  onPreset,
  onClose,
}: {
  conversations: Conv[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onSignOut: () => void;
  presets: { label: string; prompt: string }[];
  onPreset: (p: string) => void;
  onClose?: () => void;
}) {
  const { theme, toggle } = useTheme();
  return (
    <aside className="h-full w-full flex flex-col gap-3 p-3"
      style={{ background: "var(--sidebar)", backdropFilter: "blur(20px) saturate(160%)" }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <img src={logo.url} alt="" className="h-8 w-8 rounded-lg object-cover" />
          <span className="font-semibold tracking-tight">
            GHOST <span className="sky-text">AI</span>
          </span>
        </div>
        {onClose ? (
          <button onClick={onClose} className="btn-ghost lg:hidden" aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      <button onClick={onNew} className="btn-primary w-full">
        <Plus className="h-4 w-4" /> New chat
      </button>

      <nav className="flex flex-col gap-1">
        <Link to="/trade" onClick={onClose} className="side-item" activeProps={{ className: "side-item active" }}>
          <LineChart className="h-3.5 w-3.5 shrink-0 sky-text" />
          <span className="truncate">Paper Trading</span>
        </Link>
        <Link to="/tasks" onClick={onClose} className="side-item" activeProps={{ className: "side-item active" }}>
          <ClipboardList className="h-3.5 w-3.5 shrink-0 sky-text" />
          <span className="truncate">Task Marketplace</span>
        </Link>
        <Link to="/profile" onClick={onClose} className="side-item" activeProps={{ className: "side-item active" }}>
          <UserRound className="h-3.5 w-3.5 shrink-0 sky-text" />
          <span className="truncate">Wallet Hub</span>
        </Link>
      </nav>


      <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 mt-1">Quick prompts</div>
      <div className="flex flex-col gap-1">
        {presets.map((p) => (
          <button key={p.label} className="side-item" onClick={() => onPreset(p.prompt)}>
            <span className="text-base">{p.label.split(" ")[0]}</span>
            <span className="truncate">{p.label.replace(/^\S+\s/, "")}</span>
          </button>
        ))}
      </div>

      <div className="text-[11px] uppercase tracking-wider text-muted-foreground px-2 mt-3">History</div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
        {conversations.length === 0 ? (
          <div className="text-xs text-muted-foreground px-2 py-3">No chats yet.</div>
        ) : conversations.map((c) => (
          <div key={c.id} className={`side-item ${activeId === c.id ? "active" : ""} group`}>
            <button onClick={() => onSelect(c.id)} className="flex items-center gap-2 min-w-0 flex-1 text-left">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{c.title}</span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
              className="opacity-0 group-hover:opacity-100 transition text-muted-foreground hover:text-[color:var(--destructive)]"
              aria-label="Delete conversation"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border/60">
        <button onClick={toggle} className="btn-ghost flex-1" aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          <span>{theme === "dark" ? "Light" : "Dark"}</span>
        </button>
        <button onClick={onSignOut} className="btn-ghost" aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
