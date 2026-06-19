import { createFileRoute, Outlet, redirect, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { LayoutDashboard, Settings, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: Shell,
});

function Shell() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function signOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const navItems = [
    { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { to: "/settings", label: "Settings", icon: Settings },
  ] as const;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 backdrop-blur-xl bg-background/40 border-b border-white/5">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <Link to="/dashboard" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl glass-panel flex items-center justify-center" style={{ padding: 0 }}>
              <span className="neon-text font-bold">S</span>
            </div>
            <span className="font-semibold tracking-tight hidden sm:inline">
              <span className="neon-text">Solana</span> Command Center
            </span>
          </Link>
          <nav className="flex items-center gap-1.5">
            {navItems.map((it) => {
              const Icon = it.icon;
              const active = pathname.startsWith(it.to);
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition border ${
                    active
                      ? "bg-white/10 border-white/20 text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:bg-white/5"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span className="hidden sm:inline">{it.label}</span>
                </Link>
              );
            })}
            <button onClick={signOut} className="btn-ghost px-3 py-1.5 text-sm">
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
