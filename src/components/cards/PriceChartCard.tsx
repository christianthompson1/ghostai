import { useEffect, useRef, useState, useContext } from "react";
import { createChart, AreaSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { ChatActionsContext } from "@/components/chat/ChatActionsContext";

const TIMEFRAMES = ["1m", "5m", "1h", "1D", "7D", "1M", "6M", "1Y"] as const;
type TF = typeof TIMEFRAMES[number];

export function PriceChartCard({ data, messageId, partIndex }: { data: any; messageId?: string; partIndex?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const actions = useContext(ChatActionsContext);
  const [loading, setLoading] = useState(false);
  const [fadeKey, setFadeKey] = useState(0);

  const currentTf = (TIMEFRAMES.includes(data.timeframe as TF) ? data.timeframe : "1D") as TF;

  const hasPoints = Array.isArray(data.points) && data.points.length > 1;
  const [canvasFailed, setCanvasFailed] = useState(false);

  useEffect(() => {
    if (!ref.current || !hasPoints) return;
    let cancelled = false;
    try {
      const isDark = document.documentElement.classList.contains("dark");
      const chart = createChart(ref.current, {
        autoSize: true,
        layout: { background: { color: "transparent" }, textColor: isDark ? "#cbd5e1" : "#475569", fontSize: 11 },
        grid: {
          vertLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)" },
          horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)" },
        },
        rightPriceScale: { borderVisible: false },
        timeScale: {
          borderVisible: false,
          timeVisible: ["1m", "5m", "1h", "1D", "7D"].includes(currentTf),
        },
      });
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#38bdf8",
        topColor: "rgba(56,189,248,0.4)",
        bottomColor: "rgba(56,189,248,0)",
        lineWidth: 2,
      }) as ISeriesApi<"Area">;
      series.setData(data.points ?? []);
      chart.timeScale().fitContent();
      chartRef.current = chart;
      setFadeKey((k) => k + 1);
      return () => { if (!cancelled) { chart.remove(); chartRef.current = null; } };
    } catch (e) {
      console.error("[PriceChart] render failed, falling back to iframe", e);
      setCanvasFailed(true);
    }
    return () => { cancelled = true; };
  }, [data.points, currentTf, hasPoints]);


  const positive = (data.change ?? 0) >= 0;

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

      <div className="relative h-48 w-full rounded-lg overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 z-10 bg-white/30 dark:bg-black/30 backdrop-blur-sm grid place-items-center animate-fade-in">
            <div className="spinner" />
          </div>
        ) : null}
        <div key={fadeKey} ref={ref} className="h-full w-full animate-fade-in" />
      </div>
    </div>
  );
}
