import { Shield, AlertTriangle, CheckCircle2 } from "lucide-react";

export function TokenIntelCard({ data }: { data: any }) {
  const riskColor =
    data.risk === "HIGH" ? "pill-danger" :
    data.risk === "MEDIUM" ? "pill-warn" :
    "pill-ok";
  const Icon = data.risk === "HIGH" ? AlertTriangle : data.risk === "MEDIUM" ? Shield : CheckCircle2;

  return (
    <div className="glass p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3">
        {data.image ? (
          <img src={data.image} alt={data.name} className="h-12 w-12 rounded-xl object-cover" />
        ) : (
          <div className="h-12 w-12 rounded-xl glass-pill grid place-items-center text-sky-text font-bold">
            {(data.symbol ?? "?").slice(0, 2)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold truncate">{data.name}</h3>
            <span className="text-xs text-muted-foreground">{data.symbol}</span>
          </div>
          <div className="text-[11px] text-muted-foreground truncate font-mono">{data.address}</div>
        </div>
        <span className={`pill ${riskColor} shrink-0`}>
          <Icon className="h-3 w-3" /> {data.risk} · {data.riskScore}
        </span>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Metric label="Supply" value={data.supply ? Number(data.supply).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"} />
        <Metric label="Decimals" value={data.decimals ?? "—"} />
        <Metric label="Top wallet" value={`${data.topHolderPct}%`} />
        <Metric label="Top 10" value={`${data.top10Concentration}%`} />
      </div>

      <div className="flex flex-wrap gap-2 text-xs">
        <span className={`pill ${data.mintAuthority ? "pill-danger" : "pill-ok"}`}>
          Mint: {data.mintAuthority ? "ACTIVE" : "revoked"}
        </span>
        <span className={`pill ${data.freezeAuthority ? "pill-warn" : "pill-ok"}`}>
          Freeze: {data.freezeAuthority ? "ACTIVE" : "revoked"}
        </span>
      </div>

      {data.summary ? (
        <p className="text-sm leading-relaxed text-foreground/90">{data.summary}</p>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return (
    <div className="glass-pill px-3 py-2 flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-semibold text-sm truncate">{value}</span>
    </div>
  );
}
