/**
 * Single source of truth for the Ghost AI backend engine URL.
 * Every network call in the app resolves through `import.meta.env.VITE_BACKEND_URL`.
 */
const RAW =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "https://53f91562-532a-4457-b69f-e770ae7cc385-00-1odxz0gc2gyuo.janeway.replit.dev";

/** Absolute backend origin, never with a trailing slash. */
export const BACKEND_URL = RAW.replace(/\/+$/, "");

export function backendUrl(path: string): string {
  return `${BACKEND_URL}/${path.replace(/^\/+/, "")}`;
}

/** GET JSON with a hard timeout — resolves to `null` instead of throwing. */
export async function apiGet<T = any>(path: string, timeoutMs = 12_000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(backendUrl(path), {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON with a hard timeout — resolves to `null` instead of throwing. */
export async function apiPost<T = any>(path: string, body: unknown, timeoutMs = 15_000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(backendUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) return null;
    return json as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
