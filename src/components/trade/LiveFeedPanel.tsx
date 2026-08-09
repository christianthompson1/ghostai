import { useEffect, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, Droplets } from "lucide-react";
import type { MarketRow } from "@/lib/trade-store";

export type FeedEvent = {
  id: string;
  t: number;
  symbol: string;
  kind: "tick" | "momentum" | "liquidity";
  text: string;
  delta: number;
};

function usd(n: number) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: abs < 0.01 ? 8 : 4 })}`;
}

function ago(t: number, now: number) {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

/**
 * Rolling live feed built from real diffs between market polls: price ticks on
 * the selected pair plus momentum and liquidity shifts across the universe.
 */
export function LiveFeedPanel({
  markets,
  selectedMint,
}: {
  markets: MarketRow[];
  selectedMint?: string | null;
}) {
  const [events, setEvents] = useState<FeedEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const prevRef = useRef<Record<string, MarketRow>>({});

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!markets.length) return;
    const prev = prevRef.current;
    const fresh: FeedEvent[] = [];
    const stamp = Date.now();

    markets.forEach((m) => {
      const before = prev[m.mint];
      if (before) {
        const priceDelta = before.priceUsd ? ((m.priceUsd - before.priceUsd) / before.priceUsd) * 100 : 0;
        if (Math.abs(priceDelta) >= 0.05 || (m.mint === selectedMint && m.priceUsd !== before.priceUsd)) {
          fresh.push({
            id: `${m.mint}-p-${stamp}`,
            t: stamp,
            symbol: m.symbol,
            kind: Math.abs(priceDelta) >= 1 ? "momentum" : "tick",
            delta: priceDelta,
            text: `${priceDelta >= 0 ? "printed" : "faded to"} ${usd(m.priceUsd)} (${priceDelta >= 0 ? "+" : ""}${priceDelta.toFixed(2)}%)`,
          });
        }
        const liqDelta = before.liquidityUsd
          ? ((m.liquidityUsd - before.liquidityUsd) / before.liquidityUsd) * 100
          : 0;
        if (Math.abs(liqDelta) >= 2) {
          fresh.push({
            id: `${m.mint}-l-${stamp}`,
            t: stamp,
            symbol: m.symbol,
            kind: "liquidity",
            delta: liqDelta,
            text: `pool liquidity ${liqDelta >= 0 ? "added" : "pulled"} ${Math.abs(liqDelta).toFixed(1)}%`,
          });
        }
      }
      prev[m.mint] = m;
    });

    if (!fresh.length) return;
    fresh.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    setEvents((e) => [...fresh.slice(0, 8), ...e].slice(0, 60));
  }, [markets, selectedMint]);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        Streaming ticks, momentum and liquidity shifts across {markets.length} markets
      </div>

      <ul className="flex flex-col gap-2 max-h-[440px] overflow-y-auto pr-1">
        {events.map((e) => {
          const up = e.delta >= 0;
          const Icon = e.kind === "liquidity" ? Droplets : e.kind === "momentum" ? Activity : up ? ArrowUp : ArrowDown;
          return (
            <li
              key={e.id}
              className="glass-pill !rounded-xl px-3 py-2 flex items-center gap-3 text-sm min-w-0"
            >
              <span
                className={`h-7 w-7 shrink-0 grid place-items-center rounded-lg ${
                  e.kind === "liquidity"
                    ? "bg-[color:var(--sky)]/15 text-[color:var(--sky)]"
                    : up
                      ? "bg-emerald-500/15 text-emerald-600"
                      : "bg-rose-500/15 text-rose-600"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="font-semibold shrink-0">{e.symbol}</span>
              <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{e.text}</span>
              <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">{ago(e.t, now)}</span>
            </li>
          );
        })}

        {!events.length ? (
          <li className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="shimmer-glass h-11 rounded-xl block" />
            ))}
            <span className="text-xs text-muted-foreground">Listening for the next market update…</span>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
