import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft, Search, TrendingUp, TrendingDown, Wallet, X, RefreshCw,
  ChevronDown, LineChart as LineIcon, CandlestickChart, Sigma, Gauge, MessageCircle,
} from "lucide-react";
import {
  applyTrade, emptyState, fetchMarkets, fetchPricesForMints, loadState, saveState,
  searchMarkets, syncTradeToBackend, START_CASH,
  type MarketRow, type PaperState,
} from "@/lib/trade-store";
import type { CandleTF } from "@/lib/market-data";
import { GlassCandleChart, type ChartStyle } from "@/components/charts/GlassCandleChart";
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

const TFS: { id: CandleTF; label: string }[] = [
  { id: "15m", label: "15M" },
  { id: "1h", label: "1H" },
  { id: "4h", label: "4H" },
  { id: "1d", label: "1D" },
];

type TopTab = "trade" | "balance";
type DataTab = "chart" | "info" | "feed";
type BottomTab = "positions" | "open" | "orders" | "history";

function TradePage() {
  const [state, setState] = useState<PaperState>(() => emptyState());
  const [hydrated, setHydrated] = useState(false);
  const [markets, setMarkets] = useState<MarketRow[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<MarketRow | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [ticket, setTicket] = useState(false);
  const [query, setQuery] = useState("");
  const [searchRows, setSearchRows] = useState<MarketRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [amount, setAmount] = useState("50");
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState<"buy" | "sell" | null>(null);

  // Exchange shell state
  const [topTab, setTopTab] = useState<TopTab>("trade");
  const [dataTab, setDataTab] = useState<DataTab>("chart");
  const [bottomTab, setBottomTab] = useState<BottomTab>("positions");
  const [tf, setTf] = useState<CandleTF>("1h");
  const [chartStyle, setChartStyle] = useState<ChartStyle>("candles");
  const [indicators, setIndicators] = useState(false);
  const [sentiment, setSentiment] = useState(false);
  const [mentions, setMentions] = useState(false);

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
  const pair = selected ? `${selected.symbol}/USDC` : "Select market";

  return (
    <div className="min-h-screen w-full bg-[var(--background)] px-3 sm:px-6 py-4 sm:py-6 pb-40">
      <div className="mx-auto max-w-7xl flex flex-col gap-3">
        {/* ── 1. Exchange header bar ─────────────────────────────────────── */}
        <header className="glass rounded-2xl px-3 sm:px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="btn-ghost !px-2" aria-label="Back to terminal">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <button
              onClick={() => setDrawer(true)}
              className="flex items-center gap-2.5 min-w-0 rounded-2xl px-2 py-1 hover:bg-white/30 transition"
              aria-label="Change market"
            >
              {selected?.image ? (
                <img src={selected.image} alt="" className="h-9 w-9 rounded-full ring-1 ring-white/50" />
              ) : (
                <span className="h-9 w-9 rounded-full grid place-items-center bg-white/40 ring-1 ring-white/50 text-xs font-bold">
                  {selected?.symbol?.slice(0, 2) ?? "—"}
                </span>
              )}
              <span className="min-w-0 text-left">
                <span className="flex items-center gap-1 font-bold truncate">
                  {pair} <ChevronDown className="h-4 w-4 opacity-60" />
                </span>
                <span className="block text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                  {selected?.venue ?? "Solana"} · {markets.length || "…"} markets
                </span>
              </span>
            </button>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-bold tabular-nums">{usd(livePrice, 2)}</span>
              {selected ? (
                <span className={`pill ${selected.change24h >= 0 ? "pill-ok" : "pill-danger"}`}>
                  {selected.change24h >= 0 ? "▲" : "▼"} {Math.abs(selected.change24h).toFixed(2)}%
                </span>
              ) : null}
            </div>
            <div className="glass-pill !rounded-full p-1 flex items-center gap-1">
              {(["trade", "balance"] as TopTab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTopTab(t)}
                  className={`px-4 py-1.5 rounded-full text-sm font-semibold capitalize transition ${
                    topTab === t ? "bg-[color:var(--sky)]/20 text-[color:var(--sky)]" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <button onClick={resetDesk} aria-label="Reset paper desk" className="btn-ghost !px-2" title="Reset paper desk">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        {topTab === "trade" ? (
          <>
            {/* ── 2. Chart & data tabs ───────────────────────────────────── */}
            <section className="glass rounded-2xl p-3 sm:p-4 flex flex-col gap-3 min-w-0">
              <div className="flex items-center gap-1 border-b border-white/30 pb-2 overflow-x-auto">
                {([["chart", "Chart"], ["info", "Market Info"], ["feed", "Feed"]] as [DataTab, string][]).map(
                  ([id, label]) => (
                    <button
                      key={id}
                      onClick={() => setDataTab(id)}
                      className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                        dataTab === id
                          ? "text-[color:var(--sky)] bg-[color:var(--sky)]/12"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {label}
                    </button>
                  ),
                )}
              </div>

              {dataTab === "chart" ? (
                <>
                  {/* Chart toolbar */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="glass-pill !rounded-full p-0.5 flex items-center gap-0.5">
                      {TFS.map(({ id, label }) => (
                        <button
                          key={id}
                          onClick={() => setTf(id)}
                          className={`px-2.5 py-1 rounded-full text-xs font-semibold transition ${
                            tf === id ? "bg-[color:var(--sky)]/20 text-[color:var(--sky)]" : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="glass-pill !rounded-full p-0.5 flex items-center gap-0.5">
                      <button
                        onClick={() => setChartStyle("candles")}
                        aria-label="Candlestick chart"
                        className={`h-7 w-7 grid place-items-center rounded-full transition ${
                          chartStyle === "candles" ? "bg-[color:var(--sky)]/20 text-[color:var(--sky)]" : "text-muted-foreground"
                        }`}
                      >
                        <CandlestickChart className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setChartStyle("line")}
                        aria-label="Line chart"
                        className={`h-7 w-7 grid place-items-center rounded-full transition ${
                          chartStyle === "line" ? "bg-[color:var(--sky)]/20 text-[color:var(--sky)]" : "text-muted-foreground"
                        }`}
                      >
                        <LineIcon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <ToolChip active={indicators} onClick={() => setIndicators((v) => !v)} Icon={Sigma} label="fx" />
                    <ToolChip active={sentiment} onClick={() => setSentiment((v) => !v)} Icon={Gauge} label="Sentiment" />
                    <ToolChip active={mentions} onClick={() => setMentions((v) => !v)} Icon={MessageCircle} label="Mentions" />
                  </div>

                  <GlassCandleChart
                    mint={selected?.mint ?? null}
                    symbol={selected?.symbol}
                    tf={tf}
                    onTfChange={setTf}
                    style={chartStyle}
                    hideToolbar
                    height={420}
                  />

                  {indicators || sentiment || mentions ? (
                    <div className="grid sm:grid-cols-3 gap-2">
                      {indicators ? <Insight label="Indicators" value="MA · RSI · VOL" sub="Overlay set active" /> : null}
                      {sentiment ? (
                        <Insight
                          label="Sentiment"
                          value={selected && selected.change24h >= 0 ? "Bullish" : "Bearish"}
                          sub="Derived from 24h momentum"
                        />
                      ) : null}
                      {mentions ? (
                        <Insight
                          label="Mentions"
                          value={selected ? `${Math.max(1, Math.round((selected.volume24h || 0) / 25_000))}` : "—"}
                          sub="Social volume proxy (24h)"
                        />
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : dataTab === "info" ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <StatCard label="Last price" value={usd(livePrice, 2)} />
                  <StatCard
                    label="24h change"
                    value={`${(selected?.change24h ?? 0) >= 0 ? "+" : ""}${(selected?.change24h ?? 0).toFixed(2)}%`}
                    tone={(selected?.change24h ?? 0) >= 0 ? "ok" : "bad"}
                  />
                  <StatCard label="24h volume" value={usd(selected?.volume24h ?? 0, 0)} />
                  <StatCard label="Liquidity" value={usd(selected?.liquidityUsd ?? 0, 0)} />
                  <div className="glass rounded-2xl p-4 col-span-2 lg:col-span-4 flex flex-col gap-1 min-w-0">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mint address</span>
                    <span className="text-xs break-all">{selected?.mint ?? "—"}</span>
                    <span className="text-[11px] text-muted-foreground">Venue · {selected?.venue ?? "—"}</span>
                  </div>
                </div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {markets.slice(0, 12).map((m) => (
                    <li key={m.mint} className="glass-pill !rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold truncate">{m.symbol}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {m.change24h >= 0 ? "rallying" : "cooling"} · {usd(m.priceUsd, 2)} · vol {usd(m.volume24h, 0)}
                      </span>
                      <span className={`pill ${m.change24h >= 0 ? "pill-ok" : "pill-danger"} shrink-0`}>
                        {m.change24h >= 0 ? "▲" : "▼"} {Math.abs(m.change24h).toFixed(2)}%
                      </span>
                    </li>
                  ))}
                  {markets.length === 0 ? (
                    <li className="text-sm text-muted-foreground">Streaming market feed…</li>
                  ) : null}
                </ul>
              )}
            </section>

            {/* ── 3. Bottom management tabs ──────────────────────────────── */}
            <section className="glass rounded-2xl p-3 sm:p-4 flex flex-col gap-3 min-w-0">
              <div className="flex items-center gap-1 border-b border-white/30 pb-2 overflow-x-auto">
                {(
                  [
                    ["positions", "Positions"],
                    ["open", "Open Orders"],
                    ["orders", "Order History"],
                    ["history", "Trade History"],
                  ] as [BottomTab, string][]
                ).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setBottomTab(id)}
                    className={`px-3 py-1.5 text-sm font-semibold rounded-lg transition whitespace-nowrap ${
                      bottomTab === id
                        ? "text-[color:var(--sky)] bg-[color:var(--sky)]/12"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {bottomTab === "positions" ? (
                !hydrated ? (
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
                )
              ) : bottomTab === "open" ? (
                <p className="text-sm text-muted-foreground">
                  No open orders. Paper trades execute instantly at the live market price.
                </p>
              ) : (
                <>
                  {state.trades.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {bottomTab === "orders"
                        ? "Filled orders appear here once you trade."
                        : "Executed paper trades appear here and persist across refreshes."}
                    </p>
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
                </>
              )}
            </section>
          </>
        ) : (
          /* ── Balance tab ─────────────────────────────────────────────── */
          <section className="flex flex-col gap-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard label="Portfolio equity" value={usd(equity)} sub={`${totalPnl >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}% all-time`} tone={totalPnl >= 0 ? "ok" : "bad"} />
              <StatCard label="Cash" value={usd(state.cash)} sub="Available to deploy" />
              <StatCard label="Positions" value={usd(positionsValue)} sub={`${positions.length} open`} />
              <StatCard
                label="Unrealized PnL"
                value={`${unrealized >= 0 ? "+" : "−"}${usd(Math.abs(unrealized))}`}
                sub={`Realized ${usd(state.realizedPnl)}`}
                tone={unrealized >= 0 ? "ok" : "bad"}
              />
            </div>
            <div className="glass rounded-2xl p-4 flex flex-col gap-2">
              <h2 className="font-semibold">Holdings</h2>
              {positions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Your paper balance is fully in cash.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {positions.map((p) => (
                    <li key={p.mint} className="glass-pill !rounded-xl px-3 py-2 flex items-center justify-between gap-3 text-sm">
                      <span className="font-semibold">{p.symbol}</span>
                      <span className="tabular-nums text-xs text-muted-foreground">
                        {p.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} · {usd(p.value)}
                      </span>
                      <span className={`pill ${p.pnl >= 0 ? "pill-ok" : "pill-danger"}`}>{p.pnlPct.toFixed(2)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}
      </div>

      {/* ── Pinned CTA above the nav dock ─────────────────────────────────── */}
      <div className="fixed bottom-20 left-0 right-0 z-30 px-3 sm:px-6 pointer-events-none">
        <div className="mx-auto max-w-7xl pointer-events-auto">
          <button
            onClick={() => setTicket(true)}
            className="btn-primary w-full justify-center py-3 text-base font-semibold shadow-lg"
          >
            <Wallet className="h-4 w-4" />
            {selected ? `Buy / Sell ${selected.symbol}` : "Start Trading"}
          </button>
        </div>
      </div>

      {notice ? (
        <div className="fixed bottom-36 left-1/2 -translate-x-1/2 z-50">
          <div className={`pill ${notice.ok ? "pill-ok" : "pill-danger"} px-4 py-2`}>{notice.msg}</div>
        </div>
      ) : null}

      {/* ── Trade ticket sheet ────────────────────────────────────────────── */}
      {ticket ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
          <button className="absolute inset-0 bg-black/20 backdrop-blur-md" aria-label="Close ticket" onClick={() => setTicket(false)} />
          <section className="relative w-full sm:max-w-md glass-strong rounded-t-3xl sm:rounded-3xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Trade ticket</span>
              <button onClick={() => setTicket(false)} className="btn-ghost !px-2"><X className="h-4 w-4" /></button>
            </div>
            <button onClick={() => { setTicket(false); setDrawer(true); }} className="glass-input w-full text-left text-sm flex items-center justify-between">
              <span className="truncate">{selected ? `${selected.symbol} — ${selected.venue}` : "Choose a market"}</span>
              <Search className="h-4 w-4 opacity-60" />
            </button>
            <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Amount (USD)</label>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              aria-label="Trade amount in USD"
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
              <button onClick={() => trade("buy")} disabled={!selected || !!busy} className="btn-primary justify-center disabled:opacity-50">
                {busy === "buy" ? <span className="spinner" /> : <TrendingUp className="h-4 w-4" />} Buy
              </button>
              <button onClick={() => trade("sell")} disabled={!selected || !!busy} className="btn-glass justify-center disabled:opacity-50">
                {busy === "sell" ? <span className="spinner" /> : <TrendingDown className="h-4 w-4" />} Sell
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {/* ── Market search drawer ──────────────────────────────────────────── */}
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
              placeholder="Search 100+ CEX & DEX markets…" aria-label="Search markets" className="glass-input w-full"
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

      <NavDock />
    </div>
  );
}

function ToolChip({
  active, onClick, Icon, label,
}: { active: boolean; onClick: () => void; Icon: any; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`pill ${active ? "pill-sky" : ""} px-3 py-1 gap-1.5 active:scale-95 transition`}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function Insight({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass-pill !rounded-xl px-3 py-2 flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-semibold">{value}</span>
      <span className="text-[11px] text-muted-foreground truncate">{sub}</span>
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
