import { Shield, AlertTriangle, CheckCircle2, Lock, Snowflake, Flame, Users, Calendar, Coins, TrendingUp } from "lucide-react";

export function TokenIntelCard({ data }: { data: any }) {
  const riskColor =
    data.risk === "HIGH" ? "pill-danger" :
    data.risk === "MEDIUM" ? "pill-warn" :
    "pill-ok";
  const Icon = data.risk === "HIGH" ? AlertTriangle : data.risk === "MEDIUM" ? Shield : CheckCircle2;

  const ageLabel = data.ageDays == null
    ? "—"
    : data.ageDays < 31
      ? `${data.ageDays}d`
      : data.ageDays < 365
        ? `${Math.floor(data.ageDays / 30)}mo`
        : `${(data.ageDays / 365).toFixed(1)}y`;

  return (
    <div className="glass p-5 flex flex-col gap-4 overflow-hidden relative">
      <div className="absolute inset-0 -z-10 opacity-40 pointer-events-none"
           style={{ background: "var(--iridescent)", filter: "blur(40px)" }} />

      {/* Header */}
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
        {data.image ? (
          <img src={data.image} alt={data.name} className="h-14 w-14 rounded-2xl object-cover shrink-0 ring-1 ring-white/30" />
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
            <div className="text-[10px] text-muted-foreground truncate font-mono mt-0.5">{data.address}</div>
          ) : null}
        </div>
        <span className={`pill ${riskColor} shrink-0`}>
          <Icon className="h-3 w-3" /> {data.risk}
        </span>
      </header>

      {/* Price strip */}
      {data.price != null ? (
        <div className="flex items-end justify-between gap-3 pb-2 border-b border-white/10">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Price</div>
            <div className="text-2xl font-bold">${Number(data.price).toLocaleString(undefined, { maximumFractionDigits: 6 })}</div>
          </div>
          {data.change24h != null ? (
            <span className={`pill ${data.change24h >= 0 ? "pill-ok" : "pill-danger"}`}>
              {data.change24h >= 0 ? "▲" : "▼"} {Math.abs(data.change24h).toFixed(2)}% 24h
            </span>
          ) : null}
        </div>
      ) : null}

      {/* Stat grid — infographic style */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat icon={Calendar} label="Token age" value={ageLabel} />
        <Stat icon={Coins} label="Circulating" value={fmtCompact(data.circulatingSupply ?? data.supply)} />
        <Stat icon={Coins} label="Total supply" value={fmtCompact(data.totalSupply ?? data.supply)} />
        <Stat icon={TrendingUp} label="Market cap" value={data.marketCap ? `$${fmtCompact(data.marketCap)}` : "—"} />
      </div>

      {/* Security flags row */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Security audit</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Flag ok={!data.mintAuthority} icon={Flame}
                onLabel="Mint revoked" offLabel="Mint active" />
          <Flag ok={!data.freezeAuthority} icon={Snowflake}
                onLabel="Freeze revoked" offLabel="Freeze active" />
          <Flag ok={data.topHolderPct < 25} icon={Users}
                onLabel={`Top wallet ${data.topHolderPct}%`} offLabel={`Whale alert ${data.topHolderPct}%`} />
          <Flag ok={data.top10Concentration < 50} icon={Lock}
                onLabel={`Top 10: ${data.top10Concentration}%`} offLabel={`Concentrated: ${data.top10Concentration}%`} />
        </div>
      </div>

      {/* Risk meter */}
      <div>
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          <span>Risk score</span>
          <span>{data.riskScore}/100</span>
        </div>
        <div className="h-2 w-full rounded-full bg-white/20 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
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
      <span className="font-bold text-sm truncate">{value ?? "—"}</span>
    </div>
  );
}

function Flag({ ok, icon: Icon, onLabel, offLabel }: { ok: boolean; icon: any; onLabel: string; offLabel: string }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${ok
      ? "bg-[oklch(0.92_0.12_150/0.2)] border-[oklch(0.55_0.18_150/0.3)] text-[oklch(0.5_0.18_150)]"
      : "bg-[oklch(0.95_0.12_27/0.2)] border-[color:var(--destructive)]/30 text-[color:var(--destructive)]"
    }`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="text-[11px] font-semibold truncate">{ok ? onLabel : offLabel}</span>
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
