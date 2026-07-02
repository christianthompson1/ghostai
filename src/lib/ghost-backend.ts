/**
 * Ghost AI external backend (Replit).
 * All transaction decoding and token-metrics calls go here — not the client SDKs.
 */
export const GHOST_BACKEND =
  "https://53f91562-532a-4457-b69f-e770ae7cc385-00-1odxz0gc2gyuo.janeway.replit.dev";

export async function decodeTransaction(input: string): Promise<any> {
  const res = await fetch(`${GHOST_BACKEND}/api/debug-transaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error ?? `Backend error ${res.status}`);
  return json;
}

export async function fetchTokenMetrics(mint: string): Promise<{
  mint: string;
  symbol?: string;
  name?: string;
  priceUsd?: number;
  totalSupply?: number | null;
  liquidityUsd?: number;
  fdv?: number;
  pairAddress?: string;
  dex?: string;
  pairCreatedAt?: number | null;
} | null> {
  try {
    const res = await fetch(
      `${GHOST_BACKEND}/api/token-metrics?mint=${encodeURIComponent(mint)}`,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
