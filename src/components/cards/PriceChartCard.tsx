import { useEffect, useRef, useState, useContext } from "react";
import { createChart, AreaSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";
import { ChatActionsContext } from "@/components/chat/ChatActionsContext";

const TIMEFRAMES = ["1D", "1W", "1M", "1Y"] as const;
const TF_TO_DAYS: Record<typeof TIMEFRAMES[number], number> = { "1D": 1, "1W": 7, "1M": 30, "1Y": 365 };

export function PriceChartCard({ data, messageId, partIndex }: { data: any; messageId?: string; partIndex?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const actions = useContext(ChatActionsContext);
  const [loading, setLoading] = useState(false);

  const currentTf = (Object.entries(TF_TO_DAYS).find(([, d]) => d === data.days)?.[0] ?? "1W") as typeof TIMEFRAMES[number];

  useEffect(() => {
    if (!ref.current) return;
    const isDark = document.documentElement.classList.contains("dark");
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: isDark ? "#cbd5e1" : "#475569", fontSize: 11 },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: data.days <= 7 },
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
    return () => { chart.remove(); chartRef.current = null; };
  }, [data.points, data.days]);

  const positive = (data.change ?? 0) >= 0;

  async function pick(tf: typeof TIMEFRAMES[number]) {
    if (tf === currentTf || !actions?.updateChartTimeframe || !messageId || partIndex === undefined) return;
    setLoading(true);
    await actions.updateChartTimeframe(messageId, partIndex, tf);
    setLoading(false);
  }

  return (
    <div className="glass p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">
            {data.name ?? "Solana"} <span className="opacity-60">({data.symbol ?? "SOL"})</span>
          </div>
          <div className="text-xl font-bold">
            ${data.current?.toLocaleString(undefined, { maximumFractionDigits: 6 }) ?? "—"}
          </div>
        </div>
        <span className={`pill ${positive ? "pill-ok" : "pill-danger"}`}>
          {positive ? "▲" : "▼"} {Math.abs(data.change ?? 0).toFixed(2)}%
        </span>
      </header>

      <div className="flex items-center gap-1 self-start glass-pill p-1">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => pick(tf)}
            disabled={loading}
            className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
              tf === currentTf
                ? "bg-[color:var(--sky)] text-white shadow"
                : "text-muted-foreground hover:text-foreground"
            } ${loading ? "opacity-60 cursor-wait" : ""}`}
          >
            {tf}
          </button>
        ))}
      </div>

      <div ref={ref} className="h-48 w-full rounded-lg overflow-hidden" />
    </div>
  );
}
