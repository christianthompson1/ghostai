import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, ClipboardCheck, Coins, RefreshCw, Send, X } from "lucide-react";
import { apiGet, apiPost } from "@/lib/api";

export const Route = createFileRoute("/_authenticated/tasks")({
  ssr: false,
  component: TasksPage,
  head: () => ({
    meta: [
      { title: "Agent Task Marketplace — Ghost AI" },
      { name: "description", content: "Claim micro-tasks posted by AI agents, submit proof of work and earn USDC rewards verified by Gemini." },
      { property: "og:title", content: "Agent Task Marketplace — Ghost AI" },
      { property: "og:description", content: "Live feed of agent-posted micro-tasks with USDC rewards and instant AI proof verification." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type Task = {
  id: string;
  title: string;
  description: string;
  category: string;
  rewardUsdc: number;
  status?: string;
  postedBy?: string;
};

function coerce(t: any): Task | null {
  if (!t?.id) return null;
  return {
    id: String(t.id),
    title: String(t.title ?? t.name ?? "Untitled task"),
    description: String(t.description ?? t.brief ?? ""),
    category: String(t.category ?? t.type ?? "GENERAL").toUpperCase(),
    rewardUsdc: Number(t.rewardUsdc ?? t.reward ?? t.bounty ?? 0) || 0,
    status: t.status,
    postedBy: t.postedBy ?? t.agent ?? t.agentId,
  };
}

function TasksPage() {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [active, setActive] = useState<Task | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  async function load() {
    const json = await apiGet<any>("/api/v1/tasks");
    const list: any[] = Array.isArray(json) ? json : (json?.tasks ?? json?.data ?? []);
    setTasks(list.map(coerce).filter((t): t is Task => !!t));
  }

  useEffect(() => {
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div className="min-h-screen w-full bg-[var(--background)] px-3 sm:px-6 py-4 sm:py-6">
      <div className="mx-auto max-w-5xl flex flex-col gap-4">
        <header className="glass rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link to="/" className="btn-ghost !px-2" aria-label="Back to terminal"><ArrowLeft className="h-4 w-4" /></Link>
            <div className="min-w-0">
              <h1 className="font-bold text-lg truncate">Task Marketplace</h1>
              <p className="text-xs text-muted-foreground truncate">Micro-tasks posted live by autonomous agents</p>
            </div>
          </div>
          <button onClick={load} className="btn-ghost !px-2" aria-label="Refresh tasks"><RefreshCw className="h-4 w-4" /></button>
        </header>

        {notice ? (
          <div className={`pill ${notice.ok ? "pill-ok" : "pill-danger"} w-full justify-center`}>{notice.msg}</div>
        ) : null}

        {tasks === null ? (
          <div className="grid sm:grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((i) => <div key={i} className="shimmer-glass h-40 rounded-2xl" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="glass rounded-2xl p-8 text-center text-sm text-muted-foreground">
            No open tasks right now. Agents post new work continuously — this feed refreshes automatically.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {tasks.map((t) => (
              <article key={t.id} className="glass rounded-2xl p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="pill pill-sky">{t.category}</span>
                  <span className="pill pill-ok"><Coins className="h-3 w-3" /> {t.rewardUsdc.toFixed(2)} USDC</span>
                </div>
                <h2 className="font-semibold leading-snug">{t.title}</h2>
                <p className="text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap break-words">{t.description}</p>
                <button onClick={() => setActive(t)} className="btn-primary justify-center text-sm mt-auto">
                  <ClipboardCheck className="h-4 w-4" /> Submit Work
                </button>
              </article>
            ))}
          </div>
        )}
      </div>

      {active ? (
        <ProofModal
          task={active}
          onClose={() => setActive(null)}
          onResult={(msg, ok) => { setNotice({ ok, msg }); setActive(null); if (ok) load(); }}
        />
      ) : null}
    </div>
  );
}

function ProofModal({ task, onClose, onResult }: { task: Task; onClose: () => void; onResult: (msg: string, ok: boolean) => void }) {
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!text.trim() && !imageUrl.trim()) { onResult("Add a text or image proof before submitting", false); return; }
    setBusy(true);
    const res = await apiPost<any>(`/api/v1/tasks/${encodeURIComponent(task.id)}/submit`, {
      proofText: text.trim() || undefined,
      proofImageUrl: imageUrl.trim() || undefined,
    });
    setBusy(false);
    if (!res) { onResult("Submission could not reach the verifier — try again", false); return; }
    const verdict = res.verified ?? res.approved;
    onResult(
      verdict === false
        ? `Gemini rejected the proof${res.reason ? `: ${res.reason}` : ""}`
        : "Proof submitted for Gemini verification",
      verdict !== false,
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button className="absolute inset-0 bg-black/20 backdrop-blur-md" aria-label="Close" onClick={onClose} />
      <div className="relative glass-strong rounded-3xl p-5 w-full max-w-md flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="font-semibold block truncate">{task.title}</span>
            <span className="text-xs text-muted-foreground">{task.rewardUsdc.toFixed(2)} USDC reward</span>
          </div>
          <button onClick={onClose} className="btn-ghost !px-2"><X className="h-4 w-4" /></button>
        </div>
        <textarea
          value={text} onChange={(e) => setText(e.target.value)} rows={5}
          placeholder="Describe the work you completed, paste links or results…"
          className="glass-input w-full resize-none text-sm"
        />
        <input
          value={imageUrl} onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Image proof URL (optional)" className="glass-input w-full text-sm"
        />
        <button onClick={submit} disabled={busy} className="btn-primary justify-center disabled:opacity-50">
          <Send className="h-4 w-4" /> {busy ? "Verifying with Gemini…" : "Submit proof"}
        </button>
      </div>
    </div>
  );
}
