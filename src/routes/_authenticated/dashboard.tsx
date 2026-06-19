import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ShieldCheck, ScanSearch, FileSearch, Activity, Sparkles } from "lucide-react";
import { GlassCard, Spinner, ErrorBanner } from "@/components/GlassCard";
import {
  auditContract,
  decodeTransaction,
  marketPulse,
  tokenInsight,
} from "@/lib/solana.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · GHOST AI" }] }),
  component: Dashboard,
});

function Dashboard() {
  return (
    <div className="flex flex-col gap-6 sm:gap-8">
      <header className="flex flex-col gap-2">
        <span className="pill pill-cyan w-fit">
          <Sparkles className="h-3 w-3" /> GHOST AI · v1
        </span>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          Your <span className="sky-text">Solana</span> mission control.
        </h1>
        <p className="text-muted-foreground max-w-2xl">
          Audit contracts, decode transactions, scan tokens, and track the market — powered by
          live Helius data and Gemini AI, called only from secure server functions.
        </p>
      </header>

      <MarketPulseCard />

      <div className="grid gap-6 md:grid-cols-2">
        <AuditorCard />
        <DecoderCard />
      </div>

      <TokenInsightCard />
    </div>
  );
}

/* ---------- Market Pulse ---------- */
function MarketPulseCard() {
  const fn = useServerFn(marketPulse);
  const q = useQuery<any>({
    queryKey: ["marketPulse"],
    queryFn: () => fn() as any,
    refetchInterval: 60_000,
  });

  return (
    <GlassCard title="Real-Time Market Pulse" icon={<Activity className="h-4 w-4" />} accent="cyan">
      {q.isPending ? <Spinner label="Pulling trending tokens…" /> : null}
      {q.error ? <ErrorBanner message={(q.error as Error).message} /> : null}
      {q.data ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_1.4fr]">
          <div className="glass-panel p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {q.data.summary}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="text-left py-2 px-2">Token</th>
                  <th className="text-right py-2 px-2">Price</th>
                  <th className="text-right py-2 px-2">24h</th>
                  <th className="text-right py-2 px-2 hidden sm:table-cell">Volume</th>
                </tr>
              </thead>
              <tbody>
                {q.data.trending.map((t: any) => (
                  <tr key={t.id} className="border-t border-white/5">
                    <td className="py-2 px-2 flex items-center gap-2">
                      {t.image ? <img src={t.image} alt="" className="h-5 w-5 rounded-full" /> : null}
                      <span className="font-medium">{t.symbol?.toUpperCase()}</span>
                      <span className="text-muted-foreground hidden sm:inline">{t.name}</span>
                    </td>
                    <td className="py-2 px-2 text-right font-mono">${fmtPrice(t.price)}</td>
                    <td
                      className={`py-2 px-2 text-right font-mono ${
                        (t.change24h ?? 0) >= 0 ? "text-[color:var(--sky)]" : "text-[color:var(--destructive)]"
                      }`}
                    >
                      {(t.change24h ?? 0).toFixed(2)}%
                    </td>
                    <td className="py-2 px-2 text-right font-mono hidden sm:table-cell">
                      ${fmtCompact(t.volume)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}

/* ---------- Auditor ---------- */
function AuditorCard() {
  const fn = useServerFn(auditContract);
  const [address, setAddress] = useState("");
  const m = useMutation<any, Error, string>({ mutationFn: (a) => fn({ data: { address: a } }) as any });

  return (
    <GlassCard title="AI Security Auditor" icon={<ShieldCheck className="h-4 w-4" />} accent="cyan">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (address.trim()) m.mutate(address.trim());
        }}
        className="flex gap-2"
      >
        <input
          className="glass-input"
          placeholder="Contract / mint address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button className="btn-neon" disabled={m.isPending}>
          {m.isPending ? <span className="spinner" /> : <ShieldCheck className="h-4 w-4" />}
          Audit
        </button>
      </form>
      {m.isPending ? <Spinner label="Querying Helius + Gemini…" /> : null}
      {m.error ? <ErrorBanner message={(m.error as Error).message} /> : null}
      {m.data ? (
        <div className="glass-panel p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-96 overflow-auto">
          {m.data.report}
        </div>
      ) : null}
    </GlassCard>
  );
}

/* ---------- Decoder ---------- */
function DecoderCard() {
  const fn = useServerFn(decodeTransaction);
  const [sig, setSig] = useState("");
  const m = useMutation<any, Error, string>({ mutationFn: (s) => fn({ data: { signature: s } }) as any });

  return (
    <GlassCard title="Transaction Decoder" icon={<FileSearch className="h-4 w-4" />} accent="magenta">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (sig.trim()) m.mutate(sig.trim());
        }}
        className="flex gap-2"
      >
        <input
          className="glass-input font-mono text-xs"
          placeholder="Transaction signature"
          value={sig}
          onChange={(e) => setSig(e.target.value)}
        />
        <button className="btn-neon" disabled={m.isPending}>
          {m.isPending ? <span className="spinner" /> : <FileSearch className="h-4 w-4" />}
          Decode
        </button>
      </form>
      {m.isPending ? <Spinner label="Decoding on-chain transaction…" /> : null}
      {m.error ? <ErrorBanner message={(m.error as Error).message} /> : null}
      {m.data ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <span className={`pill ${m.data.tx.status === "FAILED" ? "pill-danger" : "pill-cyan"}`}>
              {m.data.tx.status}
            </span>
            <span className="pill">Slot {m.data.tx.slot}</span>
            <span className="pill">Fee {m.data.tx.fee} lamports</span>
          </div>
          <div className="glass-panel p-4 text-sm whitespace-pre-wrap leading-relaxed max-h-96 overflow-auto">
            {m.data.explanation}
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}

/* ---------- Token Insight ---------- */
function TokenInsightCard() {
  const fn = useServerFn(tokenInsight);
  const [address, setAddress] = useState("");
  const m = useMutation<any, Error, string>({ mutationFn: (a) => fn({ data: { address: a } }) as any });

  return (
    <GlassCard title="Token Insight Scanner" icon={<ScanSearch className="h-4 w-4" />} accent="magenta">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (address.trim()) m.mutate(address.trim());
        }}
        className="flex gap-2"
      >
        <input
          className="glass-input"
          placeholder="Token mint address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button className="btn-neon" disabled={m.isPending}>
          {m.isPending ? <span className="spinner" /> : <ScanSearch className="h-4 w-4" />}
          Scan
        </button>
      </form>
      {m.isPending ? <Spinner label="Reading mint, supply, and holders…" /> : null}
      {m.error ? <ErrorBanner message={(m.error as Error).message} /> : null}
      {m.data ? (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="glass-panel p-4 flex flex-col gap-2">
            <div className="flex items-center gap-3">
              {m.data.image ? (
                <img src={m.data.image} alt="" className="h-10 w-10 rounded-full" />
              ) : (
                <div className="h-10 w-10 rounded-full bg-white/5" />
              )}
              <div>
                <div className="font-semibold">{m.data.name}</div>
                <div className="text-xs text-muted-foreground">{m.data.symbol}</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground break-all font-mono mt-1">{m.data.address}</div>
          </div>

          <div className="glass-panel p-4 flex flex-col gap-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Risk score</div>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold neon-text">{m.data.metrics.riskScore}</span>
              <span
                className={`pill ${
                  m.data.metrics.risk === "HIGH"
                    ? "pill-danger"
                    : m.data.metrics.risk === "MEDIUM"
                    ? "pill-magenta"
                    : "pill-cyan"
                }`}
              >
                {m.data.metrics.risk}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              Top-10 holders: <span className="font-mono">{m.data.metrics.top10Concentration}%</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Largest holder: <span className="font-mono">{m.data.metrics.topHolderPct}%</span>
            </div>
          </div>

          <div className="glass-panel p-4 flex flex-col gap-2 text-xs">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Authorities</div>
            <AuthLine label="Mint" value={m.data.mintAuthority} good={!m.data.mintAuthority} />
            <AuthLine label="Freeze" value={m.data.freezeAuthority} good={!m.data.freezeAuthority} />
            <div className="text-muted-foreground mt-1">
              Supply{" "}
              <span className="font-mono text-foreground">
                {m.data.supply?.uiAmountString ?? "—"}
              </span>
            </div>
          </div>

          <div className="glass-panel p-4 md:col-span-3 overflow-x-auto">
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Top holders</div>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="text-left py-1.5">#</th>
                  <th className="text-left py-1.5">Address</th>
                  <th className="text-right py-1.5">Amount</th>
                </tr>
              </thead>
              <tbody>
                {m.data.topHolders.map((h: any, i: number) => (
                  <tr key={h.address} className="border-t border-white/5">
                    <td className="py-1.5">{i + 1}</td>
                    <td className="py-1.5 font-mono text-xs break-all">{h.address}</td>
                    <td className="py-1.5 text-right font-mono">{h.uiAmountString ?? h.amount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </GlassCard>
  );
}

function AuthLine({ label, value, good }: { label: string; value: string | null; good: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label} authority</span>
      <span className={`pill ${good ? "pill-cyan" : "pill-danger"}`}>
        {good ? "Revoked" : "Active"}
      </span>
    </div>
  );
}

function fmtPrice(n: number | null | undefined) {
  if (n == null) return "—";
  if (n < 0.01) return n.toExponential(2);
  if (n < 1) return n.toFixed(4);
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function fmtCompact(n: number | null | undefined) {
  if (n == null) return "—";
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
