import { createFileRoute, useServerFn } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { KeyRound, Save, ShieldCheck } from "lucide-react";
import { GlassCard, Spinner, ErrorBanner } from "@/components/GlassCard";
import { getSettings, saveSettings } from "@/lib/solana.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings · Solana Command Center" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getSettings);
  const saveFn = useServerFn(saveSettings);

  const q = useQuery({ queryKey: ["settings"], queryFn: () => getFn() });
  const m = useMutation({
    mutationFn: (data: { gemini_api_key?: string; helius_rpc_url?: string }) =>
      saveFn({ data }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const [gemini, setGemini] = useState("");
  const [helius, setHelius] = useState("");

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="neon-text">Secure</span> Settings
        </h1>
        <p className="text-muted-foreground">
          Keys are stored encrypted-at-rest in your private row, only readable by you (RLS), and
          accessed exclusively by server functions — never sent to the browser again after save.
        </p>
      </header>

      <GlassCard title="API Credentials" icon={<KeyRound className="h-4 w-4" />} accent="cyan">
        {q.isPending ? <Spinner label="Loading current settings…" /> : null}
        {q.error ? <ErrorBanner message={(q.error as Error).message} /> : null}
        {q.data ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const payload: any = {};
              if (gemini.trim()) payload.gemini_api_key = gemini.trim();
              if (helius.trim()) payload.helius_rpc_url = helius.trim();
              if (!Object.keys(payload).length) return;
              m.mutate(payload, { onSuccess: () => { setGemini(""); setHelius(""); } });
            }}
            className="flex flex-col gap-5"
          >
            <Field
              label="GEMINI_API_KEY"
              status={q.data.hasGemini ? `Saved · ${q.data.geminiMasked}` : "Not set"}
              hasValue={q.data.hasGemini}
              placeholder="AIza…"
              value={gemini}
              onChange={setGemini}
              help="Get yours at aistudio.google.com/apikey"
            />
            <Field
              label="HELIUS_RPC_URL"
              status={q.data.hasHelius ? `Saved · ${q.data.heliusMasked}` : "Not set"}
              hasValue={q.data.hasHelius}
              placeholder="https://mainnet.helius-rpc.com/?api-key=…"
              value={helius}
              onChange={setHelius}
              help="Get yours at dashboard.helius.dev"
            />

            {m.error ? <ErrorBanner message={(m.error as Error).message} /> : null}
            {m.isSuccess ? (
              <div className="text-sm rounded-xl px-3 py-2 bg-[color:var(--neon-cyan)]/10 border border-[color:var(--neon-cyan)]/30 text-[color:var(--neon-cyan)]">
                Saved securely.
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground flex items-center gap-2">
                <ShieldCheck className="h-3.5 w-3.5" /> Row-Level Security enforced
              </span>
              <button className="btn-neon" disabled={m.isPending || (!gemini && !helius)}>
                {m.isPending ? <span className="spinner" /> : <Save className="h-4 w-4" />}
                Save credentials
              </button>
            </div>
          </form>
        ) : null}
      </GlassCard>
    </div>
  );
}

function Field({
  label,
  status,
  hasValue,
  placeholder,
  value,
  onChange,
  help,
}: {
  label: string;
  status: string;
  hasValue: boolean;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  help?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          {label}
        </label>
        <span className={`pill ${hasValue ? "pill-cyan" : ""}`}>{status}</span>
      </div>
      <input
        type="password"
        className="glass-input font-mono text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="off"
      />
      {help ? <span className="text-[11px] text-muted-foreground">{help}</span> : null}
    </div>
  );
}
