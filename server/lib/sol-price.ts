/**
 * SOL/USD price — cached with a 30-second TTL.
 *
 * Primary:  CoinGecko free API (no auth required)
 * Fallback: Jupiter price API (SOL → USDC quote)
 *
 * All callers receive the same cached value so we never hammer
 * the upstream even if /api/pumpfun/trending is polled aggressively.
 */

const CACHE_TTL_MS = 30_000; // 30 seconds

let cachedPrice: number = 0;      // 0 = not yet fetched
let cacheExpiresAt: number = 0;
let inflightFetch: Promise<number> | null = null;  // deduplication guard

/**
 * Return a live SOL/USD price.
 *
 * - Serves the in-memory cache while fresh (< 30 s old).
 * - Deduplicates concurrent stale-cache callers behind a single upstream fetch
 *   so we never fire more than one CoinGecko/Jupiter request at a time.
 * - Throws if no cached price exists and all upstream sources fail, so callers
 *   can surface a meaningful error rather than silently using stale/fake data.
 */
export async function getSolPrice(): Promise<number> {
  const now = Date.now();
  if (cachedPrice > 0 && now < cacheExpiresAt) return cachedPrice;

  // Deduplicate: if a fetch is already in-flight, wait for it
  if (inflightFetch) return inflightFetch;

  inflightFetch = Promise.any([fetchFromCoinGecko(), fetchFromJupiter()])
    .then((price) => {
      cachedPrice    = price;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return price;
    })
    .catch(() => {
      // Both sources failed — return last-known cached value if available,
      // otherwise throw so the endpoint can return a 503 instead of bad data.
      if (cachedPrice > 0) {
        console.warn("[SolPrice] Both upstreams failed; serving stale cached price");
        return cachedPrice;
      }
      throw new Error(
        "SOL/USD price unavailable: all upstream sources failed and no cached value exists"
      );
    })
    .finally(() => {
      inflightFetch = null;
    });

  return inflightFetch;
}

// ── upstream fetchers ─────────────────────────────────────────────────────────

async function fetchFromCoinGecko(): Promise<number> {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
    { signal: AbortSignal.timeout(5_000) }
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = (await res.json()) as { solana?: { usd?: number } };
  const price = data?.solana?.usd;
  if (!price || !Number.isFinite(price)) throw new Error("CoinGecko: bad price");
  return price;
}

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

async function fetchFromJupiter(): Promise<number> {
  // 1 SOL worth of lamports → USDC quote gives us the SOL/USD rate
  const url =
    `https://api.jup.ag/swap/v1/quote` +
    `?inputMint=${SOL_MINT}&outputMint=${USDC_MINT}` +
    `&amount=1000000000&slippageBps=50`; // 1 SOL = 1_000_000_000 lamports

  const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Jupiter ${res.status}`);
  const quote = (await res.json()) as { swapUsdValue?: string | number };
  const price = parseFloat(String(quote?.swapUsdValue ?? ""));
  if (!Number.isFinite(price) || price <= 0) throw new Error("Jupiter: bad price");
  return price; // swapUsdValue of 1 SOL input = SOL price in USD
}
