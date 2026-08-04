import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

const ADDR_RE = /\b([1-9A-HJ-NP-Za-km-z]{32,44})\b/g;
const TICKER_RE = /\$([A-Za-z][A-Za-z0-9]{1,10})\b/g;

function CopyChip({ value, label }: { value: string; label: string }) {
  function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(value);
    window.dispatchEvent(new CustomEvent("ghost:fill-input", { detail: value }));
  }
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-0.5 mx-0.5 align-middle rounded-full text-[10px] font-mono font-semibold bg-[color:var(--sky)]/15 border border-[color:var(--sky)]/40 text-[color:var(--sky)] hover:bg-[color:var(--sky)]/25 active:scale-95 transition shadow-[0_0_8px_oklch(0.7_0.18_232/0.3)]"
      title="Copy & fill input"
    >
      <Copy className="h-2.5 w-2.5" />
      {label}
    </button>
  );
}

function decorate(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let lastIdx = 0;
  let key = 0;
  // Combined matching: find all addresses and tickers, decorate
  const matches: { idx: number; len: number; value: string; label: string }[] = [];
  let m: RegExpExecArray | null;
  ADDR_RE.lastIndex = 0;
  while ((m = ADDR_RE.exec(text)) !== null) {
    matches.push({ idx: m.index, len: m[0].length, value: m[1], label: `${m[1].slice(0, 4)}…${m[1].slice(-4)}` });
  }
  TICKER_RE.lastIndex = 0;
  while ((m = TICKER_RE.exec(text)) !== null) {
    matches.push({ idx: m.index, len: m[0].length, value: m[1], label: `$${m[1]}` });
  }
  matches.sort((a, b) => a.idx - b.idx);
  // Remove overlapping
  const filtered: typeof matches = [];
  let cursor = -1;
  for (const mt of matches) {
    if (mt.idx >= cursor) { filtered.push(mt); cursor = mt.idx + mt.len; }
  }
  for (const mt of filtered) {
    if (mt.idx > lastIdx) out.push(text.slice(lastIdx, mt.idx));
    out.push(<CopyChip key={`c${key++}`} value={mt.value} label={mt.label} />);
    lastIdx = mt.idx + mt.len;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

function decorateNode(children: any): any {
  if (typeof children === "string") return decorate(children);
  if (Array.isArray(children)) return children.map((c, i) => <span key={i}>{decorateNode(c)}</span>);
  return children;
}

const components: Components = {
  p: ({ children }) => <p>{decorateNode(children)}</p>,
  li: ({ children }) => <li>{decorateNode(children)}</li>,
};

export function CopyChipText({ text }: { text: string }) {
  return (
    <div className="prose-chat text-sm chat-text whitespace-pre-wrap overflow-hidden max-w-full">
      <ReactMarkdown components={components}>{text}</ReactMarkdown>
    </div>
  );
}
