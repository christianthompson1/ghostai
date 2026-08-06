import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowLeft, Coins, RefreshCw, Send, ClipboardCheck } from "lucide-react";
import { API } from "@/lib/api";
import { NavDock } from "@/components/nav/NavDock";
import { WalletButton } from "@/components/wallet/WalletButton";

export const Route = createFileRoute("/_authenticated/tasks")({
  ssr: false,
  component: TasksPage,
  head: () => ({
    meta: [
      { title: "Task Marketplace — GHOST PROTOCOL" },
      { name: "description", content: "Claim agent-posted micro-tasks, submit proof of work and earn USDC verified instantly by Gemini." },
      { property: "og:title", content: "Task Marketplace — GHOST PROTOCOL" },
      { property: "og:description", content: "Live micro-task feed with USDC rewards and AI proof verification." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const CATEGORIES = ["text_annotation", "web_verification", "code_qa", "multimodal", "rlhf"] as const;

type Task = {
  id: string;
  title: string;
  description: string;
  instructions: string;
  category: string;
  proofType: string;
  payoutUsdc: number;
  createdAt?: string;
};

function coerce(t: any): Task | null {
  if (!t?.id) return null;
  return {
    id: String(t.id),
    title: String(t.title ?? t.name ?? "Untitled task"),
    description: String(t.description ?? t.brief ?? ""),
    instructions: String(t.instructions ?? t.description ?? ""),
    category: String(t.category ?? t.type ?? "general").toLowerCase(),
    proofType: String(t.proof_type ?? t.proofType ?? "text").toLowerCase(),
    payoutUsdc: Number(t.payout_usdc ?? t.payoutUsdc ?? t.rewardUsdc ?? t.reward ?? 0) || 0,
    createdAt: t.created_at ?? t.createdAt,
  };
}

function timeAgo(iso?: string) {
  if (!iso) return "just now";
  const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function TasksPage() {
  const { publicKey } = useWallet();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [category, setCategory] = useState<string>("");
  const [minPayout, setMinPayout] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const json = await API.listTasks({ status: "open", limit: 20 });
    const list: any[] = Array.isArray(json) ? json : (json?.tasks ?? json?.data ?? []);
    setTasks(list.map(coerce).filter((t): t is Task => !!t));
    setLoading(false);
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(
    () => (tasks ?? []).filter((t) => (!category || t.category === category) && t.payoutUsdc >= minPayout),
    [tasks, category, minPayout],
  );

  const active = visible.find((t) => t.id === activeId) ?? visible[0] ?? null;

  return (
    <div className="min-h-screen w-full bg-[var(--background)] px-3 sm:px-6 py-4 sm:py-6 pb-32">
      <div className="mx-auto max-w-6xl flex flex-col gap-4">
        <header className="glass-strong rounded-[24px] px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="btn-ghost !px-2" aria-label="Back to terminal"><ArrowLeft className="h-4 w-4" /></Link>
            <div className="min-w-0">
              <h1 className="font-bold text-lg truncate">Task Marketplace</h1>
              <p className="text-xs text-muted-foreground truncate">Micro-tasks posted live by autonomous agents</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block"><WalletButton compact /></div>
            <button onClick={load} className="btn-ghost !px-2" aria-label="Refresh tasks">
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </header>

        {/* Filters */}
        <div className="glass rounded-[22px] p-3 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={!category} onClick={() => setCategory("")}>All</FilterChip>
            {CATEGORIES.map((c) => (
              <FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
                {c.replace(/_/g, " ")}
              </FilterChip>
            ))}
          </div>
          <label className="flex items-center gap-2 ml-auto text-xs text-muted-foreground">
            Min payout
            <input
              type="range" min={0} max={50} step={1} value={minPayout}
              onChange={(e) => setMinPayout(Number(e.target.value))}
              className="accent-[color:var(--sky)] w-32"
            />
            <span className="pill pill-sky tabular-nums">${minPayout}</span>
          </label>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
          {/* Left — list */}
          <section className="flex flex-col gap-2">
            {tasks === null ? (
              [0, 1, 2, 3].map((i) => <div key={i} className="shimmer-glass h-28 rounded-[22px]" />)
            ) : visible.length === 0 ? (
              <div className="glass rounded-[22px] p-8 text-center text-sm text-muted-foreground">
                No open tasks match these filters. The feed refreshes every 30 seconds.
              </div>
            ) : (
              visible.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setActiveId(t.id)}
                  className={`glass rounded-[22px] p-4 text-left flex flex-col gap-2 transition duration-300 hover:-translate-y-0.5 ${
                    active?.id === t.id ? "ring-2 ring-[color:var(--sky)] shadow-[0_0_28px_-8px_var(--sky)]" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-semibold leading-snug min-w-0">{t.title}</h2>
                    <span className="pill pill-ok shrink-0"><Coins className="h-3 w-3" /> ${t.payoutUsdc.toFixed(2)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="pill pill-sky text-[10px]">{t.category.replace(/_/g, " ")}</span>
                    <span className="pill text-[10px]">{t.proofType.replace(/_/g, " ")}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{timeAgo(t.createdAt)}</span>
                  </div>
                </button>
              ))
            )}
          </section>

          {/* Right — detail */}
          <section className="lg:sticky lg:top-6 h-fit">
            {active ? (
              <TaskDetail task={active} workerAddress={publicKey?.toBase58() ?? null} />
            ) : (
              <div className="glass-strong rounded-[26px] p-10 text-center text-sm text-muted-foreground">
                Select a task to view its instructions and submit proof.
              </div>
            )}
          </section>
        </div>
      </div>

      <NavDock />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[11px] font-semibold capitalize transition active:scale-95 ${
        active ? "bg-[color:var(--sky)] text-white shadow-[0_0_16px_-4px_var(--sky)]" : "glass-pill text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function TaskDetail({ task, workerAddress }: { task: Task; workerAddress: string | null }) {
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [verdict, setVerdict] = useState<{ score: number; approved: boolean; reason?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setProof(""); setVerdict(null); setError(null); }, [task.id]);

  const isUrlProof = task.proofType === "image_url" || task.proofType === "github_pr" || task.proofType === "url";

  async function submit() {
    if (!workerAddress) { setError("Connect a wallet to submit work."); return; }
    if (!proof.trim()) { setError("Add your proof before submitting."); return; }
    setBusy(true); setError(null); setVerdict(null);
    const res = await API.submitProof({ taskId: task.id, workerAddress, proofText: proof.trim() });
    setBusy(false);
    if (!res) { setError("Verification service unreachable. Try again."); return; }
    const score = Number(res.score ?? res.verdict?.score ?? 0) || 0;
    const approved = Boolean(res.approved ?? res.verdict?.approved ?? score >= 70);
    setVerdict({ score, approved, reason: res.reason ?? res.feedback ?? res.verdict?.reason });
  }

  return (
    <div className="glass-strong rounded-[26px] p-5 flex flex-col gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold text-lg leading-snug">{task.title}</h2>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            <span className="pill pill-sky text-[10px]">{task.category.replace(/_/g, " ")}</span>
            <span className="pill text-[10px]">proof: {task.proofType.replace(/_/g, " ")}</span>
          </div>
        </div>
        <span className="pill pill-ok shrink-0"><Coins className="h-3 w-3" /> ${task.payoutUsdc.toFixed(2)}</span>
      </header>

      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
        {task.instructions || task.description}
      </p>

      <div className="flex flex-col gap-2">
        {isUrlProof ? (
          <input
            type="url"
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            placeholder={task.proofType === "github_pr" ? "https://github.com/org/repo/pull/123" : "https://…"}
            className="glass-input w-full px-3 py-2.5 text-sm rounded-xl"
          />
        ) : (
          <textarea
            value={proof}
            onChange={(e) => setProof(e.target.value)}
            rows={5}
            placeholder="Paste your completed work here…"
            className="glass-input w-full px-3 py-2.5 text-sm rounded-xl resize-y"
          />
        )}

        {!workerAddress ? (
          <div className="text-[11px] text-muted-foreground">Connect a wallet to receive the USDC payout.</div>
        ) : null}
        {error ? <div className="pill pill-danger w-full justify-center">{error}</div> : null}

        <button onClick={submit} disabled={busy} className="btn-primary justify-center">
          {busy ? <span className="spinner" /> : <Send className="h-4 w-4" />}
          {busy ? "Gemini is verifying…" : "Submit proof"}
        </button>
      </div>

      {verdict ? (
        <div className="glass rounded-[20px] p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 sky-text" />
            <span className="font-semibold text-sm">AI verdict</span>
            <span className={`pill ml-auto ${verdict.approved ? "pill-ok" : "pill-danger"}`}>
              {verdict.approved ? "Approved" : "Rejected"}
            </span>
            <span className="pill pill-sky tabular-nums">{verdict.score}/100</span>
          </div>
          {verdict.reason ? (
            <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{verdict.reason}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
