import { useEffect, useMemo, useState } from "react";
import { TrendingUp, RefreshCw } from "lucide-react";
import { fetchLivePrices, type LiveTokenRow } from "@/lib/market-data";

/**
 * Live Solana market pulse — top 10 markets by 24h volume, straight from the
 * Ghost AI backend (`/api/v1/markets`), auto-refreshing every 30 seconds.
 */
export function MarketPulseCard({ data }: { data?: any }) {
  const [rows, setRows] = useState<LiveTokenRow[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setRefreshing(true);
    const live = await fetchLivePrices();
    setRows(live);
    setRefreshing(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const top = useMemo(() => (rows ?? []).slice(0, 10), [rows]);

  return (
    <div className="glass p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl glass-pill grid place-items-center">
          <TrendingUp className="h-5 w-5 sky-text" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">Solana Market Pulse</h3>
          <div className="text-xs text-muted-foreground truncate">
            Top 10 by 24h volume · live from the Ghost engine
          </div>
        </div>
        <button onClick={load} className="btn-ghost !px-2" aria-label="Refresh markets">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </header>

      {data?.summary ? (
        <p className="text-sm leading-relaxed text-foreground/90">{data.summary}</p>
      ) : null}

      {rows === null ? (
        <div className="grid gap-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="shimmer-glass h-12 rounded-xl" />
          ))}
        </div>
      ) : top.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No live markets returned by the engine right now.
        </div>
      ) : (
        <div className="grid gap-2">
          {top.map((c) => {
            const up = c.change24h >= 0;
            return (
              <div key={c.mint} className="glass-pill px-3 py-2 flex items-center gap-3">
                {c.image ? (
                  <img src={c.image} alt="" className="h-7 w-7 rounded-full" loading="lazy" />
                ) : (
                  <div className="h-7 w-7 rounded-full glass grid place-items-center text-[10px] font-bold">
                    {c.symbol.slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{c.name || c.symbol}</span>
                    <span className="text-[11px] uppercase text-muted-foreground">{c.symbol}</span>
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    ${c.priceUsd.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                    {c.volume24h ? ` · Vol $${compact(c.volume24h)}` : ""}
                  </div>
                </div>
                <span className={`pill ${up ? "pill-ok" : "pill-danger"}`}>
                  {up ? "▲" : "▼"} {Math.abs(c.change24h).toFixed(2)}%
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function compact(n: number) {
  return Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}
