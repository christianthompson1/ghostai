import { createFileRoute, useNavigate, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import logo from "@/assets/ghost-ai-logo.asset.json";

export const Route = createFileRoute("/auth")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/" });
  },
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        setInfo("Account created. Sign in to continue.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      }
    } catch (err: any) {
      setError(err.message ?? "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  async function googleSignIn() {
    setError(null); setGoogleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      navigate({ to: "/" });
    } catch (err: any) {
      setError(err.message ?? "Google sign-in failed.");
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md glass p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <img src={logo.url} alt="GHOST AI" className="h-16 w-16 rounded-2xl object-cover" />
          <h1 className="text-2xl font-bold tracking-tight">
            GHOST <span className="sky-text">AI</span>
          </h1>
          <p className="text-sm text-muted-foreground text-center">
            Conversational Solana intelligence.
          </p>
        </div>

        <button onClick={googleSignIn} disabled={googleLoading} className="btn-glass w-full">
          {googleLoading ? <span className="spinner" /> : (
            <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35 26.7 36 24 36c-5.3 0-9.7-3.1-11.3-7.5l-6.5 5C9.5 39.7 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.6l6.2 5.2C40 36 44 30.5 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
          )}
          Continue with Google
        </button>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.com" autoComplete="email" className="glass-input"
          />
          <input
            type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="glass-input"
          />

          {error ? (
            <div className="text-sm rounded-xl px-3 py-2 bg-[color:var(--destructive)]/15 border border-[color:var(--destructive)]/30">
              {error}
            </div>
          ) : null}
          {info ? (
            <div className="text-sm rounded-xl px-3 py-2 glass-pill">{info}</div>
          ) : null}

          <button type="submit" className="btn-primary mt-1" disabled={loading}>
            {loading ? <span className="spinner" /> : null}
            {mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground transition"
          onClick={() => { setError(null); setInfo(null); setMode((m) => m === "signin" ? "signup" : "signin"); }}
        >
          {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
      </div>
    </main>
  );
}
