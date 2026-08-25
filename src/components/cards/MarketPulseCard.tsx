import { TrendingUp } from "lucide-react";

export function MarketPulseCard({ data }: { data: any }) {
  return (
    <div className="glass p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl glass-pill grid place-items-center">
          <TrendingUp className="h-5 w-5 sky-text" />
        </div>
        <div>
          <h3 className="font-semibold">Solana Market Pulse</h3>
          <div className="text-xs text-muted-foreground">
            Epoch {data.epoch?.epoch ?? "—"} · Slot {data.epoch?.absoluteSlot?.toLocaleString() ?? "—"}
          </div>
        </div>
      </header>

      {data.summary ? <p className="text-sm leading-relaxed text-foreground/90">{data.summary}</p> : null}

      <div className="grid gap-2">
        {data.movers?.slice(0, 6).map((c: any) => {
          const up = (c.change24h ?? 0) >= 0;
          return (
            <div key={c.id} className="glass-pill px-3 py-2 flex items-center gap-3">
              {c.image ? <img src={c.image} alt="" className="h-7 w-7 rounded-full" /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm truncate">{c.name}</span>
                  <span className="text-[11px] uppercase text-muted-foreground">{c.symbol}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  ${c.price?.toLocaleString(undefined, { maximumFractionDigits: 4 })}
                </div>
              </div>
              <span className={`pill ${up ? "pill-ok" : "pill-danger"}`}>
                {up ? "▲" : "▼"} {Math.abs(c.change24h ?? 0).toFixed(2)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
