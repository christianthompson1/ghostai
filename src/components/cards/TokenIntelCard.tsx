import { useEffect, useState } from "react";
import { Shield, AlertTriangle, CheckCircle2, Lock, Snowflake, Flame, Droplet, TrendingUp, Coins, Copy } from "lucide-react";
import { fetchTokenMetrics } from "@/lib/ghost-backend";

export function TokenIntelCard({ data: incoming }: { data: any }) {
  const [data, setData] = useState<any>(incoming);

  useEffect(() => { setData(incoming); }, [incoming]);

  useEffect(() => {
    let cancelled = false;
    if (!incoming?.address) return;
    (async () => {
      const m = await fetchTokenMetrics(incoming.address);
      if (cancelled || !m) return;
      setData((prev: any) => ({
        ...prev,
        supply: m.totalSupply ?? prev.supply,
        liquidity: m.liquidityUsd ?? prev.liquidity,
        marketCap: m.fdv ?? prev.marketCap,
        price: m.priceUsd ?? prev.price,
        symbol: prev.symbol ?? m.symbol,
        name: prev.name ?? m.name,
      }));
    })();
    return () => { cancelled = true; };
  }, [incoming?.address]);

  const riskColor =
    data.risk === "HIGH" ? "pill-danger" :
    data.risk === "MEDIUM" ? "pill-warn" :
    "pill-ok";
  const Icon = data.risk === "HIGH" ? AlertTriangle : data.risk === "MEDIUM" ? Shield : CheckCircle2;
  const mintActive = !!data.mintAuthority;
  const freezeActive = !!data.freezeAuthority;

  function copyAddr() {
    if (!data.address) return;
    navigator.clipboard.writeText(data.address);
    window.dispatchEvent(new CustomEvent("ghost:fill-input", { detail: data.address }));
  }


  return (
    <div className="glass p-5 flex flex-col gap-4 overflow-hidden relative backdrop-blur-md">
      <div className="absolute inset-0 -z-10 opacity-40 pointer-events-none"
           style={{ background: "var(--iridescent)", filter: "blur(40px)" }} />

      {/* Header */}
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        {data.image ? (
          <img src={data.image} alt={data.name} className="h-14 w-14 rounded-2xl object-cover shrink-0 ring-1 ring-white/40" />
        ) : (
          <div className="h-14 w-14 rounded-2xl glass-pill grid place-items-center sky-text font-bold shrink-0">
            {(data.symbol ?? "?").slice(0, 2)}
          </div>
        )}
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-lg truncate">{data.name}</h3>
            <span className="pill pill-sky">{data.symbol}</span>
          </div>
          {data.address ? (
            <button
              onClick={copyAddr}
              className="mt-1 inline-flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono hover:text-foreground transition active:scale-95"
              title="Copy & fill input"
            >
              <Copy className="h-3 w-3" />
              <span className="truncate max-w-[200px]">{data.address}</span>
            </button>
          ) : null}
        </div>
        <span className={`pill ${riskColor} shrink-0`}>
          <Icon className="h-3 w-3" /> {data.risk}
        </span>
      </header>

      {/* Price strip */}
      {data.price != null ? (
        <div className="flex items-end justify-between gap-3 pb-2 border-b border-white/20">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Price</div>
            <div className="text-2xl font-bold tabular-nums">${Number(data.price).toLocaleString(undefined, { maximumFractionDigits: 8 })}</div>
          </div>
          {data.change24h != null ? (
            <span className={`pill ${data.change24h >= 0 ? "pill-ok" : "pill-danger"}`}>
              {data.change24h >= 0 ? "▲" : "▼"} {Math.abs(data.change24h).toFixed(2)}% 24h
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Tokenomics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat icon={Coins} label="Supply" value={fmtCompact(data.supply)} />
        <Stat icon={TrendingUp} label="Market cap" value={data.marketCap ? `$${fmtCompact(data.marketCap)}` : "—"} />
        <Stat icon={Droplet} label="Liquidity" value={data.liquidity ? `$${fmtCompact(data.liquidity)}` : "—"} />
        <Stat icon={TrendingUp} label="24h vol" value={data.volume24h ? `$${fmtCompact(data.volume24h)}` : "—"} />
      </div>

      {/* Security flags */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">RugCheck security audit</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Flag danger={mintActive} icon={Flame} pulse={mintActive}
                label={mintActive ? "Mint ACTIVE" : "Mint revoked"} />
          <Flag danger={freezeActive} icon={Snowflake} pulse={freezeActive}
                label={freezeActive ? "Freeze ACTIVE" : "Freeze revoked"} />
          <Flag danger={!data.lpProviders || data.lpProviders < 2} icon={Droplet}
                label={`${data.lpProviders ?? 0} LP provider${data.lpProviders === 1 ? "" : "s"}`} />
          <Flag danger={data.rugged} icon={Lock}
                label={data.rugged ? "Rugged" : (data.lpLockedPct != null ? `LP ${data.lpLockedPct.toFixed(0)}% locked` : "LP status OK")} />
        </div>
      </div>

      {/* Top risks */}
      {data.risks?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {data.risks.map((r: any, i: number) => (
            <span key={i} className={`pill ${r.level === "danger" ? "pill-danger" : r.level === "warn" ? "pill-warn" : "pill-sky"}`}>
              {r.name}
            </span>
          ))}
        </div>
      ) : null}

      {/* Risk meter */}
      <div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          <span>Risk score</span>
          <span>{data.riskScore}/100</span>
        </div>
        <div className="h-2 w-full rounded-full bg-white/30 dark:bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${data.riskScore}%`,
              background: data.riskScore >= 60 ? "var(--destructive)" : data.riskScore >= 35 ? "oklch(0.7 0.18 70)" : "oklch(0.65 0.18 150)",
            }}
          />
        </div>
      </div>

      {data.summary ? (
        <p className="text-sm leading-relaxed text-foreground/90">{data.summary}</p>
      ) : null}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <div className="glass-pill !rounded-xl px-3 py-2.5 flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <span className="font-bold text-sm truncate tabular-nums">{value ?? "—"}</span>
    </div>
  );
}

function Flag({ danger, icon: Icon, label, pulse }: { danger: boolean; icon: any; label: string; pulse?: boolean }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition ${danger
      ? "bg-[oklch(0.95_0.12_27/0.2)] border-[color:var(--destructive)]/50 text-[color:var(--destructive)]"
      : "bg-[oklch(0.92_0.12_150/0.2)] border-[oklch(0.55_0.18_150/0.3)] text-[oklch(0.5_0.18_150)]"
    } ${pulse ? "animate-pulse shadow-[0_0_12px_oklch(0.65_0.25_20/0.6)]" : ""}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="text-[11px] font-semibold truncate">{label}</span>
    </div>
  );
}

function fmtCompact(n: any): string {
  if (n == null) return "—";
  const num = Number(n);
  if (!isFinite(num)) return "—";
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(2) + "K";
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
