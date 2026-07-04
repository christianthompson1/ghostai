import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Wallet, Sparkles } from "lucide-react";
import { initDemoAccount, submitDemoTrade, resolveTicker, type DemoAccount, type ResolvedTicker } from "@/lib/ghost-backend";

export const Route = createFileRoute("/_authenticated/demo")({
  component: DemoTradingPage,
  head: () => ({
    meta: [
      { title: "Demo Paper Trading — Ghost AI" },
      { name: "description", content: "Practice Solana trading with a $1,000 mock portfolio powered by the Ghost AI engine." },
    ],
  }),
});

const STORAGE_KEY = "ghost.demo.userId";

type Position = {
  mint: string;
  symbol: string;
  amount: number;
  avgCost: number;    // average USD entry per token
  livePrice: number;  // current market price
};

function DemoTradingPage() {
  const [account, setAccount] = useState<DemoAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState("BONK");
  const [amount, setAmount] = useState("1000");
  const [resolved, setResolved] = useState<ResolvedTicker | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [submitting, setSubmitting] = useState<"buy" | "sell" | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, ResolvedTicker>>({});

  // Boot account (idempotent)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      const acc = await initDemoAccount(stored ?? undefined);
      if (cancelled) return;
      window.localStorage.setItem(STORAGE_KEY, acc.userId);
      setAccount(acc);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Quote the ticker the user is about to trade
  useEffect(() => {
    let cancelled = false;
    const q = ticker.trim();
    if (!q) { setResolved(null); return; }
    setQuoting(true);
    const t = setTimeout(async () => {
      const r = await resolveTicker(q);
      if (!cancelled) { setResolved(r); setQuoting(false); }
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ticker]);

  // Refresh live prices for held positions for unrealized PnL
  useEffect(() => {
    if (!account) return;
    let cancelled = false;
    async function refresh() {
      const mints = Object.keys(account!.portfolio);
      const symbolByMint: Record<string, string> = {};
      account!.trades.forEach((t) => { symbolByMint[t.mint] = t.symbol; });
      const entries = await Promise.all(
        mints.map(async (mint) => {
          const sym = symbolByMint[mint] ?? mint.slice(0, 4);
          const r = await resolveTicker(sym);
          return [mint, r] as const;
        }),
      );
      if (cancelled) return;
      const next: Record<string, ResolvedTicker> = {};
      entries.forEach(([m, r]) => { if (r) next[m] = r; });
      setLivePrices(next);
    }
    refresh();
    const id = setInterval(refresh, 20000);
    return () => { cancelled = true; clearInterval(id); };
  }, [account]);

  const positions: Position[] = useMemo(() => {
    if (!account) return [];
    return Object.entries(account.portfolio).map(([mint, qty]) => {
      const buys = account.trades.filter((t) => t.mint === mint && t.action === "buy");
      const totalCost = buys.reduce((s, b) => s + b.totalUsd, 0);
      const totalQty = buys.reduce((s, b) => s + b.amount, 0);
      const avgCost = totalQty > 0 ? totalCost / totalQty : 0;
      const symbol = account.trades.find((t) => t.mint === mint)?.symbol ?? mint.slice(0, 4);
      const live = livePrices[mint];
      return { mint, symbol, amount: qty, avgCost, livePrice: live?.priceUsd ?? avgCost };
    });
  }, [account, livePrices]);

  const portfolioValue = positions.reduce((s, p) => s + p.amount * p.livePrice, 0);
  const totalEquity = (account?.balanceUsd ?? 0) + portfolioValue;
  const totalUnrealized = positions.reduce((s, p) => s + (p.livePrice - p.avgCost) * p.amount, 0);
  const totalPct = totalEquity > 0 ? ((totalEquity - 1000) / 1000) * 100 : 0;

  async function trade(action: "buy" | "sell") {
    if (!account || !resolved?.address || !resolved.priceUsd) {
      setToast({ kind: "err", msg: "No live quote for that ticker yet." });
      return;
    }
    const usd = Number(amount);
    if (!Number.isFinite(usd) || usd <= 0) {
      setToast({ kind: "err", msg: "Enter a positive USD amount." });
      return;
    }
    setSubmitting(action);
    const tokenAmount = usd / resolved.priceUsd;
    const res = await submitDemoTrade({
      userId: account.userId,
      action,
      mint: resolved.address,
      symbol: resolved.symbol ?? ticker.toUpperCase(),
      amount: tokenAmount,
      priceUsd: resolved.priceUsd,
    });
    setSubmitting(null);
    if (!res.ok) { setToast({ kind: "err", msg: res.error ?? "Trade failed" }); return; }
    // Refresh account state
    const fresh = await initDemoAccount(account.userId);
    setAccount(fresh);
    setToast({ kind: "ok", msg: `${action === "buy" ? "Bought" : "Sold"} ${tokenAmount.toFixed(4)} ${resolved.symbol}` });
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className="min-h-screen w-full p-3 sm:p-6 bg-[var(--background)]">
      <div className="max-w-6xl mx-auto flex flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="btn-ghost active:scale-95" aria-label="Back to chat">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
                Demo <span className="sky-text">Paper Trading</span>
              </h1>
              <p className="text-xs text-muted-foreground">Simulated Solana trades — no real funds involved.</p>
            </div>
          </div>
          <Link to="/" className="pill pill-sky">
            <Sparkles className="h-3 w-3" /> Chat
          </Link>
        </header>

        {/* Portfolio panel */}
        <section className="glass p-5 flex flex-col gap-4 overflow-hidden relative backdrop-blur-md">
          <div className="absolute inset-0 -z-10 opacity-40 pointer-events-none"
               style={{ background: "var(--iridescent)", filter: "blur(40px)" }} />
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl glass-pill grid place-items-center sky-text">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Mock portfolio balance</div>
                <div className="text-3xl font-bold tabular-nums">
                  {loading ? <span className="shimmer-glass px-8">Streaming pool metrics…</span>
                           : `$${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Stat label="Cash" value={`$${(account?.balanceUsd ?? 1000).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
              <Stat label="Positions" value={`$${portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
              <Stat label="Unrealized PnL"
                    value={`${totalUnrealized >= 0 ? "+" : "−"}$${Math.abs(totalUnrealized).toFixed(2)}`}
                    tone={totalUnrealized >= 0 ? "ok" : "danger"} />
              <Stat label="Total return"
                    value={`${totalPct >= 0 ? "+" : ""}${totalPct.toFixed(2)}%`}
                    tone={totalPct >= 0 ? "ok" : "danger"} />
            </div>
          </div>
        </section>

        {/* Trade blocks */}
        <section className="grid md:grid-cols-2 gap-4">
          <div className="glass p-5 flex flex-col gap-3 backdrop-blur-md">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Simulate trade</h2>
              {quoting ? <span className="text-[10px] shimmer-glass px-2 py-0.5">Streaming pool metrics…</span>
                       : resolved ? <span className="pill pill-sky">${resolved.priceUsd?.toFixed(6) ?? "—"}</span>
                       : <span className="text-[10px] text-muted-foreground">No quote</span>}
            </div>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Ticker</label>
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="e.g. BONK, WIF, FART"
              className="glass-pill px-3 py-2 text-sm bg-white/40 dark:bg-white/5 outline-none"
            />
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount (USD)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              className="glass-pill px-3 py-2 text-sm bg-white/40 dark:bg-white/5 outline-none tabular-nums"
            />
            {resolved ? (
              <div className="text-[11px] text-muted-foreground">
                ≈ <span className="font-mono">{(Number(amount) / (resolved.priceUsd || 1)).toFixed(4)}</span> {resolved.symbol}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 mt-1">
              <button
                onClick={() => trade("buy")}
                disabled={!!submitting || !resolved?.priceUsd}
                className="pill pill-ok justify-center py-2.5 font-semibold active:scale-95 disabled:opacity-50"
              >
                <TrendingUp className="h-4 w-4" /> {submitting === "buy" ? "Buying…" : "Simulate Buy"}
              </button>
              <button
                onClick={() => trade("sell")}
                disabled={!!submitting || !resolved?.priceUsd}
                className="pill pill-danger justify-center py-2.5 font-semibold active:scale-95 disabled:opacity-50"
              >
                <TrendingDown className="h-4 w-4" /> {submitting === "sell" ? "Selling…" : "Simulate Sell"}
              </button>
            </div>
            {toast ? (
              <div className={`text-[11px] mt-1 pill ${toast.kind === "ok" ? "pill-ok" : "pill-danger"}`}>
                {toast.msg}
              </div>
            ) : null}
          </div>

          {/* Positions table */}
          <div className="glass p-5 flex flex-col gap-3 backdrop-blur-md">
            <h2 className="font-semibold">Open positions</h2>
            <div className="max-h-72 overflow-y-auto rounded-xl border border-white/20">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white/40 dark:bg-white/5 backdrop-blur-md">
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="px-3 py-2">Token</th>
                    <th className="px-3 py-2 text-right">Qty</th>
                    <th className="px-3 py-2 text-right">Avg</th>
                    <th className="px-3 py-2 text-right">Live</th>
                    <th className="px-3 py-2 text-right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No open positions yet. Simulate a buy to get started.
                    </td></tr>
                  ) : positions.map((p) => {
                    const pnl = (p.livePrice - p.avgCost) * p.amount;
                    const pct = p.avgCost > 0 ? ((p.livePrice - p.avgCost) / p.avgCost) * 100 : 0;
                    const pos = pnl >= 0;
                    return (
                      <tr key={p.mint} className="border-t border-white/10">
                        <td className="px-3 py-2 font-semibold">{p.symbol}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.amount.toFixed(4)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">${p.avgCost.toFixed(6)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">${p.livePrice.toFixed(6)}</td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold ${pos ? "text-[oklch(0.55_0.18_150)]" : "text-[color:var(--destructive)]"}`}>
                          {pos ? "+" : "−"}${Math.abs(pnl).toFixed(2)}<br />
                          <span className="text-[10px] opacity-80">{pos ? "+" : ""}{pct.toFixed(2)}%</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Trade history */}
        <section className="glass p-5 flex flex-col gap-3 backdrop-blur-md">
          <h2 className="font-semibold">Trade history</h2>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-white/20">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white/40 dark:bg-white/5 backdrop-blur-md">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Side</th>
                  <th className="px-3 py-2">Token</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Price</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {(account?.trades ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">No trades yet.</td></tr>
                ) : [...(account?.trades ?? [])].reverse().map((t) => (
                  <tr key={t.id} className="border-t border-white/10">
                    <td className="px-3 py-2 text-muted-foreground">{new Date(t.timestamp).toLocaleTimeString()}</td>
                    <td className="px-3 py-2">
                      <span className={`pill ${t.action === "buy" ? "pill-ok" : "pill-danger"}`}>{t.action.toUpperCase()}</span>
                    </td>
                    <td className="px-3 py-2 font-semibold">{t.symbol}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{t.amount.toFixed(4)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">${t.priceUsd.toFixed(6)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">${t.totalUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "danger" }) {
  const cls = tone === "ok" ? "text-[oklch(0.55_0.18_150)]"
            : tone === "danger" ? "text-[color:var(--destructive)]"
            : "";
  return (
    <div className="glass-pill !rounded-xl px-3 py-2 flex flex-col gap-0.5 min-w-[110px]">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-bold text-sm tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
