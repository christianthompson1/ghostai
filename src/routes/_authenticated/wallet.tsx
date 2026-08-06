import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { VersionedTransaction, Transaction } from "@solana/web3.js";
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, YAxis, Line, LineChart,
} from "recharts";
import {
  ArrowLeft, Bell, Copy, Check, QrCode, Settings, Sparkles, ArrowDownToLine,
  ArrowUpRight, Repeat, PlusCircle, Layers, Shuffle, MoreHorizontal, Wand2,
  Trophy, RefreshCw,
} from "lucide-react";
import { API } from "@/lib/api";
import { fetchOhlcv, type OhlcvPoint } from "@/lib/ghost-backend";
import { WalletButton, shortAddress } from "@/components/wallet/WalletButton";
import { NavDock } from "@/components/nav/NavDock";

export const Route = createFileRoute("/_authenticated/wallet")({
  ssr: false,
  component: WalletPage,
  head: () => ({
    meta: [
      { title: "Wallet — GHOST PROTOCOL" },
      { name: "description", content: "Your Solana portfolio, live balances, ATA rent reclaimer and task earnings in one liquid-glass wallet." },
      { property: "og:title", content: "Wallet — GHOST PROTOCOL" },
      { property: "og:description", content: "Live Solana balances, portfolio chart, rent reclaim and earnings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

// ── Types ─────────────────────────────────────────────────────────────────────

type Balance = {
  solBalance: number;
  solUsd: number;
  usdcBalance: number;
  totalUsd: number;
  change24h: number;
  tokens: Array<{
    mint: string; symbol: string; name?: string; amount: number;
    usdValue: number; change24h: number; image?: string;
  }>;
};

const TIMEFRAMES = ["1D", "1W", "1M", "3M", "1Y", "ALL"] as const;
type TF = (typeof TIMEFRAMES)[number];
const TF_TO_OHLCV: Record<TF, string> = {
  "1D": "1D", "1W": "7D", "1M": "1M", "3M": "1M", "1Y": "1M", ALL: "1M",
};

// ── Page ──────────────────────────────────────────────────────────────────────

function WalletPage() {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const address = publicKey?.toBase58() ?? null;

  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const loadBalance = useCallback(async () => {
    if (!address) { setBalance(null); return; }
    setLoading(true);
    const json = await API.getBalance(address);
    setBalance(json ? coerceBalance(json) : null);
    setLoading(false);
  }, [address]);

  useEffect(() => { loadBalance(); }, [loadBalance]);
  useEffect(() => {
    if (!address) return;
    const id = setInterval(loadBalance, 30_000);
    return () => clearInterval(id);
  }, [address, loadBalance]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function copy() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="relative min-h-screen w-full overflow-x-hidden bg-[var(--background)] pb-32">
      <AuroraBackdrop />

      <div className="relative mx-auto w-full max-w-6xl px-3 sm:px-6 pt-4 sm:pt-6 flex flex-col gap-4">
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="glass-strong rounded-[24px] px-3 py-2.5 flex items-center gap-2 sm:gap-3">
          <Link to="/" className="btn-ghost !px-2 shrink-0" aria-label="Back to terminal">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="h-10 w-10 shrink-0 rounded-full grid place-items-center text-sm font-bold"
            style={{
              background: "radial-gradient(70% 70% at 30% 25%, color-mix(in oklab, var(--sky) 45%, transparent), transparent 70%), color-mix(in oklab, var(--sky) 14%, transparent)",
              border: "1px solid color-mix(in oklab, var(--sky) 35%, transparent)",
            }}>
            {address ? address.slice(0, 2).toUpperCase() : "G"}
          </div>

          {connected && address ? (
            <button onClick={copy} className="glass-pill px-3 py-1.5 flex items-center gap-2 min-w-0 transition active:scale-95">
              <span className="font-mono text-xs font-semibold truncate">{shortAddress(address, 5)}</span>
              {copied ? <Check className="h-3.5 w-3.5 sky-text" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
          ) : (
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold truncate">GHOST PROTOCOL</div>
              <div className="text-[11px] text-muted-foreground truncate">Connect a wallet to begin</div>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <GlassIconButton label="Show QR code" onClick={() => setShowQr(true)} disabled={!address}>
              <QrCode className="h-4 w-4" />
            </GlassIconButton>
            <GlassIconButton label="Notifications">
              <span className="relative">
                <Bell className="h-4 w-4" />
                <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-[color:var(--sky)] shadow-[0_0_6px_var(--sky)]" />
              </span>
            </GlassIconButton>
            <Link to="/profile" className="hidden sm:block">
              <GlassIconButton label="Wallet settings"><Settings className="h-4 w-4" /></GlassIconButton>
            </Link>
          </div>
        </header>

        {toast ? (
          <div className={`pill ${toast.ok ? "pill-ok" : "pill-danger"} w-full justify-center py-2`}>{toast.msg}</div>
        ) : null}

        {!connected ? (
          <ConnectGate />
        ) : (
          <>
            {/* ── Balance + chart ───────────────────────────────────────────── */}
            <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <BalanceCard balance={balance} loading={loading && !balance} onRefresh={loadBalance} />
              <PortfolioChartCard totalUsd={balance?.totalUsd ?? 0} solBalance={balance?.solBalance ?? 0} />
            </section>

            <ActionGrid />

            <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <AssetList balance={balance} loading={loading && !balance} />
              <div className="flex flex-col gap-4">
                <AtaCleanerCard
                  address={address!}
                  onToast={setToast}
                  onDone={loadBalance}
                  sign={async (b64: string) => {
                    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
                    let tx: VersionedTransaction | Transaction;
                    try { tx = VersionedTransaction.deserialize(raw); }
                    catch { tx = Transaction.from(raw); }
                    return sendTransaction(tx as any, connection);
                  }}
                />
                <EarningsCard address={address!} />
              </div>
            </section>
          </>
        )}
      </div>

      {showQr && address ? <QrModal address={address} onClose={() => setShowQr(false)} /> : null}
      <NavDock />
    </div>
  );
}

// ── Shared bits ───────────────────────────────────────────────────────────────

function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -top-32 -left-24 h-[420px] w-[420px] rounded-full blur-3xl opacity-60 float-slow"
        style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--sky) 40%, transparent), transparent 70%)" }} />
      <div className="absolute top-1/3 -right-32 h-[480px] w-[480px] rounded-full blur-3xl opacity-50 float-slower"
        style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--sky) 28%, transparent), transparent 70%)" }} />
      <div className="absolute bottom-0 left-1/4 h-[360px] w-[360px] rounded-full blur-3xl opacity-40 float-slow"
        style={{ background: "radial-gradient(circle, oklch(0.85 0.12 200 / 0.5), transparent 70%)" }} />
    </div>
  );
}

function GlassIconButton({
  children, label, onClick, disabled,
}: { children: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="glass-pill h-9 w-9 grid place-items-center transition duration-200 hover:scale-105 active:scale-90 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function ConnectGate() {
  return (
    <div className="glass-strong rounded-[28px] p-10 flex flex-col items-center text-center gap-4">
      <div className="h-16 w-16 rounded-3xl grid place-items-center"
        style={{ background: "color-mix(in oklab, var(--sky) 16%, transparent)", border: "1px solid color-mix(in oklab, var(--sky) 32%, transparent)" }}>
        <Sparkles className="h-7 w-7 sky-text" />
      </div>
      <div>
        <h1 className="text-xl font-bold">Connect your Solana wallet</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          Phantom, Solflare, Backpack or any Wallet-Standard provider. Balances, rent reclaim and
          earnings all stream live from the Ghost engine.
        </p>
      </div>
      <div className="w-full max-w-xs"><WalletButton /></div>
    </div>
  );
}

/** Smooth spring-ish count-up for currency values. */
function useCountUp(value: number, duration = 900) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    const delta = value - from;
    if (Math.abs(delta) < 1e-9) { setDisplay(value); return; }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(from + delta * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
}

function usd(n: number, max = 2) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: max });
}

function coerceBalance(json: any): Balance {
  const tokensRaw: any[] = json.tokens ?? json.splTokens ?? json.assets ?? [];
  const tokens = tokensRaw
    .filter((t) => t?.mint ?? t?.address)
    .map((t) => ({
      mint: String(t.mint ?? t.address),
      symbol: String(t.symbol ?? "").toUpperCase() || "TOKEN",
      name: t.name,
      amount: Number(t.amount ?? t.uiAmount ?? t.balance) || 0,
      usdValue: Number(t.usdValue ?? t.valueUsd ?? t.usd) || 0,
      change24h: Number(t.change24h ?? t.priceChange24h) || 0,
      image: t.image ?? t.imageUrl ?? t.logoURI,
    }));
  const solBalance = Number(json.solBalance ?? json.sol ?? json.balance) || 0;
  const solUsd = Number(json.solUsd ?? json.solValueUsd) || 0;
  const usdcBalance = Number(json.usdcBalance ?? json.usdc) || 0;
  const totalUsd =
    Number(json.totalUsd ?? json.totalValueUsd) ||
    solUsd + usdcBalance + tokens.reduce((s, t) => s + t.usdValue, 0);
  return {
    solBalance,
    solUsd,
    usdcBalance,
    totalUsd,
    change24h: Number(json.change24h ?? json.pnl24hPercent) || 0,
    tokens,
  };
}

// ── 1. Balance card ───────────────────────────────────────────────────────────

function BalanceCard({
  balance, loading, onRefresh,
}: { balance: Balance | null; loading: boolean; onRefresh: () => void }) {
  const total = balance?.totalUsd ?? 0;
  const animated = useCountUp(total);
  const changePct = balance?.change24h ?? 0;
  const changeUsd = (total * changePct) / 100;
  const up = changePct >= 0;

  return (
    <div className="glass-strong rounded-[28px] p-6 flex flex-col gap-4 relative overflow-hidden">
      <div aria-hidden className="absolute -top-24 -right-16 h-56 w-56 rounded-full blur-3xl opacity-50"
        style={{ background: "radial-gradient(circle, color-mix(in oklab, var(--sky) 45%, transparent), transparent 70%)" }} />
      <div className="flex items-center justify-between relative">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Portfolio Value</span>
        <button onClick={onRefresh} className="btn-ghost !px-2" aria-label="Refresh balances">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading ? (
        <div className="shimmer-glass h-14 w-2/3 rounded-2xl" />
      ) : (
        <div className="text-[42px] sm:text-5xl font-bold tabular-nums leading-none tracking-tight relative">
          ${usd(animated)}
        </div>
      )}

      <div className="flex items-center gap-2 relative">
        <span className={`pill ${up ? "pill-ok" : "pill-danger"}`}>
          {up ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
        </span>
        <span className={`text-sm font-semibold tabular-nums ${up ? "text-[color:oklch(0.55_0.18_150)]" : "text-[color:var(--destructive)]"}`}>
          {up ? "+" : "−"}${usd(Math.abs(changeUsd))}
        </span>
        <span className="text-xs text-muted-foreground">today</span>
      </div>

      <div className="grid grid-cols-2 gap-2 relative">
        <MiniStat label="SOL" value={loading ? "—" : `${(balance?.solBalance ?? 0).toFixed(4)}`} sub={`$${usd(balance?.solUsd ?? 0)}`} />
        <MiniStat label="USDC" value={loading ? "—" : usd(balance?.usdcBalance ?? 0)} sub="Stable" />
      </div>
    </div>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass-pill px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-bold tabular-nums">{value}</div>
      <div className="text-[11px] text-muted-foreground tabular-nums">{sub}</div>
    </div>
  );
}

// ── 2. Portfolio chart ────────────────────────────────────────────────────────

function PortfolioChartCard({ totalUsd, solBalance }: { totalUsd: number; solBalance: number }) {
  const [tf, setTf] = useState<TF>("1M");
  const [points, setPoints] = useState<OhlcvPoint[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPoints(null);
    fetchOhlcv("SOL", TF_TO_OHLCV[tf]).then((pts) => { if (!cancelled) setPoints(pts); });
    return () => { cancelled = true; };
  }, [tf]);

  // Portfolio value curve: SOL price series scaled by holdings, plus the
  // non-SOL remainder of the portfolio held flat.
  const series = useMemo(() => {
    if (!points?.length) return [];
    const last = points[points.length - 1].c;
    const solValueNow = solBalance * last;
    const rest = Math.max(0, totalUsd - solValueNow);
    return points.map((p) => ({ t: p.t, v: solBalance * p.c + rest }));
  }, [points, solBalance, totalUsd]);

  const up = series.length > 1 ? series[series.length - 1].v >= series[0].v : true;
  const color = up ? "oklch(0.7 0.17 160)" : "oklch(0.65 0.2 25)";

  return (
    <div className="glass-strong rounded-[28px] p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Performance</span>
        <span className="text-[11px] text-muted-foreground">SOL-weighted</span>
      </div>

      <div className="h-52 w-full">
        {points === null ? (
          <div className="shimmer-glass h-full w-full rounded-2xl" />
        ) : series.length === 0 ? (
          <div className="h-full grid place-items-center text-xs text-muted-foreground text-center px-6">
            No historical series available from the engine yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="ghost-portfolio" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={["auto", "auto"]} hide />
              <Tooltip content={<PortfolioTooltip />} />
              <Area
                type="monotone" dataKey="v" stroke={color} strokeWidth={2.5}
                fill="url(#ghost-portfolio)" dot={false}
                style={{ filter: `drop-shadow(0 0 8px ${color})` }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="glass-pill p-1 flex items-center gap-1 self-center">
        {TIMEFRAMES.map((t) => (
          <button
            key={t}
            onClick={() => setTf(t)}
            className={`px-3 py-1.5 text-[11px] font-semibold rounded-full transition duration-200 active:scale-90 ${
              t === tf
                ? "bg-[color:var(--sky)] text-white shadow-[0_0_16px_-2px_var(--sky)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}

function PortfolioTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="glass px-3 py-2 text-[11px] tabular-nums shadow-lg">
      <div className="text-muted-foreground">{new Date(p.t).toLocaleString()}</div>
      <div className="font-bold">${usd(p.v)}</div>
    </div>
  );
}

// ── 3. Action grid ────────────────────────────────────────────────────────────

const ACTIONS = [
  { label: "Buy", Icon: PlusCircle, to: "/trade" },
  { label: "Send", Icon: ArrowUpRight, to: "/profile" },
  { label: "Receive", Icon: ArrowDownToLine, to: "/profile" },
  { label: "Swap", Icon: Repeat, to: "/trade" },
  { label: "Deposit", Icon: ArrowDownToLine, to: "/profile" },
  { label: "Stake", Icon: Layers, to: "/trade" },
  { label: "Bridge", Icon: Shuffle, to: "/trade" },
  { label: "More", Icon: MoreHorizontal, to: "/profile" },
] as const;

function ActionGrid() {
  return (
    <section className="glass rounded-[28px] p-4">
      <div className="grid grid-cols-4 sm:grid-cols-8 gap-3">
        {ACTIONS.map(({ label, Icon, to }) => (
          <Link key={label} to={to} className="group flex flex-col items-center gap-2">
            <span className="ripple h-14 w-14 rounded-2xl grid place-items-center transition duration-300 group-hover:-translate-y-1 group-active:scale-90 glass-pill group-hover:shadow-[0_0_22px_-4px_var(--sky)]">
              <Icon className="h-5 w-5 sky-text" />
            </span>
            <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground transition">{label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ── 4. Asset list ─────────────────────────────────────────────────────────────

function AssetList({ balance, loading }: { balance: Balance | null; loading: boolean }) {
  const assets = useMemo(() => {
    if (!balance) return [];
    const base = [
      balance.solBalance > 0
        ? { mint: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Solana", amount: balance.solBalance, usdValue: balance.solUsd, change24h: balance.change24h, image: undefined as string | undefined }
        : null,
      balance.usdcBalance > 0
        ? { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin", amount: balance.usdcBalance, usdValue: balance.usdcBalance, change24h: 0, image: undefined as string | undefined }
        : null,
    ].filter(Boolean) as Balance["tokens"];
    return [...base, ...balance.tokens].sort((a, b) => b.usdValue - a.usdValue);
  }, [balance]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="font-bold text-lg">Assets</h2>
        <span className="text-xs text-muted-foreground">{assets.length} holdings</span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="shimmer-glass h-[74px] rounded-[22px]" />)}
        </div>
      ) : assets.length === 0 ? (
        <div className="glass rounded-[24px] p-8 text-center text-sm text-muted-foreground">
          No tokens found for this wallet yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {assets.map((a) => <AssetRow key={a.mint} asset={a} />)}
        </div>
      )}
    </section>
  );
}

function AssetRow({ asset }: { asset: Balance["tokens"][number] }) {
  const [spark, setSpark] = useState<Array<{ t: number; c: number }> | null>(null);
  const up = asset.change24h >= 0;
  const color = up ? "oklch(0.7 0.17 160)" : "oklch(0.65 0.2 25)";

  useEffect(() => {
    let cancelled = false;
    fetchOhlcv(asset.symbol || asset.mint, "1D").then((pts) => {
      if (!cancelled) setSpark(pts.map((p) => ({ t: p.t, c: p.c })));
    });
    return () => { cancelled = true; };
  }, [asset.mint, asset.symbol]);

  return (
    <article className="glass rounded-[22px] px-4 py-3 flex items-center gap-3 transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_0_28px_-10px_var(--sky)]">
      {asset.image ? (
        <img src={asset.image} alt="" className="h-10 w-10 rounded-full ring-1 ring-white/40" loading="lazy" />
      ) : (
        <div className="h-10 w-10 rounded-full glass-pill grid place-items-center text-[11px] font-bold">
          {asset.symbol.slice(0, 3)}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm truncate">{asset.name || asset.symbol}</div>
        <div className="text-[11px] text-muted-foreground tabular-nums truncate">
          {asset.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {asset.symbol}
        </div>
      </div>

      <div className="h-9 w-16 shrink-0 hidden sm:block">
        {spark && spark.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={spark}>
              <Line type="monotone" dataKey="c" stroke={color} strokeWidth={1.75} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : null}
      </div>

      <div className="text-right shrink-0">
        <div className="font-bold tabular-nums text-sm">${usd(asset.usdValue)}</div>
        <div className={`text-[11px] font-semibold tabular-nums ${up ? "text-[color:oklch(0.55_0.18_150)]" : "text-[color:var(--destructive)]"}`}>
          {up ? "+" : "−"}{Math.abs(asset.change24h).toFixed(2)}%
        </div>
      </div>
    </article>
  );
}

// ── 5. ATA cleaner ────────────────────────────────────────────────────────────

function AtaCleanerCard({
  address, onToast, onDone, sign,
}: {
  address: string;
  onToast: (t: { ok: boolean; msg: string }) => void;
  onDone: () => void;
  sign: (b64: string) => Promise<string>;
}) {
  const [scan, setScan] = useState<{ count: number; rent: number; atas: string[] } | null>(null);
  const [busy, setBusy] = useState<"scan" | "clean" | null>(null);

  async function doScan() {
    setBusy("scan");
    const json = await API.scanEmptyAtas(address);
    setBusy(null);
    if (!json) { onToast({ ok: false, msg: "Could not reach the rent scanner." }); return; }
    const atas: string[] = json.atas ?? json.emptyAtas ?? json.accounts ?? [];
    setScan({
      count: Number(json.emptyAtaCount ?? json.count ?? atas.length) || 0,
      rent: Number(json.reclaimableRentSol ?? json.rentSol ?? 0) || 0,
      atas: atas.map((a: any) => (typeof a === "string" ? a : a?.pubkey ?? a?.address)).filter(Boolean),
    });
  }

  async function doClean() {
    if (!scan?.count) return;
    setBusy("clean");
    const json = await API.closeAtas(address, scan.atas.length ? scan.atas : undefined);
    if (!json) { setBusy(null); onToast({ ok: false, msg: "Rent reclaim failed to build." }); return; }
    const b64 = json.transaction ?? json.tx ?? json.serializedTransaction;
    if (!b64) { setBusy(null); onToast({ ok: false, msg: json.error ?? "No transaction returned." }); return; }
    try {
      const sig = await sign(b64);
      onToast({ ok: true, msg: `Rent reclaimed · ${sig.slice(0, 8)}…` });
      setScan(null);
      onDone();
    } catch (e: any) {
      onToast({ ok: false, msg: e?.message ?? "Transaction rejected." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="glass-strong rounded-[26px] p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl glass-pill grid place-items-center">
          <Wand2 className="h-5 w-5 sky-text" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold">ATA Cleaner</h3>
          <p className="text-[11px] text-muted-foreground">Reclaim locked rent from empty token accounts</p>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Empty accounts" value={scan ? String(scan.count) : "—"} sub="detected" />
        <MiniStat label="Reclaimable" value={scan ? scan.rent.toFixed(5) : "—"} sub="SOL" />
      </div>

      <div className="flex flex-col gap-2">
        <button onClick={doScan} disabled={busy !== null} className="btn-ghost justify-center">
          {busy === "scan" ? <span className="spinner" /> : <RefreshCw className="h-4 w-4" />} Scan Empty Accounts
        </button>
        <button onClick={doClean} disabled={busy !== null || !scan?.count} className="btn-primary justify-center">
          {busy === "clean" ? <span className="spinner" /> : <Sparkles className="h-4 w-4" />} Clean &amp; Reclaim SOL
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground text-center">You keep 90% · 10% platform fee</p>
    </div>
  );
}

// ── 6. Earnings ───────────────────────────────────────────────────────────────

function EarningsCard({ address }: { address: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    API.getUserEarnings(address).then((json) => {
      if (cancelled) return;
      setData(json);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [address]);

  const submissions: any[] = data?.submissions ?? data?.recent ?? data?.approvedSubmissions ?? [];

  return (
    <div className="glass-strong rounded-[26px] p-5 flex flex-col gap-4">
      <header className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl glass-pill grid place-items-center">
          <Trophy className="h-5 w-5 sky-text" />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold">Earnings</h3>
          <p className="text-[11px] text-muted-foreground">Verified task rewards</p>
        </div>
      </header>

      {loading ? (
        <div className="shimmer-glass h-20 rounded-2xl" />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <MiniStat label="Reputation" value={String(data?.reputationScore ?? 0)} sub="score" />
            <MiniStat label="Tasks" value={String(data?.tasksCompleted ?? 0)} sub="completed" />
            <MiniStat label="Earned" value={usd(Number(data?.totalEarnedUsdc ?? 0))} sub="USDC" />
          </div>

          {submissions.length ? (
            <div className="flex flex-col gap-1.5">
              {submissions.slice(0, 5).map((s: any, i: number) => (
                <div key={s.id ?? i} className="glass-pill px-3 py-2 flex items-center gap-2">
                  <span className="text-xs font-medium truncate flex-1">{s.taskTitle ?? s.title ?? s.taskId ?? "Submission"}</span>
                  <span className="pill pill-ok text-[10px]">+{usd(Number(s.payoutUsdc ?? s.rewardUsdc ?? 0))}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">
              No approved submissions yet — complete a task to start earning.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── QR modal ──────────────────────────────────────────────────────────────────

function QrModal({ address, onClose }: { address: string; onClose: () => void }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(address)}`;
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4"
      style={{ background: "color-mix(in oklab, var(--background) 45%, transparent)", backdropFilter: "blur(18px) saturate(160%)" }}
      onClick={onClose}
    >
      <div className="glass-strong w-full max-w-xs rounded-[28px] p-6 flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold">Receive on Solana</h2>
        <img src={src} alt="Wallet address QR code" className="h-56 w-56 rounded-2xl bg-white p-2" />
        <p className="font-mono text-[11px] break-all text-center text-muted-foreground">{address}</p>
        <button onClick={() => navigator.clipboard.writeText(address)} className="btn-primary w-full justify-center">
          <Copy className="h-4 w-4" /> Copy address
        </button>
        <button onClick={onClose} className="btn-ghost w-full justify-center">Close</button>
      </div>
    </div>
  );
}
