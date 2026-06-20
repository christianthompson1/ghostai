import { useEffect, useRef } from "react";
import { createChart, AreaSeries, type IChartApi, type ISeriesApi } from "lightweight-charts";

export function PriceChartCard({ data }: { data: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const isDark = document.documentElement.classList.contains("dark");
    const chart = createChart(ref.current, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: isDark ? "#cbd5e1" : "#475569",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,23,42,0.05)" },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });
    const series = chart.addSeries(AreaSeries, {
      lineColor: "#38bdf8",
      topColor: "rgba(56,189,248,0.4)",
      bottomColor: "rgba(56,189,248,0)",
      lineWidth: 2,
    }) as ISeriesApi<"Area">;
    series.setData(data.points);
    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => { chart.remove(); chartRef.current = null; };
  }, [data.points]);

  const positive = (data.change ?? 0) >= 0;

  return (
    <div className="glass p-5 flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="text-xs text-muted-foreground">
              {data.address ? "Token" : "Solana (SOL)"} · {data.days}D
            </div>
            <div className="text-xl font-bold">
              ${data.current?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "—"}
            </div>
          </div>
        </div>
        <span className={`pill ${positive ? "pill-ok" : "pill-danger"}`}>
          {positive ? "▲" : "▼"} {Math.abs(data.change).toFixed(2)}%
        </span>
      </header>
      <div ref={ref} className="h-48 w-full rounded-lg overflow-hidden" />
    </div>
  );
}
