import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Search, TrendingUp, TrendingDown, Wallet, X, RefreshCw, CandlestickChart,
} from "lucide-react";
import {
  applyTrade, emptyState, fetchMarkets, fetchPricesForMints, loadState, saveState,
  searchMarkets, syncTradeToBackend, START_CASH,
  type MarketRow, type PaperState,
} from "@/lib/trade-store";
import { GlassCandleChart } from "@/components/charts/GlassCandleChart";
import { NavDock } from "@/components/nav/NavDock";


export const Route = createFileRoute("/_authenticated/trade")({
  ssr: false,
  component: TradePage,
  head: () => ({
    meta: [
      { title: "Paper Trading Desk — Ghost AI" },
      { name: "description", content: "Simulate Solana trades with a persistent $1,000 paper portfolio and live profit and loss." },
      { property: "og:title", content: "Paper Trading Desk — Ghost AI" },
      { property: "og:description", content: "Persistent paper positions, live PnL and candlestick charts across 100+ markets." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

function usd(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const max = abs > 0 && abs < 0.01 ? 8 : digits;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: max })}`;
}

function TradePage() {
  const [state, setState] = useState<PaperState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<MarketRow | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState("");
  const [searchRows, setSearchRows] = useState<MarketRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState("50");
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState<"buy" | "sell" | null>(null);


  // ── Restore persisted portfolio ────────────────────────────────────────────
  useEffect(() => {
    setState(loadState());
    setHydrated(true);
  }, []);

  const mutate = useCallback((next: PaperState) => {
    setState(saveState(next));
  }, []);

  // ── Live market feed (backend engine, refreshed every 5s) ──────────────────
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      const rows = await fetchMarkets();
      if (cancelled || !rows.length) return;
      setMarkets(rows);
      setPrices((p) => {
        const next = { ...p };
        rows.forEach((r) => { next[r.mint] = r.priceUsd; });
        return next;
      });
      setSelected((s) => s ?? rows[0]);
    }
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // ── Live prices for anything we hold or watch (every 4s) ───────────────────
  const heldMints = useMemo(() => Object.keys(state.positions), [state.positions]);
  useEffect(() => {
    const mints = Array.from(new Set([...heldMints, ...(selected ? [selected.mint] : [])]));
    if (!mints.length) return;
    let cancelled = false;
    async function tick() {
      const map = await fetchPricesForMints(mints);
      if (cancelled || !Object.keys(map).length) return;
      setPrices((p) => ({ ...p, ...map }));
    }
    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [heldMints.join(","), selected?.mint]);

  // ── Search drawer ──────────────────────────────────────────────────────────
  useEffect(() => {
    const q = query.trim();
    if (!q) { setSearchRows(null); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const local = markets.filter(
        (m) => m.symbol.includes(q.toUpperCase()) || m.name.toLowerCase().includes(q.toLowerCase()),
      );
      const remote = await searchMarkets(q);
      const merged = [...local, ...remote.filter((r) => !local.some((l) => l.mint === r.mint))];
      setSearchRows(merged);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [query, markets]);

  // ── Derived portfolio metrics ──────────────────────────────────────────────
  const positions = useMemo(
    () =>
      Object.values(state.positions).map((p) => {
        const live = prices[p.mint] ?? p.avgCost;
        const value = live * p.amount;
        const cost = p.avgCost * p.amount;
        return { ...p, live, value, cost, pnl: value - cost, pnlPct: cost ? ((value - cost) / cost) * 100 : 0 };
      }),
    [state.positions, prices],
  );
  const positionsValue = positions.reduce((s, p) => s + p.value, 0);
  const unrealized = positions.reduce((s, p) => s + p.pnl, 0);
  const equity = state.cash + positionsValue;
  const totalPnl = equity - START_CASH;
  const totalPnlPct = (totalPnl / START_CASH) * 100;

  const livePrice = selected ? (prices[selected.mint] ?? selected.priceUsd) : 0;
  const est = Number(amount) / (livePrice || 1);

  function trade(action: "buy" | "sell") {
    if (!selected || busy) return;
    const usdAmount = Number(amount);
    if (!Number.isFinite(usdAmount) || usdAmount <= 0) {
      setNotice({ ok: false, msg: "Enter a valid USD amount" });
      return;
    }
    const tokens = usdAmount / (livePrice || 1);
    const input = {
      action, mint: selected.mint, symbol: selected.symbol,
      amount: +tokens.toFixed(9), priceUsd: livePrice,
    };
    setBusy(action);
    // Optimistic: portfolio updates instantly, backend mirror is fire-and-forget.
    const res = applyTrade(state, input);
    if (!res.ok) {
      setBusy(null);
      setNotice({ ok: false, msg: res.error ?? "Trade rejected" });
      return;
    }
    mutate(res.state);
    syncTradeToBackend(res.state, input);
    setNotice({ ok: true, msg: `${action === "buy" ? "Bought" : "Sold"} ${input.amount.toFixed(4)} ${selected.symbol}` });
    window.setTimeout(() => setBusy(null), 450);
  }


  function resetDesk() {
    mutate(emptyState(state.userId));
    setNotice({ ok: true, msg: "Paper desk reset to $1,000.00" });
  }

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(t);
  }, [notice]);

  const list = searchRows ?? markets;

  return (
    <div className="min-h-screen w-full bg-[var(--background)] px-3 sm:px-6 py-4 sm:py-6">
      <div className="mx-auto max-w-7xl flex flex-col gap-4">
        {/* Header */}
        <header className="glass rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="btn-ghost !px-2" aria-label="Back to terminal">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="font-bold text-lg truncate">Paper Trading Desk</h1>
              <p className="text-xs text-muted-foreground truncate">
                Persistent positions · live PnL · {markets.length || "…"} live markets
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDrawer(true)} className="btn-glass text-sm">
              <Search className="h-4 w-4" /> Markets
            </button>
            <button onClick={resetDesk} className="btn-ghost text-sm" title="Reset paper desk">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Portfolio stats */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Portfolio equity" value={usd(equity)} sub={`${totalPnl >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}% all-time`} tone={totalPnl >= 0 ? "ok" : "bad"} />
          <StatCard label="Cash" value={usd(state.cash)} sub="Available to deploy" />
          <StatCard label="Positions" value={usd(positionsValue)} sub={`${positions.length} open`} />
          <StatCard
            label="Unrealized PnL"
            value={`${unrealized >= 0 ? "+" : "−"}${usd(Math.abs(unrealized))}`}
            sub={`Realized ${usd(state.realizedPnl)}`}
            tone={unrealized >= 0 ? "ok" : "bad"}
          />
        </section>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-4">
          {/* Chart */}
          <section className="glass rounded-2xl p-4 flex flex-col gap-3 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <CandlestickChart className="h-4 w-4 sky-text shrink-0" />
                <span className="font-semibold truncate">
                  {selected ? `${selected.symbol} · ${selected.name || "Solana market"}` : "Select a market"}
                </span>
              </div>
              {selected ? (
                <div className="flex items-center gap-2">
                  <span className="font-bold tabular-nums">{usd(livePrice, 2)}</span>
                  <span className={`pill ${selected.change24h >= 0 ? "pill-ok" : "pill-danger"}`}>
                    {selected.change24h >= 0 ? "▲" : "▼"} {Math.abs(selected.change24h).toFixed(2)}%
                  </span>
                </div>
              ) : null}
            </div>
            <GlassCandleChart mint={selected?.mint ?? null} symbol={selected?.symbol} />

          </section>

          {/* Ticket */}
          <section className="glass rounded-2xl p-4 flex flex-col gap-3 h-fit">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 sky-text" />
              <span className="font-semibold">Trade ticket</span>
            </div>
            <button onClick={() => setDrawer(true)} className="glass-input w-full text-left text-sm flex items-center justify-between">
              <span className="truncate">{selected ? `${selected.symbol} — ${selected.venue}` : "Choose a market"}</span>
              <Search className="h-4 w-4 opacity-60" />
            </button>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount (USD)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              className="glass-input w-full tabular-nums"
              placeholder="100"
            />
            <div className="flex gap-1.5">
              {[25, 50, 100, 250].map((v) => (
                <button key={v} onClick={() => setAmount(String(v))} className="pill pill-sky flex-1 justify-center">
                  ${v}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              ≈ {Number.isFinite(est) ? est.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—"} {selected?.symbol ?? ""} @ {usd(livePrice, 2)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => trade("buy")} disabled={!selected} className="btn-primary justify-center disabled:opacity-50">
                <TrendingUp className="h-4 w-4" /> Buy
              </button>
              <button onClick={() => trade("sell")} disabled={!selected} className="btn-glass justify-center disabled:opacity-50">
                <TrendingDown className="h-4 w-4" /> Sell
              </button>
            </div>
            {notice ? (
              <div className={`pill ${notice.ok ? "pill-ok" : "pill-danger"} w-full justify-center`}>{notice.msg}</div>
            ) : null}
          </section>
        </div>

        {/* Open positions */}
        <section className="glass rounded-2xl p-4 flex flex-col gap-3 min-w-0">
          <span className="font-semibold">Open positions</span>
          {!hydrated ? (
            <div className="shimmer-glass h-16 rounded-xl" />
          ) : positions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open positions yet. Buy a market to start tracking live PnL.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr className="text-left">
                    <th className="py-2">Market</th><th>Amount</th><th>Avg cost</th>
                    <th>Live</th><th>Value</th><th className="text-right pr-1">Unrealized</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {positions.map((p) => (
                    <tr
                      key={p.mint}
                      className="border-t border-white/25 cursor-pointer hover:bg-white/25 transition"
                      onClick={() =>
                        setSelected(
                          markets.find((m) => m.mint === p.mint) ?? {
                            mint: p.mint, symbol: p.symbol, name: p.symbol,
                            priceUsd: p.live, change24h: 0, volume24h: 0, liquidityUsd: 0, venue: "DEX",
                          },
                        )
                      }
                    >
                      <td className="py-2.5 font-semibold">{p.symbol}</td>
                      <td>{p.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td>{usd(p.avgCost, 2)}</td>
                      <td>{usd(p.live, 2)}</td>
                      <td>{usd(p.value)}</td>
                      <td className={`text-right pr-1 font-semibold ${p.pnl >= 0 ? "text-[oklch(0.55_0.18_150)]" : "text-[color:var(--destructive)]"}`}>
                        {p.pnl >= 0 ? "+" : "−"}{usd(Math.abs(p.pnl))} ({p.pnlPct.toFixed(2)}%)
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* History */}
        <section className="glass rounded-2xl p-4 flex flex-col gap-2 min-w-0">
          <span className="font-semibold">Trade history</span>
          {state.trades.length === 0 ? (
            <p className="text-sm text-muted-foreground">Executed paper trades appear here and persist across refreshes.</p>
          ) : (
            <ul className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
              {state.trades.map((t) => (
                <li key={t.id} className="glass-pill !rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`pill ${t.action === "buy" ? "pill-ok" : "pill-danger"}`}>{t.action.toUpperCase()}</span>
                    <span className="font-semibold truncate">{t.symbol}</span>
                  </span>
                  <span className="tabular-nums text-xs text-muted-foreground truncate">
                    {t.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ {usd(t.priceUsd, 2)} · {usd(t.totalUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Market search drawer */}
      {drawer ? (
        <div className="fixed inset-0 z-50 flex">
          <button className="flex-1 bg-black/20 backdrop-blur-md" aria-label="Close markets" onClick={() => setDrawer(false)} />
          <aside className="w-full max-w-md h-full glass-strong rounded-l-3xl p-4 flex flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Market search</span>
              <button onClick={() => setDrawer(false)} className="btn-ghost !px-2"><X className="h-4 w-4" /></button>
            </div>
            <input
              autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search 100+ CEX & DEX markets…" className="glass-input w-full"
            />
            {searching ? <div className="shimmer-glass h-10 rounded-xl" /> : null}
            <ul className="flex-1 overflow-y-auto flex flex-col gap-1.5">
              {list.length === 0 && !searching ? (
                <li className="text-sm text-muted-foreground px-1 py-3">Streaming market list…</li>
              ) : null}
              {list.map((m) => (
                <li key={`${m.venue}-${m.mint}`}>
                  <button
                    onClick={() => { setSelected(m); setDrawer(false); }}
                    className="side-item w-full text-left flex items-center justify-between gap-3"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {m.image ? <img src={m.image} alt="" className="h-6 w-6 rounded-full" /> : null}
                      <span className="min-w-0">
                        <span className="block font-semibold text-sm truncate">{m.symbol}</span>
                        <span className="block text-[10px] text-muted-foreground truncate">{m.venue}</span>
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className="block text-sm tabular-nums">{usd(m.priceUsd, 2)}</span>
                      <span className={`block text-[10px] ${m.change24h >= 0 ? "text-[oklch(0.55_0.18_150)]" : "text-[color:var(--destructive)]"}`}>
                        {m.change24h >= 0 ? "▲" : "▼"} {Math.abs(m.change24h).toFixed(2)}%
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "bad" }) {
  return (
    <div className="glass rounded-2xl p-4 flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-xl font-bold tabular-nums ${
        tone === "ok" ? "text-[oklch(0.55_0.18_150)]" : tone === "bad" ? "text-[color:var(--destructive)]" : ""
      }`}>{value}</span>
      {sub ? <span className="text-[11px] text-muted-foreground truncate">{sub}</span> : null}
    </div>
  );
}
