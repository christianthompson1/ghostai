import { useEffect, useState } from "react";
import { Flame, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Token = {
  id: string; symbol: string; name: string; image: string;
  price: number; change24h: number; marketCap: number;
};

export function TrendingRail({
  onPickToken,
  onClose,
}: {
  onPickToken: (t: Token) => void;
  onClose?: () => void;
}) {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("solana-chat", {
          body: { command: "trending", args: { limit: 14 } },
        });
        if (error) throw error;
        if (!cancelled) setTokens(data?.trending ?? []);
      } catch (e: any) {
        if (!cancelled) setErr(e.message ?? "Failed to load trending");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <aside className="h-full w-full flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 sky-text" />
          <span className="font-semibold tracking-tight text-sm">Trending</span>
        </div>
        {onClose ? (
          <button onClick={onClose} className="btn-ghost" aria-label="Close trending">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1">
        Solana ecosystem · click to chart
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col gap-1.5 min-h-0 pr-1">
        {err ? (
          <div className="text-xs text-[color:var(--destructive)] px-2 py-3">{err}</div>
        ) : !tokens ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="glass-pill !rounded-xl h-12 animate-pulse opacity-50" />
          ))
        ) : tokens.length === 0 ? (
          <div className="text-xs text-muted-foreground px-2 py-3">No trending data.</div>
        ) : tokens.map((t) => {
          const up = (t.change24h ?? 0) >= 0;
          return (
            <button
              key={t.id}
              onClick={() => onPickToken(t)}
              className="glass-pill !rounded-xl px-3 py-2 flex items-center gap-2.5 text-left hover:scale-[1.02] transition group"
            >
              {t.image ? (
                <img src={t.image} alt="" className="h-7 w-7 rounded-full shrink-0" />
              ) : (
                <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-xs truncate">{t.symbol}</span>
                  <span className="text-[10px] text-muted-foreground truncate">{t.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground tabular-nums">
                  ${t.price?.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </div>
              </div>
              <span className={`text-[10px] font-bold tabular-nums shrink-0 ${up ? "text-[oklch(0.55_0.18_150)]" : "text-[color:var(--destructive)]"}`}>
                {up ? "▲" : "▼"}{Math.abs(t.change24h ?? 0).toFixed(1)}%
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
