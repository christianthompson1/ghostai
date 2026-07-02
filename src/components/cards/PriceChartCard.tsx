import { useContext, useState } from "react";
import { ChatActionsContext } from "@/components/chat/ChatActionsContext";

const TIMEFRAMES = ["1m", "5m", "1h", "1D", "7D", "1M", "6M", "1Y"] as const;
type TF = typeof TIMEFRAMES[number];

export function PriceChartCard({ data, messageId, partIndex }: { data: any; messageId?: string; partIndex?: number }) {
  const actions = useContext(ChatActionsContext);
  const [loading, setLoading] = useState(false);
  const currentTf = (TIMEFRAMES.includes(data.timeframe as TF) ? data.timeframe : "1D") as TF;
  const positive = (data.change ?? 0) >= 0;
  const embedTarget = data.poolAddress ?? data.address;

  async function pick(tf: TF) {
    if (tf === currentTf || !actions?.updateChartTimeframe || !messageId || partIndex === undefined) return;
    setLoading(true);
    await actions.updateChartTimeframe(messageId, partIndex, tf);
    setLoading(false);
  }

  function copyAddress() {
    if (!data.address) return;
    navigator.clipboard.writeText(data.address);
    window.dispatchEvent(new CustomEvent("ghost:fill-input", { detail: data.address }));
  }

  return (
    <div className="glass p-5 flex flex-col gap-3 backdrop-blur-md transition-all">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {data.image ? (
            <img src={data.image} alt="" className="h-10 w-10 rounded-full ring-1 ring-white/40 shrink-0" />
          ) : null}
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground truncate">
              {data.name ?? "—"} <span className="opacity-60">({data.symbol ?? "—"})</span>
            </div>
            <div className="text-xl font-bold tabular-nums">
              ${data.current?.toLocaleString(undefined, { maximumFractionDigits: 8 }) ?? "—"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {data.address ? (
            <button
              onClick={copyAddress}
              className="pill pill-sky font-mono text-[10px] active:scale-95 transition hover:brightness-110"
              title="Copy mint & fill input"
            >
              {data.address.slice(0, 4)}…{data.address.slice(-4)}
            </button>
          ) : null}
          <span className={`pill ${positive ? "pill-ok" : "pill-danger"}`}>
            {positive ? "▲" : "▼"} {Math.abs(data.change ?? 0).toFixed(2)}%
          </span>
        </div>
      </header>

      <div className="flex items-center gap-1 self-start glass-pill p-1 flex-wrap">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => pick(tf)}
            disabled={loading}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-full transition active:scale-95 ${
              tf === currentTf
                ? "bg-[color:var(--sky)] text-white shadow"
                : "text-muted-foreground hover:text-foreground"
            } ${loading ? "opacity-60 cursor-wait" : ""}`}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="relative h-80 w-full rounded-lg overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 z-10 bg-white/30 dark:bg-black/30 backdrop-blur-sm grid place-items-center animate-fade-in">
            <div className="spinner" />
          </div>
        ) : null}
        {embedTarget ? (
          <iframe
            key={`dex-${embedTarget}`}
            title="DexScreener chart"
            src={`https://dexscreener.com/solana/${embedTarget}?embed=1&theme=dark`}
            className="h-full w-full border-0 animate-fade-in"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full grid place-items-center text-xs text-muted-foreground">
            No chart data available for this token yet.
          </div>
        )}
      </div>
    </div>
  );
}
