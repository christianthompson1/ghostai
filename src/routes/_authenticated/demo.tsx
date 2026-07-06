import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, TrendingUp, TrendingDown, Wallet, Sparkles, Flame, Rocket, RefreshCw, Zap } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  initDemoAccount, submitDemoTrade,
  type DemoAccount,
} from "@/lib/ghost-backend";
import {
  fetchLivePrices, fetchTokenSnapshot, fetchPumpTrending,
  fetchCandles, fetchDemoAccount,
  type LiveTokenRow, type PumpTrendingRow, type Candle, type CandleTF, type DemoAccountSnapshot,
} from "@/lib/market-data";

export const Route = createFileRoute("/_authenticated/demo")({
  component: DemoTradingPage,
  head: () => ({
    meta: [
      { title: "Demo Paper Trading — Ghost AI" },
      { name: "description", content: "Trade a live directory of Solana tokens with a $1,000 mock portfolio." },
    ],
  }),
});

const STORAGE_KEY = "ghost.demo.userId";

type Position = { mint: string; symbol: string; amount: number; avgCost: number; livePrice: number };

function DemoTradingPage() {
  // ── Account state ──────────────────────────────────────────────────────────
  const [account, setAccount] = useState<DemoAccount | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Live market data ───────────────────────────────────────────────────────
  const [market, setMarket] = useState<LiveTokenRow[]>([]);
  const [pump, setPump] = useState<PumpTrendingRow[]>([]);

  // ── Selection / chart ──────────────────────────────────────────────────────
  const [selected, setSelected] = useState<LiveTokenRow | null>(null);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [candleLoading, setCandleLoading] = useState(false);
  const [timeframe, setTimeframe] = useState<CandleTF>("1h");
  const chartRef = useRef<HTMLDivElement | null>(null);

  // ── Backend account snapshot (live PnL) ────────────────────────────────────
  const [snapshot, setSnapshot] = useState<DemoAccountSnapshot | null>(null);

  // ── Trade form ─────────────────────────────────────────────────────────────
  const [amount, setAmount] = useState("100");
  const [submitting, setSubmitting] = useState<"buy" | "sell" | null>(null);
  const [toast, setToast] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);

  // Live prices lookup by mint (drives PnL + chart real-time ticks)
  const livePriceByMint = useMemo(() => {
    const m = new Map<string, number>();
    market.forEach((r) => m.set(r.mint, r.priceUsd));
    return m;
  }, [market]);

  // ── Boot account (idempotent) ──────────────────────────────────────────────
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

  // ── Poll DexScreener top-50 every 4s ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const rows = await fetchLivePrices();
      if (!cancelled && rows.length) {
        setMarket(rows);
        // Auto-select the most-active token on first load
        setSelected((prev) => prev ?? rows[0]);
      }
    }
    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── Poll Replit pump-fun endpoint every 2s (preserve rows on transient empty) ─
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const rows = await fetchPumpTrending();
      if (cancelled) return;
      // Only overwrite when the backend actually returns data — this stops
      // the panel from flashing back to skeletons between polls.
      if (rows.length) setPump(rows);
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── Historical candles from Replit backend on token / timeframe change ─────
  useEffect(() => {
    if (!selected) { setCandles([]); return; }
    let cancelled = false;
    setCandleLoading(true);
    (async () => {
      const rows = await fetchCandles(selected.mint, timeframe);
      if (cancelled) return;
      setCandles(rows);
      setCandleLoading(false);
      // fold latest close back into the market directory so it ticks live
      const last = rows[rows.length - 1]?.c;
      if (last) {
        setMarket((m) => m.map((r) => (r.mint === selected.mint ? { ...r, priceUsd: last } : r)));
      }
    })();
    return () => { cancelled = true; };
  }, [selected?.mint, timeframe]);

  // ── Live account snapshot every 2s (server-computed PnL / equity) ──────────
  useEffect(() => {
    if (!account?.userId) return;
    let cancelled = false;
    async function tick() {
      const snap = await fetchDemoAccount(account!.userId);
      if (!cancelled && snap) setSnapshot(snap);
    }
    tick();
    const id = setInterval(tick, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [account?.userId]);

  // Smooth-scroll to the chart panel — used when a directory / pump row is tapped.
  function scrollToChart() {
    requestAnimationFrame(() => {
      chartRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
  function pickToken(row: LiveTokenRow) {
    setSelected(row);
    scrollToChart();
  }

  // ── Positions & derived stats ──────────────────────────────────────────────
  const positions: Position[] = useMemo(() => {
    if (!account) return [];
    return Object.entries(account.portfolio).map(([mint, qty]) => {
      const buys = account.trades.filter((t) => t.mint === mint && t.action === "buy");
      const totalCost = buys.reduce((s, b) => s + b.totalUsd, 0);
      const totalQty  = buys.reduce((s, b) => s + b.amount, 0);
      const avgCost   = totalQty > 0 ? totalCost / totalQty : 0;
      const symbol    = account.trades.find((t) => t.mint === mint)?.symbol ?? mint.slice(0, 4);
      const livePrice = livePriceByMint.get(mint) ?? avgCost;
      return { mint, symbol, amount: qty, avgCost, livePrice };
    });
  }, [account, livePriceByMint]);

  // Prefer server-computed values when the snapshot is fresh; fall back to local.
  const portfolioValue  = snapshot?.positionsUsd  ?? positions.reduce((s, p) => s + p.amount * p.livePrice, 0);
  const cashBalance     = snapshot?.cash          ?? snapshot?.balanceUsd ?? account?.balanceUsd ?? 0;
  const totalEquity     = snapshot?.totalEquity   ?? (cashBalance + portfolioValue);
  const totalUnrealized = snapshot?.unrealizedPnl ?? positions.reduce((s, p) => s + (p.livePrice - p.avgCost) * p.amount, 0);
  const totalPct        = snapshot?.pnlPercent    ?? (totalEquity > 0 ? ((totalEquity - 1000) / 1000) * 100 : 0);

  // ── Actions ────────────────────────────────────────────────────────────────
  async function trade(action: "buy" | "sell") {
    if (!account) return;
    if (!selected?.priceUsd) {
      setToast({ kind: "err", msg: "Pick a token from the market or pump board first." });
      return;
    }
    const usd = Number(amount);
    if (!Number.isFinite(usd) || usd <= 0) {
      setToast({ kind: "err", msg: "Enter a positive USD amount." });
      return;
    }
    setSubmitting(action);
    const tokenAmount = usd / selected.priceUsd;
    const res = await submitDemoTrade(account, {
      action,
      mint: selected.mint,
      symbol: selected.symbol,
      amount: tokenAmount,
      priceUsd: selected.priceUsd,
    });
    setSubmitting(null);
    if (!res.ok) {
      setToast({ kind: "err", msg: res.error ?? "Trade failed" });
      return;
    }
    setAccount(res.account);
    setToast({
      kind: "ok",
      msg: `${action === "buy" ? "Bought" : "Sold"} ${tokenAmount.toFixed(4)} ${selected.symbol}${res.source === "local" ? " · offline" : ""}`,
    });
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Handler for Pump.fun rows — resolve to a market snapshot then select
  async function pickPump(row: PumpTrendingRow) {
    const snap = await fetchTokenSnapshot(row.mint);
    setSelected(snap ?? {
      mint: row.mint, symbol: row.symbol, name: row.name,
      priceUsd: row.marketCapUsd > 0 ? row.marketCapUsd / 1_000_000_000 : 0,
      change24h: 0, liquidityUsd: 0, volume24h: 0, image: row.imageUri ?? undefined,
    });
    scrollToChart();
  }

  return (
    <div className="min-h-screen w-full p-3 sm:p-6 bg-[var(--background)]">
      <div className="max-w-7xl mx-auto flex flex-col gap-4">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="btn-ghost active:scale-95" aria-label="Back to chat">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
                Demo <span className="sky-text">Paper Trading</span>
              </h1>
              <p className="text-xs text-muted-foreground">Live Solana directory · Pump.fun graduation board · simulated trades.</p>
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
              <Stat label="Cash" value={`$${cashBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
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

        {/* Market + Chart + Pump board */}
        <section className="grid lg:grid-cols-[1fr_1.4fr_1fr] gap-4">
          <MarketDirectory rows={market} selected={selected?.mint ?? null} onPick={pickToken} />
          <div ref={chartRef}>
            <ChartPanel
              selected={selected}
              candles={candles}
              loading={candleLoading}
              timeframe={timeframe}
              onTimeframe={setTimeframe}
            />
          </div>
          <PumpBoard rows={pump} selected={selected?.mint ?? null} onPick={pickPump} />
        </section>

        {/* Trade block */}
        <section className="glass p-5 flex flex-col gap-3 backdrop-blur-md">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-semibold">Simulate trade</h2>
            {selected ? (
              <span className="pill pill-sky tabular-nums">
                {selected.symbol} · ${selected.priceUsd.toFixed(selected.priceUsd < 1 ? 8 : 4)}
              </span>
            ) : <span className="text-[11px] text-muted-foreground">Select a token above</span>}
          </div>
          <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-center">
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="USD amount"
              className="glass-pill px-3 py-2.5 text-sm bg-white/40 dark:bg-white/5 outline-none tabular-nums"
            />
            <button
              onClick={() => trade("buy")}
              disabled={!!submitting || !selected?.priceUsd}
              className="pill pill-ok justify-center py-2.5 font-semibold active:scale-95 disabled:opacity-50"
            >
              <TrendingUp className="h-4 w-4" /> {submitting === "buy" ? "Buying…" : "Simulate Buy"}
            </button>
            <button
              onClick={() => trade("sell")}
              disabled={!!submitting || !selected?.priceUsd}
              className="pill pill-danger justify-center py-2.5 font-semibold active:scale-95 disabled:opacity-50"
            >
              <TrendingDown className="h-4 w-4" /> {submitting === "sell" ? "Selling…" : "Simulate Sell"}
            </button>
          </div>
          {selected?.priceUsd ? (
            <div className="text-[11px] text-muted-foreground">
              ≈ <span className="font-mono">{(Number(amount) / selected.priceUsd).toFixed(4)}</span> {selected.symbol}
            </div>
          ) : null}
          {toast ? (
            <div className={`text-[11px] mt-1 pill w-fit ${toast.kind === "ok" ? "pill-ok" : "pill-danger"}`}>
              {toast.msg}
            </div>
          ) : null}
        </section>

        {/* Positions table */}
        <section className="glass p-5 flex flex-col gap-3 backdrop-blur-md">
          <h2 className="font-semibold">Open positions</h2>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-white/20">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white/40 dark:bg-white/5 backdrop-blur-md">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2">Token</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Avg</th>
                  <th className="px-3 py-2 text-right">Live</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right">PnL</th>
                </tr>
              </thead>
              <tbody>
                {positions.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No open positions yet. Simulate a buy to get started.
                  </td></tr>
                ) : positions.map((p) => {
                  const pnl = (p.livePrice - p.avgCost) * p.amount;
                  const pct = p.avgCost > 0 ? ((p.livePrice - p.avgCost) / p.avgCost) * 100 : 0;
                  const pos = pnl >= 0;
                  return (
                    <tr key={p.mint} className="border-t border-white/10 hover:bg-white/5 cursor-pointer"
                        onClick={() => {
                          const row = market.find((r) => r.mint === p.mint);
                          if (row) setSelected(row);
                        }}>
                      <td className="px-3 py-2 font-semibold">{p.symbol}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.amount.toFixed(4)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${p.avgCost.toFixed(6)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${p.livePrice.toFixed(6)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">${(p.livePrice * p.amount).toFixed(2)}</td>
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

// ── Sub-components ────────────────────────────────────────────────────────────

function MarketDirectory({
  rows, selected, onPick,
}: { rows: LiveTokenRow[]; selected: string | null; onPick: (r: LiveTokenRow) => void }) {
  return (
    <aside className="glass p-3 flex flex-col gap-2 backdrop-blur-md min-h-[380px]">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 sky-text" />
          <span className="font-semibold text-sm">Live market · Top {rows.length || 50}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">4s refresh</span>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1 -mr-1 max-h-[520px]">
        {rows.length === 0 ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-pill !rounded-xl h-12 shimmer-glass opacity-50" />
          ))
        ) : rows.map((r) => {
          const up = r.change24h >= 0;
          const active = selected === r.mint;
          return (
            <button
              key={r.mint}
              onClick={() => onPick(r)}
              className={`glass-pill !rounded-xl px-2.5 py-2 flex items-center gap-2 text-left transition ${active ? "ring-2 ring-[color:var(--sky)]" : "hover:bg-white/40 dark:hover:bg-white/10"}`}
            >
              {r.image ? (
                <img src={r.image} alt="" className="h-7 w-7 rounded-full shrink-0 ring-1 ring-white/40" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs truncate">{r.symbol}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{r.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  ${r.priceUsd.toLocaleString(undefined, { maximumFractionDigits: r.priceUsd < 1 ? 8 : 4 })}
                </div>
              </div>
              <span className={`text-[10px] font-bold tabular-nums shrink-0 ${up ? "text-[oklch(0.55_0.18_150)]" : "text-[color:var(--destructive)]"}`}>
                {up ? "▲" : "▼"}{Math.abs(r.change24h).toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function PumpBoard({
  rows, selected, onPick,
}: { rows: PumpTrendingRow[]; selected: string | null; onPick: (r: PumpTrendingRow) => void }) {
  return (
    <aside className="glass p-3 flex flex-col gap-2 backdrop-blur-md min-h-[380px]">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 sky-text" />
          <span className="font-semibold text-sm">Pump.fun · Graduating</span>
        </div>
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <RefreshCw className="h-3 w-3 animate-spin" /> live 1s
        </span>
      </div>
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1 -mr-1 max-h-[520px]">
        {rows.length === 0 ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="glass-pill !rounded-xl h-14 shimmer-glass opacity-50" />
          ))
        ) : rows.map((r) => {
          const active = selected === r.mint;
          return (
            <button
              key={r.mint}
              onClick={() => onPick(r)}
              className={`glass-pill !rounded-xl px-2.5 py-2 flex flex-col gap-1.5 text-left transition animate-fade-in ${active ? "ring-2 ring-[color:var(--sky)]" : "hover:bg-white/40 dark:hover:bg-white/10"}`}
            >
              <div className="flex items-center gap-2">
                {r.imageUri ? (
                  <img src={r.imageUri} alt="" className="h-7 w-7 rounded-full shrink-0 ring-1 ring-white/40" />
                ) : (
                  <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold text-xs truncate">{r.symbol}</span>
                    <span className="text-[10px] text-muted-foreground truncate">{r.name}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground tabular-nums">
                    ${r.marketCapUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })} MC
                  </div>
                </div>
                <span className="text-[10px] font-bold tabular-nums shrink-0 sky-text">
                  {r.progress.toFixed(1)}%
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/30 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, r.progress)}%`,
                    background: r.progress > 80
                      ? "linear-gradient(90deg, oklch(0.7 0.2 30), oklch(0.65 0.22 10))"
                      : "linear-gradient(90deg, oklch(0.72 0.2 232), oklch(0.7 0.18 280))",
                  }}
                />
              </div>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function ChartPanel({
  selected, series,
}: { selected: LiveTokenRow | null; series: Array<{ t: number; price: number }> }) {
  const lastRef = useRef<number | null>(null);
  const last = series[series.length - 1]?.price ?? selected?.priceUsd ?? 0;
  const prev = lastRef.current;
  const flash = prev !== null && prev !== last ? (last > prev ? "up" : "down") : null;
  useEffect(() => { lastRef.current = last; }, [last]);

  const first = series[0]?.price ?? last;
  const tickPct = first > 0 ? ((last - first) / first) * 100 : 0;
  const stroke = tickPct >= 0 ? "oklch(0.72 0.2 232)" : "oklch(0.65 0.22 15)";

  return (
    <div className="glass p-4 flex flex-col gap-3 backdrop-blur-md min-h-[380px]">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {selected?.image ? (
            <img src={selected.image} alt="" className="h-8 w-8 rounded-full ring-1 ring-white/40" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-muted" />
          )}
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{selected?.symbol ?? "—"} <span className="text-muted-foreground text-xs font-normal">{selected?.name ?? ""}</span></div>
            <div className={`text-xs tabular-nums transition-colors ${flash === "up" ? "text-[oklch(0.55_0.18_150)]" : flash === "down" ? "text-[color:var(--destructive)]" : ""}`}>
              ${last.toLocaleString(undefined, { maximumFractionDigits: last < 1 ? 10 : 4 })}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`pill text-[10px] tabular-nums ${tickPct >= 0 ? "pill-ok" : "pill-danger"}`}>
            {tickPct >= 0 ? "+" : ""}{tickPct.toFixed(3)}% session
          </span>
          {selected ? (
            <span className={`pill text-[10px] tabular-nums ${selected.change24h >= 0 ? "pill-ok" : "pill-danger"}`}>
              {selected.change24h >= 0 ? "+" : ""}{selected.change24h.toFixed(2)}% 24h
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-[260px] rounded-xl overflow-hidden relative">
        {series.length < 2 ? (
          <div className="absolute inset-0 grid place-items-center text-xs shimmer-glass">Streaming pool metrics…</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.7 0 0 / 0.15)" vertical={false} />
              <XAxis dataKey="t" tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                     stroke="oklch(0.6 0 0)" fontSize={10} minTickGap={40} />
              <YAxis domain={["auto", "auto"]} stroke="oklch(0.6 0 0)" fontSize={10} width={80}
                     tickFormatter={(v) => `$${Number(v).toFixed(v < 1 ? 8 : 4)}`} />
              <Tooltip
                contentStyle={{ background: "var(--background)", border: "1px solid oklch(0.7 0 0 / 0.2)", borderRadius: 12, fontSize: 11 }}
                labelFormatter={(v) => new Date(v as number).toLocaleTimeString()}
                formatter={(v: any) => [`$${Number(v).toFixed(Number(v) < 1 ? 10 : 4)}`, "Price"]}
              />
              <Area type="monotone" dataKey="price" stroke={stroke} strokeWidth={2} fill="url(#chartFill)" isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
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
