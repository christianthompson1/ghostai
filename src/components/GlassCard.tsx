import { type ReactNode } from "react";

export function GlassCard({
  title,
  icon,
  accent = "cyan",
  children,
  footer,
}: {
  title: string;
  icon?: ReactNode;
  accent?: "cyan" | "magenta";
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="glass-panel p-5 sm:p-6 flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {icon ? (
            <span
              className={`h-9 w-9 rounded-full flex items-center justify-center glass-panel ${
                accent === "magenta" ? "text-[color:var(--neon-magenta)]" : "text-[color:var(--neon-cyan)]"
              }`}
              style={{ padding: 0 }}
            >
              {icon}
            </span>
          ) : null}
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        </div>
        <span className={`pill ${accent === "magenta" ? "pill-magenta" : "pill-cyan"}`}>Live</span>
      </header>
      <div className="flex-1 flex flex-col gap-3">{children}</div>
      {footer ? <footer className="pt-2 border-t border-white/5">{footer}</footer> : null}
    </section>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="spinner" />
      <span>{label ?? "Loading…"}</span>
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-[color:var(--destructive)]/40 bg-[color:var(--destructive)]/10 px-4 py-3 text-sm text-[color:var(--destructive-foreground)]">
      {message}
    </div>
  );
}
