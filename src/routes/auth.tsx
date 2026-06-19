import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import logo from "@/assets/ghost-ai-logo.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setInfo("Account created. Check your email if confirmation is required, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err: any) {
      setError(err.message ?? "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md surface-card p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <img src={logo.url} alt="GHOST AI" className="h-16 w-16 rounded-2xl object-cover shadow-sm" />
          <h1 className="text-2xl font-bold tracking-tight">
            GHOST <span className="sky-text">AI</span>
          </h1>
          <p className="text-sm text-muted-foreground text-center">
            Solana security audits, transaction debugging & market pulse.
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Email</label>
          <input
            type="email"
            required
            className="glass-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.com"
            autoComplete="email"
          />
          <label className="text-xs uppercase tracking-wider text-muted-foreground">Password</label>
          <input
            type="password"
            required
            minLength={6}
            className="glass-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
          />

          {error ? (
            <div className="text-sm rounded-xl px-3 py-2 bg-[color:var(--destructive)]/15 border border-[color:var(--destructive)]/30">
              {error}
            </div>
          ) : null}
          {info ? (
            <div className="text-sm rounded-xl px-3 py-2 bg-white/5 border border-white/10">
              {info}
            </div>
          ) : null}

          <button type="submit" className="btn-neon mt-2" disabled={loading}>
            {loading ? <span className="spinner" /> : null}
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground transition"
          onClick={() => {
            setError(null);
            setInfo(null);
            setMode((m) => (m === "signin" ? "signup" : "signin"));
          }}
        >
          {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
