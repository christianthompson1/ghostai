import { useEffect, useState, useCallback } from "react";
import { Rocket, X, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type PumpCoin = {
  mint: string;
  name: string;
  symbol: string;
  image: string | null;
  progress: number;
  marketCap: number;
};

export function PumpFunRail({
  onPickToken,
  onClose,
}: {
  onPickToken: (t: PumpCoin) => void;
  onClose?: () => void;
}) {
  const [coins, setCoins] = useState<PumpCoin[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data, error } = await supabase.functions.invoke("solana-chat", {
        body: { command: "pumpfun", args: { limit: 20 } },
      });
      if (error) throw error;
      setCoins(data?.pumpfun ?? []);
      setErr(null);
    } catch (e: any) {
      setErr(e.message ?? "Feed unavailable");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <aside className="h-full w-full flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Rocket className="h-4 w-4 sky-text" />
          <span className="font-semibold tracking-tight text-sm">Pump.fun Graduating</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={load} className="btn-ghost" aria-label="Refresh" disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          {onClose ? (
            <button onClick={onClose} className="btn-ghost" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">
        Top 20 closest to 100% · auto-refresh 30s
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-0 pr-1 -mr-1">
        {err ? (
          <div className="glass-pill !rounded-xl text-xs text-[color:var(--destructive)] px-3 py-3">{err}</div>
        ) : !coins ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-pill !rounded-xl h-14 animate-pulse opacity-50" />
          ))
        ) : coins.length === 0 ? (
          <div className="text-xs text-muted-foreground px-2 py-3">No live data.</div>
        ) : coins.map((c, i) => (
          <button
            key={c.mint}
            onClick={() => onPickToken(c)}
            className="glass-pill !rounded-xl px-3 py-2 flex flex-col gap-1.5 text-left transition active:scale-95 hover:bg-white/40 dark:hover:bg-white/10 animate-fade-in"
            style={{ animationDelay: `${i * 20}ms` }}
          >
            <div className="flex items-center gap-2.5">
              {c.image ? (
                <img src={c.image} alt="" className="h-8 w-8 rounded-full shrink-0 ring-1 ring-white/40" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs truncate">{c.symbol}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{c.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  ${(c.marketCap ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} MC
                </div>
              </div>
              <span className="text-[10px] font-bold tabular-nums shrink-0 sky-text">
                {c.progress.toFixed(1)}%
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/30 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, c.progress)}%`,
                  background: c.progress > 80
                    ? "linear-gradient(90deg, oklch(0.7 0.2 30), oklch(0.65 0.22 10))"
                    : "linear-gradient(90deg, oklch(0.72 0.2 232), oklch(0.7 0.18 280))",
                  boxShadow: c.progress > 80 ? "0 0 8px oklch(0.7 0.2 30 / 0.6)" : undefined,
                }}
              />
            </div>
          </button>
        ))}
      </div>
    </aside>
  );
}
