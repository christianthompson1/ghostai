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
  head: () => ({
    meta: [
      { title: "Sign in to GHOST AI — Solana Intelligence Terminal" },
      {
        name: "description",
        content: "Sign in or create a GHOST AI account to access the conversational Solana audit and market terminal.",
      },
      { property: "og:title", content: "Sign in to GHOST AI" },
      { property: "og:description", content: "Access the conversational Solana audit and market terminal." },
      { property: "og:url", content: "https://ghostprotocol1.lovable.app/auth" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://ghostprotocol1.lovable.app/auth" }],
  }),
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false);
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

  async function appleSignIn() {
    setError(null); setAppleLoading(true);
    try {
      const result = await lovable.auth.signInWithOAuth("apple", {
        redirect_uri: window.location.origin,
      });
      if (result.error) throw result.error;
      if (result.redirected) return;
      navigate({ to: "/" });
    } catch (err: any) {
      setError(err.message ?? "Apple sign-in failed.");
    } finally {
      setAppleLoading(false);
    }
  }


  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md glass p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3">
          <img src={logo.url} alt="GHOST AI" className="h-16 w-16 rounded-2xl object-cover" />
          <h1 className="text-2xl font-bold tracking-tight text-center">
            GHOST <span className="sky-text">AI</span> — Conversational Solana Intelligence
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

        <button onClick={appleSignIn} disabled={appleLoading} className="btn-glass w-full">
          {appleLoading ? <span className="spinner" /> : (
            <svg width="18" height="18" viewBox="0 0 384 512" fill="currentColor" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"/></svg>
          )}
          Continue with Apple
        </button>



        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@domain.com" autoComplete="email" aria-label="Email address" className="glass-input"
          />
          <input
            type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password" aria-label="Password" autoComplete={mode === "signup" ? "new-password" : "current-password"}
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
