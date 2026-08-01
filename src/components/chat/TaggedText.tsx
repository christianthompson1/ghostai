import { useEffect, useState } from "react";
import { TokenIntelCard } from "@/components/cards/TokenIntelCard";
import { PriceChartCard } from "@/components/cards/PriceChartCard";
import { CopyChipText } from "@/components/chat/CopyChipText";
import { resolveTicker, type ResolvedTicker } from "@/lib/ghost-backend";

/**
 * The reasoning model sometimes answers with plain string tags such as
 * `[token_intel]` / `[price_chart]` (optionally followed by a JSON payload or
 * a `:SYMBOL` hint) instead of structured parts. This parser turns those tags
 * into our real interactive cards so nothing renders as raw text.
 */
const TAG_RE = /\[(token_intel|price_chart)(?::\s*([A-Za-z0-9$]{1,20}))?\]\s*(\{[\s\S]*?\})?/g;

type Segment =
  | { kind: "text"; text: string }
  | { kind: "card"; tag: "token_intel" | "price_chart"; payload: any; hint?: string };

export function parseTaggedText(text: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) {
    if (m.index > last) segments.push({ kind: "text", text: text.slice(last, m.index) });
    let payload: any = null;
    if (m[3]) { try { payload = JSON.parse(m[3]); } catch { payload = null; } }
    segments.push({ kind: "card", tag: m[1] as any, payload, hint: m[2] ?? undefined });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** First `$TICKER`, bare mint, or uppercase symbol we can find in the text. */
function inferQuery(text: string): string | null {
  const mint = text.match(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/);
  if (mint) return mint[0];
  const dollar = text.match(/\$([A-Za-z0-9]{2,10})\b/);
  if (dollar) return dollar[1];
  const bare = text.match(/\b([A-Z]{2,10})\b/);
  return bare ? bare[1] : null;
}

export function TaggedText({ text }: { text: string }) {
  const segments = parseTaggedText(text);
  if (segments.length === 1 && segments[0].kind === "text") return <CopyChipText text={text} />;

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {segments.map((s, i) =>
        s.kind === "text" ? (
          s.text.trim() ? <CopyChipText key={i} text={s.text.trim()} /> : null
        ) : (
          <TagCard key={i} tag={s.tag} payload={s.payload} query={s.hint ?? inferQuery(text)} />
        ),
      )}
    </div>
  );
}

function TagCard({ tag, payload, query }: { tag: "token_intel" | "price_chart"; payload: any; query: string | null }) {
  const [resolved, setResolved] = useState<ResolvedTicker | null>(null);
  const [failed, setFailed] = useState(false);
  const hasPayload = !!payload?.address;

  useEffect(() => {
    if (hasPayload || !query) { if (!hasPayload && !query) setFailed(true); return; }
    let cancelled = false;
    (async () => {
      const r = await resolveTicker(query);
      if (cancelled) return;
      if (r) setResolved(r); else setFailed(true);
    })();
    return () => { cancelled = true; };
  }, [hasPayload, query]);

  if (failed && !hasPayload) {
    return (
      <div className="glass p-4 text-sm text-muted-foreground">
        Token not found. Please provide the contract address to initialize the glass analytics interface.
      </div>
    );
  }

  if (!hasPayload && !resolved) {
    return <div className="shimmer-glass h-28 rounded-2xl" />;
  }

  const base = hasPayload
    ? payload
    : {
        address: resolved!.address,
        symbol: resolved!.symbol,
        name: resolved!.name,
        image: resolved!.image,
        price: resolved!.priceUsd,
        current: resolved!.priceUsd,
        change: resolved!.change24h,
        change24h: resolved!.change24h,
        marketCap: resolved!.fdv,
        liquidity: resolved!.liquidityUsd,
        volume24h: resolved!.volume24h,
        poolAddress: resolved!.pairAddress,
        risk: "LOW",
        riskScore: 20,
        risks: [],
        timeframe: "1D",
      };

  return tag === "token_intel" ? <TokenIntelCard data={base} /> : <PriceChartCard data={base} />;
}
