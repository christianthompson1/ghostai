import { useEffect, useRef, useState } from "react";
import { fetchCandles, type Candle, type CandleTF } from "@/lib/market-data";

const TFS: CandleTF[] = ["15m", "1h", "1d"];

/**
 * Native TradingView lightweight-charts panel styled for the light liquid-glass
 * theme. No iframes, no third-party watermarks.
 */
export function GlassCandleChart({ mint, symbol }: { mint: string | null; symbol?: string }) {
  const holder = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const [tf, setTf] = useState<CandleTF>("1h");
  const [rows, setRows] = useState<Candle[] | null>(null);

  // Create the chart once.
  useEffect(() => {
    let disposed = false;
    (async () => {
      const lib: any = await import("lightweight-charts");
      if (disposed || !holder.current) return;
      const dark = document.documentElement.classList.contains("dark");
      const text = dark ? "rgba(255,255,255,0.75)" : "rgba(30,41,59,0.75)";
      const grid = dark ? "rgba(255,255,255,0.06)" : "rgba(56,189,248,0.10)";
      const chart = lib.createChart(holder.current, {
        layout: { background: { color: "transparent" }, textColor: text, attributionLogo: false },
        grid: { vertLines: { color: grid }, horzLines: { color: grid } },
        rightPriceScale: { borderVisible: false },
        timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
        crosshair: { vertLine: { color: "rgba(56,189,248,0.5)" }, horzLine: { color: "rgba(56,189,248,0.5)" } },
        height: 380,
        autoSize: true,
      });
      const series = lib.CandlestickSeries
        ? chart.addSeries(lib.CandlestickSeries, {
            upColor: "rgba(34,197,94,0.9)", downColor: "rgba(239,68,68,0.9)",
            borderVisible: false,
            wickUpColor: "rgba(34,197,94,0.6)", wickDownColor: "rgba(239,68,68,0.6)",
          })
        : chart.addCandlestickSeries({ upColor: "#22c55e", downColor: "#ef4444", borderVisible: false });
      chartRef.current = chart;
      seriesRef.current = series;
    })();
    return () => {
      disposed = true;
      try { chartRef.current?.remove(); } catch { /* already gone */ }
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load candles whenever the market or timeframe changes.
  useEffect(() => {
    if (!mint) { setRows(null); return; }
    let cancelled = false;
    setRows(null);
    async function load() {
      const data = await fetchCandles(mint!, tf);
      if (cancelled) return;
      setRows(data);
    }
    load();
    const id = setInterval(load, 15_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [mint, tf]);

  // Paint.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || !rows?.length) return;
    series.setData(
      rows.map((c) => ({
        time: Math.floor(c.t > 2e10 ? c.t / 1000 : c.t) as any,
        open: c.o || c.c, high: c.h || c.c, low: c.l || c.c, close: c.c,
      })),
    );
    try { chartRef.current?.timeScale().fitContent(); } catch { /* noop */ }
  }, [rows]);

  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div className="flex items-center gap-1.5">
        {TFS.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={`pill ${tf === t ? "pill-sky" : ""} px-3 py-1 active:scale-95 transition`}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="relative rounded-xl overflow-hidden border border-white/30 bg-white/20 h-[380px]">
        <div ref={holder} className="absolute inset-0" />
        {!mint || !rows?.length ? (
          <div className="absolute inset-0 grid place-items-center gap-3 p-6">
            <div className="shimmer-glass h-24 w-3/4 rounded-xl" />
            <span className="text-xs text-muted-foreground">
              {mint ? `Streaming ${symbol ?? "pool"} metrics…` : "Select a market to load the chart"}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
