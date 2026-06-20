import { CheckCircle2, XCircle, Receipt } from "lucide-react";

export function TxDecodeCard({ data }: { data: any }) {
  const ok = data.status === "SUCCESS";
  return (
    <div className="glass p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-xl glass-pill grid place-items-center">
          <Receipt className="h-5 w-5 sky-text" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">{data.txType ?? "Transaction"}</span>
            <span className="text-xs text-muted-foreground">{data.source}</span>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground truncate">{data.signature}</div>
        </div>
        <span className={`pill ${ok ? "pill-ok" : "pill-danger"}`}>
          {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
          {data.status}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Mini label="Fee" value={`${(data.fee / 1e9).toFixed(6)} SOL`} />
        <Mini label="Slot" value={data.slot?.toLocaleString() ?? "—"} />
        <Mini label="Time" value={data.timestamp ? new Date(data.timestamp * 1000).toLocaleTimeString() : "—"} />
      </div>

      {data.programs?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {data.programs.map((p: string) => (
            <span key={p} className="pill pill-sky font-mono text-[10px]">{p.slice(0, 6)}…{p.slice(-4)}</span>
          ))}
        </div>
      ) : null}

      {data.explanation ? (
        <p className="text-sm leading-relaxed text-foreground/90">{data.explanation}</p>
      ) : null}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-pill px-3 py-2 flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-semibold text-xs truncate">{value}</span>
    </div>
  );
}
