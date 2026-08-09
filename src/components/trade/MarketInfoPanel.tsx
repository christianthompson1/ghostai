import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import type { MarketRow } from "@/lib/trade-store";

function usd(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const max = abs > 0 && abs < 0.01 ? 8 : digits;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: max })}`;
}

function compact(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `$${Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 }).format(n)}`;
}

type Tick = { t: number; p: number };

/**
 * Live market info: streaming last price, session hi/lo, and a depth summary
 * derived from the pool's real liquidity and 24h turnover.
 */
export function MarketInfoPanel({
  market,
  livePrice,
}: {
  market: MarketRow | null;
  livePrice: number;
}) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const lastRef = useRef<number>(0);

  // Reset the tape whenever the market changes.
  useEffect(() => {
    setTicks([]);
    lastRef.current = 0;
  }, [market?.mint]);

  useEffect(() => {
    if (!livePrice || livePrice === lastRef.current) return;
    lastRef.current = livePrice;
    setTicks((prev) => [...prev, { t: Date.now(), p: livePrice }].slice(-60));
  }, [livePrice]);

  const dir = useMemo(() => {
    if (ticks.length < 2) return 0;
    return Math.sign(ticks[ticks.length - 1].p - ticks[ticks.length - 2].p);
  }, [ticks]);

  const sessionHi = ticks.length ? Math.max(...ticks.map((t) => t.p)) : livePrice;
  const sessionLo = ticks.length ? Math.min(...ticks.map((t) => t.p)) : livePrice;

  // ── Depth summary derived from real pool liquidity ─────────────────────────
  const liq = market?.liquidityUsd ?? 0;
  const vol = market?.volume24h ?? 0;
  const turnover = liq > 0 ? vol / liq : 0;
  // Constant-product pools hold ~half the liquidity per side.
  const sideDepth = liq / 2;
  const bands = [0.5, 1, 2, 5].map((pct) => ({
    pct,
    // Depth reachable within a ±pct move on a constant-product curve.
    usd: sideDepth * (1 - 1 / (1 + pct / 100)),
  }));
  // Effective spread proxy: thinner pools with heavy turnover quote wider.
  const spreadBps = liq > 0 ? Math.min(500, Math.max(1, (turnover * 100) / Math.max(1, liq / 100_000))) : 0;

  if (!market) {
    return <div className="text-sm text-muted-foreground">Select a market to stream live info.</div>;
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Streaming price header */}
      <div className="glass rounded-2xl p-4 flex items-center gap-4 flex-wrap">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Last price</span>
          <span
            className={`text-2xl font-bold tabular-nums transition-colors ${
              dir > 0 ? "text-emerald-500" : dir < 0 ? "text-rose-500" : ""
            }`}
          >
            {usd(livePrice)}
          </span>
        </div>
        <span className={`pill ${market.change24h >= 0 ? "pill-ok" : "pill-danger"}`}>
          {market.change24h >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(market.change24h).toFixed(2)}% 24h
        </span>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          live · {ticks.length} tick{ticks.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Session high" value={usd(sessionHi)} />
        <Stat label="Session low" value={usd(sessionLo)} />
        <Stat label="24h volume" value={compact(vol)} />
        <Stat label="Liquidity" value={compact(liq)} />
      </div>

      {/* Order-book / depth summary */}
      <div className="glass rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Order book depth</h3>
          <span className="text-[11px] text-muted-foreground">
            spread ≈ {spreadBps.toFixed(1)} bps · turnover {turnover.toFixed(2)}x
          </span>
        </div>
        <div className="flex flex-col gap-2">
          {bands.map((b) => {
            const width = Math.min(100, (b.usd / Math.max(1, bands[bands.length - 1].usd)) * 100);
            return (
              <div key={b.pct} className="flex items-center gap-3 text-xs">
                <span className="w-14 shrink-0 text-muted-foreground tabular-nums">±{b.pct}%</span>
                <div className="flex-1 h-5 rounded-lg overflow-hidden bg-white/25 relative min-w-0">
                  <div
                    className="absolute inset-y-0 left-0 bg-emerald-500/30"
                    style={{ width: `${width / 2}%` }}
                  />
                  <div
                    className="absolute inset-y-0 right-0 bg-rose-500/30"
                    style={{ width: `${width / 2}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right tabular-nums">{compact(b.usd)}</span>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Depth estimated from the live pool reserves on {market.venue || "the routed venue"} — AMM
          liquidity, not a central-limit book.
        </p>
      </div>

      <div className="glass rounded-2xl p-4 flex flex-col gap-1 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mint address</span>
        <span className="text-xs break-all">{market.mint}</span>
        <span className="text-[11px] text-muted-foreground">Venue · {market.venue || "—"}</span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass rounded-2xl p-3 flex flex-col gap-1 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums truncate">{value}</span>
    </div>
  );
}
