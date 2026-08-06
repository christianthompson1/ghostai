/**
 * Single source of truth for the Ghost AI backend engine URL.
 * Every network call in the app resolves through `import.meta.env.VITE_BACKEND_URL`.
 */
const RAW =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:3001";

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

/**
 * Unified Ghost AI backend service layer.
 * Every method resolves to the parsed JSON body, or `null` when the backend is
 * unreachable / returns a non-2xx — callers render skeletons or empty states
 * instead of crashing.
 */
export const API = {
  // ── Markets & charts ───────────────────────────────────────────────────────
  getMarkets: () => apiGet<any>("/api/v1/markets"),
  searchMarkets: (q: string) => apiGet<any>(`/api/v1/markets/search?q=${encodeURIComponent(q)}`),
  getOhlcv: (symbol: string, timeframe = "1h", limit = 100) =>
    apiGet<any>(
      `/api/v1/charts/ohlcv?symbol=${encodeURIComponent(symbol)}&timeframe=${encodeURIComponent(timeframe)}&limit=${limit}`,
    ),
  getCandles: (token: string, timeframe = "1h") =>
    apiGet<any>(`/api/market/candles?token=${encodeURIComponent(token)}&timeframe=${encodeURIComponent(timeframe)}`),
  getPumpTrending: () => apiGet<any>("/api/pumpfun/trending"),

  // ── Users ──────────────────────────────────────────────────────────────────
  syncUser: (body: {
    walletAddress?: string;
    web3authId?: string;
    telegramId?: string;
    provider?: string;
  }) => apiPost<any>("/api/v1/users/sync", body),
  getUser: (idOrAddress: string) => apiGet<any>(`/api/v1/users/${encodeURIComponent(idOrAddress)}`),
  getUserEarnings: (idOrAddress: string) =>
    apiGet<any>(`/api/v1/users/${encodeURIComponent(idOrAddress)}/earnings`),

  // ── Wallet ─────────────────────────────────────────────────────────────────
  getBalance: (address: string) => apiGet<any>(`/api/v1/wallet/balance/${encodeURIComponent(address)}`),
  scanEmptyAtas: (wallet: string) =>
    apiGet<any>(`/api/v1/wallet/scan-empty-atas?wallet=${encodeURIComponent(wallet)}`, 30_000),
  closeAtas: (wallet: string, ataAddresses?: string[]) =>
    apiPost<any>("/api/v1/wallet/close-atas", { wallet, ataAddresses }, 30_000),

  // ── Task marketplace ───────────────────────────────────────────────────────
  listTasks: (params?: { status?: string; minPayout?: number; category?: string; limit?: number }) => {
    const entries = Object.entries(params ?? {}).filter(
      ([, v]) => v !== undefined && v !== null && v !== "",
    );
    const qs = new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
    return apiGet<any>(`/api/v1/tasks${qs ? `?${qs}` : ""}`);
  },
  getTask: (id: string) => apiGet<any>(`/api/v1/tasks/${encodeURIComponent(id)}`),
  submitProof: (body: { taskId: string; workerAddress: string; proofText: string }) =>
    apiPost<any>("/api/v1/worker/submit", body, 45_000),

  // ── Token intelligence ─────────────────────────────────────────────────────
  getTokenMetrics: (mint: string) => apiGet<any>(`/api/token-metrics?mint=${encodeURIComponent(mint)}`),
  decodeTransaction: (input: string) => apiPost<any>("/api/debug-transaction", { input }, 25_000),
};
