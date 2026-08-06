import { Link, useRouterState } from "@tanstack/react-router";
import { MessageSquare, CandlestickChart, User, Wallet } from "lucide-react";

/**
 * Floating liquid-glass navigation dock.
 * Hidden entirely on the AI chat view ("/"), visible everywhere else.
 */
export function NavDock() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChat = pathname === "/" || pathname === "/chat";
  if (isChat) return null;

  const items = [
    { to: "/trade", label: "Trade", Icon: CandlestickChart },
    { to: "/", label: "Chat", Icon: MessageSquare },
    { to: "/wallet", label: "Wallet", Icon: Wallet },
    { to: "/profile", label: "Profile", Icon: User },
  ] as const;

  return (
    <nav
      aria-label="Primary"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 glass-strong rounded-full px-2 py-2 flex items-center gap-1 border border-white/40"
      style={{ backdropFilter: "blur(20px) saturate(180%)" }}
    >
      {items.map(({ to, label, Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={label}
            to={to}
            aria-label={label}
            className={`h-11 w-11 grid place-items-center rounded-full transition active:scale-95 ${
              active
                ? "bg-[color:var(--sky)]/20 text-[color:var(--sky)]"
                : "text-muted-foreground hover:text-foreground hover:bg-white/30"
            }`}
          >
            <Icon className="h-5 w-5" />
          </Link>
        );
      })}
    </nav>
  );
}
