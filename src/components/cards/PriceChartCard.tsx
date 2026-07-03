import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fetchOhlcv, type OhlcvPoint } from "@/lib/ghost-backend";

const TIMEFRAMES = ["1m", "5m", "1h", "1D", "7D", "1M"] as const;
type TF = typeof TIMEFRAMES[number];

export function PriceChartCard({ data }: { data: any; messageId?: string; partIndex?: number }) {
  const [tf, setTf] = useState<TF>(
    (TIMEFRAMES as readonly string[]).includes(data.timeframe) ? (data.timeframe as TF) : "1D",
  );
  const [points, setPoints] = useState<OhlcvPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const pool = data.poolAddress ?? data.pairAddress;

  useEffect(() => {
    let cancelled = false;
    if (!pool) { setPoints([]); return; }
    setLoading(true);
    fetchOhlcv(pool, tf).then((pts) => {
      if (cancelled) return;
      setPoints(pts);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [pool, tf]);

  const stats = useMemo(() => {
    if (!points.length) return { first: 0, last: 0, changePct: data.change ?? 0 };
    const first = points[0].c;
    const last = points[points.length - 1].c;
    const changePct = first ? ((last - first) / first) * 100 : 0;
    return { first, last, changePct };
  }, [points, data.change]);

  const positive = stats.changePct >= 0;
  const currentPrice = stats.last || data.current;

  function copyAddress() {
    if (!data.address) return;
    navigator.clipboard.writeText(data.address);
    window.dispatchEvent(new CustomEvent("ghost:fill-input", { detail: data.address }));
  }

  const glowColor = positive ? "oklch(0.78 0.16 190)" : "oklch(0.7 0.22 25)";
  const gradId = `ghost-area-${(data.address ?? "x").slice(0, 6)}`;

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
              ${currentPrice?.toLocaleString(undefined, { maximumFractionDigits: 8 }) ?? "—"}
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
            {positive ? "▲" : "▼"} {Math.abs(stats.changePct).toFixed(2)}%
          </span>
        </div>
      </header>

      <div className="flex items-center gap-1 self-start glass-pill p-1 flex-wrap">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            disabled={loading && t === tf}
            className={`px-2.5 py-1 text-[11px] font-semibold rounded-full transition active:scale-95 ${
              t === tf
                ? "bg-[color:var(--sky)] text-white shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="relative h-72 w-full rounded-xl overflow-hidden bg-white/20 dark:bg-white/5 border border-white/20 backdrop-blur-md">
        {loading ? (
          <div className="absolute inset-0 z-10 grid place-items-center text-[11px] text-muted-foreground shimmer-glass">
            Analyzing ledger streams…
          </div>
        ) : null}
        {!loading && !points.length ? (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground text-center px-4">
            No historical liquidity data for this pool yet.
          </div>
        ) : null}
        {points.length ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={glowColor} stopOpacity={0.55} />
                  <stop offset="100%" stopColor={glowColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="t"
                tick={{ fontSize: 10, fill: "currentColor", opacity: 0.55 }}
                tickFormatter={(t) => fmtTick(t, tf)}
                stroke="transparent"
                minTickGap={40}
              />
              <YAxis
                domain={["auto", "auto"]}
                tick={{ fontSize: 10, fill: "currentColor", opacity: 0.55 }}
                tickFormatter={(v) => fmtPrice(v)}
                stroke="transparent"
                width={54}
                orientation="right"
              />
              <Tooltip content={<GlassTooltip />} />
              <Area
                type="monotone"
                dataKey="c"
                stroke={glowColor}
                strokeWidth={2}
                fill={`url(#${gradId})`}
                fillOpacity={1}
                dot={false}
                isAnimationActive
                style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : null}
      </div>
    </div>
  );
}

function GlassTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload as OhlcvPoint;
  return (
    <div className="glass px-3 py-2 text-[11px] tabular-nums shadow-lg">
      <div className="text-muted-foreground">{new Date(p.t).toLocaleString()}</div>
      <div className="font-bold">${fmtPrice(p.c)}</div>
    </div>
  );
}

function fmtPrice(v: number) {
  if (!isFinite(v)) return "—";
  if (v >= 1) return v.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return v.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function fmtTick(t: number, tf: TF) {
  const d = new Date(t);
  if (tf === "1m" || tf === "5m" || tf === "1h" || tf === "1D") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
