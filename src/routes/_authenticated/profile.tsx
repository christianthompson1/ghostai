import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import {
  ArrowLeft, Copy, Check, Send, QrCode, Wallet, Sparkles, Trash2, KeyRound, X, Link2,
  ArrowDownLeft, ArrowUpRight, Repeat,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost } from "@/lib/api";
import { fetchPricesForMints, loadState, START_CASH, type PaperState } from "@/lib/trade-store";
import { NavDock } from "@/components/nav/NavDock";

export const Route = createFileRoute("/_authenticated/profile")({
  ssr: false,
  component: ProfilePage,
  head: () => ({
    meta: [
      { title: "Profile & Wallet Hub — Ghost AI" },
      { name: "description", content: "Your Ghost AI profile: live portfolio value, linked Solana wallets, send and receive, ATA rent cleaner and developer key." },
      { property: "og:title", content: "Profile & Wallet Hub — Ghost AI" },
      { property: "og:description", content: "Live portfolio value, asset list with PnL, QR receive, SOL/USDC send and an ATA rent cleaner." },
      { property: "og:type", content: "profile" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const WALLET_KEY = "ghost.wallet.address";

type AtaScan = {
  emptyAccounts: number;
  reclaimableSol: number;
  accounts: Array<{ pubkey: string; mint?: string; rentSol?: number }>;
};

function usd(n: number, digits = 2) {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const max = abs > 0 && abs < 0.01 ? 8 : digits;
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: max })}`;
}

function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [wallet, setWallet] = useState("");
  const [walletDraft, setWalletDraft] = useState("");
  const [scan, setScan] = useState<AtaScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Portfolio (persisted paper desk) + live prices
  const [state, setState] = useState<PaperState | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [series, setSeries] = useState<Array<{ t: number; v: number }>>([]);
  const seriesRef = useRef<Array<{ t: number; v: number }>>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const stored = window.localStorage.getItem(WALLET_KEY) ?? "";
    setWallet(stored);
    setWalletDraft(stored);
    setState(loadState());
  }, []);

  const heldMints = useMemo(() => Object.keys(state?.positions ?? {}), [state]);

  useEffect(() => {
    if (!heldMints.length) return;
    let cancelled = false;
    async function tick() {
      const map = await fetchPricesForMints(heldMints);
      if (cancelled || !Object.keys(map).length) return;
      setPrices((p) => ({ ...p, ...map }));
    }
    tick();
    const id = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [heldMints.join(",")]);

  const assets = useMemo(() => {
    if (!state) return [];
    return Object.values(state.positions).map((p) => {
      const live = prices[p.mint] ?? p.avgCost;
      const value = live * p.amount;
      const cost = p.avgCost * p.amount;
      return { ...p, live, value, pnl: value - cost, pnlPct: cost ? ((value - cost) / cost) * 100 : 0 };
    }).sort((a, b) => b.value - a.value);
  }, [state, prices]);

  const positionsValue = assets.reduce((s, a) => s + a.value, 0);
  const equity = (state?.cash ?? 0) + positionsValue;
  const totalPnl = state ? equity - START_CASH : 0;
  const totalPnlPct = state ? (totalPnl / START_CASH) * 100 : 0;

  // Rolling equity curve sampled from live values (real data, no mocks).
  useEffect(() => {
    if (!state) return;
    const next = [...seriesRef.current, { t: Date.now(), v: equity }].slice(-60);
    seriesRef.current = next;
    setSeries(next);
  }, [equity, state]);

  const identities: Array<{ provider: string; label: string }> = useMemo(() => {
    const list = (user?.identities ?? []) as any[];
    const seen = new Set<string>();
    const out: Array<{ provider: string; label: string }> = [];
    for (const i of list) {
      const p = String(i.provider ?? "").toLowerCase();
      if (!p || seen.has(p)) continue;
      seen.add(p);
      out.push({
        provider: p,
        label: i.identity_data?.email ?? i.identity_data?.user_name ?? i.identity_data?.full_name ?? user?.email ?? p,
      });
    }
    if (!out.length && user?.email) out.push({ provider: "email", label: user.email });
    return out;
  }, [user]);

  const apiKey = user?.id ? `ghost_live_${String(user.id).replace(/-/g, "").slice(0, 28)}` : null;

  function saveWallet() {
    const v = walletDraft.trim();
    setWallet(v);
    window.localStorage.setItem(WALLET_KEY, v);
    setScan(null);
    setNotice({ ok: true, msg: v ? "Wallet linked" : "Wallet unlinked" });
  }

  async function copy(value: string, id: string) {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  }

  async function runScan() {
    if (!wallet) return;
    setScanning(true);
    setScan(null);
    const json = await apiGet<any>(`/api/v1/wallet/balance/${encodeURIComponent(wallet)}`);
    setScanning(false);
    if (!json) {
      // Graceful empty state instead of a red error block.
      setScan({ emptyAccounts: 0, reclaimableSol: 0, accounts: [] });
      return;
    }
    const accounts: any[] = json.emptyAccounts ?? json.accounts ?? json.atas ?? [];
    const list = Array.isArray(accounts) ? accounts : [];
    setScan({
      emptyAccounts: Number(json.emptyCount ?? list.length) || list.length,
      reclaimableSol: Number(json.reclaimableSol ?? json.rentSol ?? list.length * 0.00203928) || 0,
      accounts: list.map((a: any) => ({
        pubkey: String(a.pubkey ?? a.address ?? a),
        mint: a.mint,
        rentSol: Number(a.rentSol ?? 0.00203928),
      })),
    });
  }

  async function reclaim() {
    if (!wallet) return;
    setReclaiming(true);
    const res = await apiPost<any>("/api/v1/wallet/close-atas", {
      owner: wallet,
      accounts: scan?.accounts.map((a) => a.pubkey) ?? [],
    });
    setReclaiming(false);
    if (!res) { setNotice({ ok: false, msg: "Rent reclaim could not be submitted right now" }); return; }
    setNotice({ ok: true, msg: res.signature ? `Rent reclaimed · ${String(res.signature).slice(0, 12)}…` : "Rent reclaim submitted" });
    setScan(null);
  }

  const up = totalPnl >= 0;
  const stroke = up ? "oklch(0.62 0.18 150)" : "oklch(0.62 0.22 27)";

  return (
    <div className="min-h-screen w-full bg-[var(--background)] px-3 sm:px-6 py-4 sm:py-6 pb-28">
      <div className="mx-auto max-w-4xl flex flex-col gap-4">
        <header className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <Link to="/" className="btn-ghost !px-2" aria-label="Back to terminal"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0">
            <h1 className="font-bold text-lg truncate">Profile</h1>
            <p className="text-xs text-muted-foreground truncate">{user?.email ?? "Ghost AI account"}</p>
          </div>
        </header>

        {notice ? (
          <div className={`pill ${notice.ok ? "pill-ok" : "pill-danger"} w-full justify-center`}>{notice.msg}</div>
        ) : null}

        {/* Hero portfolio card */}
        <section className="glass rounded-3xl p-5 flex flex-col gap-4 overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Portfolio value</span>
              {state ? (
                <div className="text-3xl sm:text-4xl font-bold tabular-nums leading-tight">{usd(equity)}</div>
              ) : (
                <div className="shimmer-glass h-10 w-44 rounded-xl mt-1" />
              )}
              {state ? (
                <span className={`pill mt-2 ${up ? "pill-ok" : "pill-danger"}`}>
                  {up ? "▲" : "▼"} {usd(Math.abs(totalPnl))} · {totalPnlPct.toFixed(2)}%
                </span>
              ) : null}
            </div>
            {wallet ? (
              <button onClick={() => copy(wallet, "hero")} className="pill pill-sky font-mono text-[10px] shrink-0">
                {copied === "hero" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {wallet.slice(0, 4)}…{wallet.slice(-4)}
              </button>
            ) : null}
          </div>

          <div className="h-32 -mx-1">
            {series.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series}>
                  <defs>
                    <linearGradient id="ghostEquity" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={stroke} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Tooltip
                    contentStyle={{
                      background: "rgba(255,255,255,0.75)", backdropFilter: "blur(12px)",
                      border: "1px solid rgba(56,189,248,0.35)", borderRadius: 14, fontSize: 12,
                    }}
                    labelFormatter={() => ""}
                    formatter={(v: any) => [usd(Number(v)), "Equity"]}
                  />
                  <Area type="monotone" dataKey="v" stroke={stroke} strokeWidth={2.4} fill="url(#ghostEquity)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full grid place-items-center">
                <div className="shimmer-glass h-16 w-full rounded-2xl" />
              </div>
            )}
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-3 gap-2">
            <QuickAction icon={<ArrowDownLeft className="h-5 w-5" />} label="Receive" onClick={() => setReceiveOpen(true)} disabled={!wallet} />
            <QuickAction icon={<ArrowUpRight className="h-5 w-5" />} label="Send" onClick={() => setSendOpen(true)} disabled={!wallet} />
            <QuickActionLink icon={<Repeat className="h-5 w-5" />} label="Trade" to="/trade" />
          </div>
        </section>

        {/* Assets */}
        <section className="glass rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Assets</span>
            {state ? <span className="text-xs text-muted-foreground tabular-nums">Cash {usd(state.cash)}</span> : null}
          </div>
          {!state ? (
            <div className="flex flex-col gap-2">
              <div className="shimmer-glass h-14 rounded-2xl" />
              <div className="shimmer-glass h-14 rounded-2xl" />
            </div>
          ) : assets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No holdings yet — open a position on the trading desk to track it here.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {assets.map((a) => (
                <li key={a.mint} className="glass-pill !rounded-2xl px-3 py-2.5 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-3 min-w-0">
                    <span className="h-9 w-9 rounded-full grid place-items-center bg-[color:var(--sky)]/15 text-[color:var(--sky)] text-xs font-bold shrink-0">
                      {a.symbol.slice(0, 3)}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-sm truncate">{a.symbol}</span>
                      <span className="block text-[11px] text-muted-foreground tabular-nums truncate">
                        {a.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} @ {usd(a.live, 2)}
                      </span>
                    </span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-semibold tabular-nums">{usd(a.value)}</span>
                    <span className={`pill ${a.pnl >= 0 ? "pill-ok" : "pill-danger"}`}>
                      {a.pnl >= 0 ? "+" : "−"}{Math.abs(a.pnlPct).toFixed(2)}%
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Identities */}
        <section className="glass rounded-2xl p-4 flex flex-col gap-3">
          <span className="font-semibold">Connected accounts</span>
          <div className="flex flex-wrap gap-2">
            {identities.length === 0 ? (
              <div className="shimmer-glass h-9 w-40 rounded-full" />
            ) : identities.map((i) => (
              <span key={i.provider} className="pill pill-sky">
                <Link2 className="h-3 w-3" /> {i.provider} · {i.label}
              </span>
            ))}
          </div>
        </section>

        {/* Wallet */}
        <section className="glass rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2"><Wallet className="h-4 w-4 sky-text" /><span className="font-semibold">Solana wallet</span></div>
          <div className="flex gap-2 flex-wrap">
            <input
              value={walletDraft}
              onChange={(e) => setWalletDraft(e.target.value)}
              placeholder="Paste your Phantom / Backpack / Solflare public key"
              className="glass-input flex-1 min-w-[240px] font-mono text-xs"
            />
            <button onClick={saveWallet} className="btn-primary text-sm">Link</button>
          </div>
          {!wallet ? (
            <p className="text-sm text-muted-foreground">Link a wallet to enable send, receive and the ATA rent cleaner.</p>
          ) : null}
        </section>

        {/* ATA cleaner */}
        <section className="glass rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 sky-text" /><span className="font-semibold">ATA wallet cleaner</span></div>
          <p className="text-sm text-muted-foreground">
            Scans your wallet for zero-balance SPL token accounts and reclaims the locked SOL rent.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={runScan} disabled={!wallet || scanning} className="btn-glass text-sm disabled:opacity-50">
              {scanning ? "Scanning accounts…" : "Scan wallet"}
            </button>
            {scan && scan.emptyAccounts > 0 ? (
              <button onClick={reclaim} disabled={reclaiming} className="btn-primary text-sm disabled:opacity-50">
                <Trash2 className="h-4 w-4" /> {reclaiming ? "Reclaiming…" : `Reclaim ${scan.reclaimableSol.toFixed(5)} SOL`}
              </button>
            ) : null}
          </div>
          {scanning ? (
            <div className="flex flex-col gap-2">
              <div className="shimmer-glass h-14 rounded-2xl" />
              <span className="text-xs text-muted-foreground">Analysing ledger streams…</span>
            </div>
          ) : null}
          {scan && !scanning ? (
            scan.emptyAccounts === 0 ? (
              <p className="text-sm text-muted-foreground">No reclaimable empty token accounts found right now.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <div className="glass-pill !rounded-xl px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Empty accounts</div>
                  <div className="font-bold tabular-nums">{scan.emptyAccounts}</div>
                </div>
                <div className="glass-pill !rounded-xl px-3 py-2.5">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Reclaimable rent</div>
                  <div className="font-bold tabular-nums">{scan.reclaimableSol.toFixed(5)} SOL</div>
                </div>
              </div>
            )
          ) : null}
        </section>

        {/* Developer */}
        <section className="glass rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 sky-text" /><span className="font-semibold">Developer</span></div>
          <p className="text-sm text-muted-foreground">Use this key with the Ghost AI SDK to post agent tasks and query market intelligence.</p>
          {apiKey ? (
            <button onClick={() => copy(apiKey, "key")} className="glass-input w-full font-mono text-xs flex items-center justify-between gap-2">
              <span className="truncate">{apiKey}</span>
              {copied === "key" ? <Check className="h-4 w-4 shrink-0" /> : <Copy className="h-4 w-4 shrink-0 opacity-60" />}
            </button>
          ) : <div className="shimmer-glass h-11 rounded-xl" />}
        </section>
      </div>

      {receiveOpen ? (
        <Modal title="Receive" onClose={() => setReceiveOpen(false)}>
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-2xl bg-white p-3">
              <QRCodeSVG value={wallet} size={188} />
            </div>
            <p className="font-mono text-[11px] break-all text-center text-muted-foreground">{wallet}</p>
            <button onClick={() => copy(wallet, "modal")} className="btn-glass text-sm">
              {copied === "modal" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} Copy address
            </button>
          </div>
        </Modal>
      ) : null}

      {sendOpen ? (
        <SendModal
          from={wallet}
          onClose={() => setSendOpen(false)}
          onResult={(msg, ok) => { setNotice({ ok, msg }); setSendOpen(false); }}
        />
      ) : null}

      <NavDock />
    </div>
  );
}

function QuickAction({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="glass-pill !rounded-2xl py-3 flex flex-col items-center gap-1 text-xs font-semibold active:scale-95 transition disabled:opacity-45"
    >
      <span className="sky-text">{icon}</span>
      {label}
    </button>
  );
}

function QuickActionLink({ icon, label, to }: { icon: React.ReactNode; label: string; to: string }) {
  return (
    <Link
      to={to}
      className="glass-pill !rounded-2xl py-3 flex flex-col items-center gap-1 text-xs font-semibold active:scale-95 transition"
    >
      <span className="sky-text">{icon}</span>
      {label}
    </Link>
  );
}

function SendModal({ from, onClose, onResult }: { from: string; onClose: () => void; onResult: (msg: string, ok: boolean) => void }) {
  const [to, setTo] = useState("");
  const [asset, setAsset] = useState<"SOL" | "USDC">("SOL");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!to.trim() || !Number(amount)) { onResult("Enter a destination and amount", false); return; }
    setBusy(true);
    const res = await apiPost<any>("/api/v1/wallet/send", { from, to: to.trim(), asset, amount: Number(amount) });
    setBusy(false);
    onResult(res?.signature ? `Sent · ${String(res.signature).slice(0, 12)}…` : "Transfer request queued for wallet signature", !!res);
  }

  return (
    <Modal title="Send" onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {(["SOL", "USDC"] as const).map((a) => (
            <button key={a} onClick={() => setAsset(a)} className={`pill flex-1 justify-center ${asset === a ? "pill-sky" : ""}`}>{a}</button>
          ))}
        </div>
        <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Destination address" className="glass-input w-full font-mono text-xs" />
        <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder={`Amount in ${asset}`} className="glass-input w-full tabular-nums" />
        <button onClick={submit} disabled={busy} className="btn-primary justify-center disabled:opacity-50">
          <Send className="h-4 w-4" /> {busy ? "Submitting…" : `Send ${asset}`}
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button className="absolute inset-0 bg-black/20 backdrop-blur-md" aria-label="Close" onClick={onClose} />
      <div className="relative glass-strong rounded-3xl p-5 w-full max-w-sm flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{title}</span>
          <button onClick={onClose} className="btn-ghost !px-2"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export { QuickAction as _QuickAction };
