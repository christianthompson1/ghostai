import { useContext } from "react";
import { Rocket } from "lucide-react";
import { ChatActionsContext } from "@/components/chat/ChatActionsContext";

export function PumpFunListCard({ data }: { data: any }) {
  const actions = useContext(ChatActionsContext);
  const items = data.items ?? [];

  function pick(item: any) {
    actions?.sendCommand(
      "token_combo",
      { query: item.mint, timeframe: "1h" },
      `Analyze ${item.symbol} (${item.mint.slice(0, 6)}…)`,
    );
  }

  return (
    <div className="glass p-4 flex flex-col gap-2 backdrop-blur-md">
      <header className="flex items-center gap-2 mb-1">
        <Rocket className="h-4 w-4 sky-text" />
        <span className="font-semibold text-sm">Closest to Graduation</span>
      </header>
      <div className="grid sm:grid-cols-2 gap-2">
        {items.map((c: any, i: number) => (
          <button
            key={c.mint}
            onClick={() => pick(c)}
            className="glass-pill !rounded-xl px-3 py-2.5 flex flex-col gap-1.5 text-left active:scale-95 transition hover:bg-white/40 dark:hover:bg-white/10 animate-fade-in"
            style={{ animationDelay: `${i * 20}ms` }}
          >
            <div className="flex items-center gap-2.5">
              {c.image ? (
                <img src={c.image} alt="" className="h-8 w-8 rounded-full shrink-0 ring-1 ring-white/40" />
              ) : (
                <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-bold text-xs truncate">{c.symbol}</div>
                <div className="text-[10px] text-muted-foreground truncate">{c.name}</div>
              </div>
              <span className="text-[10px] font-bold sky-text tabular-nums shrink-0">{c.progress.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/30 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, c.progress)}%`,
                  background: c.progress > 80
                    ? "linear-gradient(90deg, oklch(0.7 0.2 30), oklch(0.65 0.22 10))"
                    : "linear-gradient(90deg, oklch(0.72 0.2 232), oklch(0.7 0.18 280))",
                }}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
