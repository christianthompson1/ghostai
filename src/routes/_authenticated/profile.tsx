import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, Copy, Check, Send, QrCode, Wallet, Sparkles, Trash2, KeyRound, X, Link2, RefreshCw, LogOut,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost } from "@/lib/api";
import type { WalletSnapshot } from "@/lib/solana-wallet-shared";

const loadWalletModule = () => import("@/lib/solana-wallet");

export const Route = createFileRoute("/_authenticated/profile")({
  ssr: false,
  component: ProfilePage,
  head: () => ({
    meta: [
      { title: "Wallet Hub & Profile — Ghost AI" },
      { name: "description", content: "Manage linked Solana wallets, send and receive assets, reclaim ATA rent and grab your Ghost AI developer key." },
      { property: "og:title", content: "Wallet Hub & Profile — Ghost AI" },
      { property: "og:description", content: "Linked wallets, QR receive, SOL/USDC send and an embedded ATA rent cleaner." },
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

function ProfilePage() {
  const [user, setUser] = useState<any>(null);
  const [wallet, setWallet] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<WalletSnapshot | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [scan, setScan] = useState<AtaScan | null>(null);
  const [scanning, setScanning] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null));
    const stored = window.localStorage.getItem(WALLET_KEY) ?? "";
    setWallet(stored);
    if (stored) void refreshSnapshot(stored);
  }, []);

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

  async function refreshSnapshot(address = wallet) {
    if (!address) return;
    setSnapshotLoading(true);
    try {
      const { loadWalletSnapshot } = await loadWalletModule();
      setSnapshot(await loadWalletSnapshot(address));
    } catch {
      setNotice({ ok: false, msg: "Live wallet data could not be loaded" });
    } finally {
      setSnapshotLoading(false);
    }
  }

  async function connect() {
    setWalletBusy(true);
    try {
      const { connectWallet } = await loadWalletModule();
      const address = await connectWallet();
      setWallet(address);
      window.localStorage.setItem(WALLET_KEY, address);
      setScan(null);
      setNotice({ ok: true, msg: "Wallet connected" });
      await refreshSnapshot(address);
    } catch (error) {
      setNotice({ ok: false, msg: error instanceof Error ? error.message : "Wallet connection was not completed" });
    } finally {
      setWalletBusy(false);
    }
  }

  async function disconnect() {
    setWalletBusy(true);
    try {
      const { disconnectWallet } = await loadWalletModule();
      await disconnectWallet();
    } finally {
      window.localStorage.removeItem(WALLET_KEY);
      setWallet("");
      setSnapshot(null);
      setScan(null);
      setWalletBusy(false);
      setNotice({ ok: true, msg: "Wallet disconnected" });
    }
  }

  async function copy(value: string, id: string) {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  }

  async function runScan() {
    if (!wallet) return;
    setScanning(true);
    const json = await apiGet<any>(`/api/v1/wallet/balance/${encodeURIComponent(wallet)}`);
    setScanning(false);
    if (!json) { setNotice({ ok: false, msg: "Wallet scanner is warming up — try again shortly" }); return; }
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

  return (
    <div className="min-h-screen w-full bg-[var(--background)] px-3 sm:px-6 py-4 sm:py-6">
      <div className="mx-auto max-w-4xl flex flex-col gap-4">
        <header className="glass rounded-2xl px-4 py-3 flex items-center gap-3">
          <Link to="/" className="btn-ghost !px-2" aria-label="Back to terminal"><ArrowLeft className="h-4 w-4" /></Link>
          <div className="min-w-0">
            <h1 className="font-bold text-lg truncate">Wallet Hub</h1>
            <p className="text-xs text-muted-foreground truncate">{user?.email ?? "Ghost AI account"}</p>
          </div>
        </header>

        {notice ? (
          <div className={`pill ${notice.ok ? "pill-ok" : "pill-danger"} w-full justify-center`}>{notice.msg}</div>
        ) : null}

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
          {wallet ? (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => copy(wallet, "wallet")} className="pill pill-ok font-mono text-[10px]">
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {copied === "wallet" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {wallet.slice(0, 6)}…{wallet.slice(-6)}
              </button>
              <button onClick={() => void refreshSnapshot()} disabled={snapshotLoading} className="btn-ghost text-sm" aria-label="Refresh wallet">
                <RefreshCw className={`h-4 w-4 ${snapshotLoading ? "animate-spin" : ""}`} /> Refresh
              </button>
              <button onClick={() => setReceiveOpen(true)} className="btn-glass text-sm"><QrCode className="h-4 w-4" /> Receive</button>
              <button onClick={() => setSendOpen(true)} className="btn-glass text-sm"><Send className="h-4 w-4" /> Send</button>
              <button onClick={() => void disconnect()} disabled={walletBusy} className="btn-ghost text-sm"><LogOut className="h-4 w-4" /> Disconnect</button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground flex-1 min-w-[220px]">Connect Phantom, Backpack or Solflare to use live balances and signed transfers.</p>
              <button onClick={() => void connect()} disabled={walletBusy} className="btn-primary text-sm">
                <Wallet className="h-4 w-4" /> {walletBusy ? "Connecting…" : "Connect wallet"}
              </button>
            </div>
          )}
        </section>

        {/* Live wallet data */}
        {wallet ? (
          <section className="glass rounded-2xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div><span className="font-semibold">Live wallet data</span><p className="text-xs text-muted-foreground">Confirmed on Solana RPC</p></div>
              <span className="pill pill-ok">Confirmed</span>
            </div>
            {snapshotLoading && !snapshot ? <div className="grid sm:grid-cols-3 gap-3"><div className="shimmer-glass h-20 rounded-xl" /><div className="shimmer-glass h-20 rounded-xl" /><div className="shimmer-glass h-20 rounded-xl" /></div> : snapshot ? (
              <>
                <div className="grid sm:grid-cols-3 gap-3">
                  <WalletMetric label="SOL balance" value={`${snapshot.sol.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`} />
                  <WalletMetric label="Token holdings" value={String(snapshot.tokens.length)} />
                  <WalletMetric label="Confirmed transactions" value={String(snapshot.transactions.length)} />
                </div>
                {snapshot.tokens.length ? <div className="flex flex-wrap gap-2">{snapshot.tokens.slice(0, 12).map((token) => <span key={token.mint} className="pill pill-sky font-mono">{token.symbol ?? `${token.mint.slice(0, 5)}…`} · {token.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })}</span>)}</div> : <p className="text-sm text-muted-foreground">No non-zero SPL token holdings found.</p>}
                <div className="border-t border-white/20 pt-3 flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Recent confirmed activity</span>
                  {snapshot.transactions.slice(0, 5).map((transaction) => <div key={transaction.signature} className="flex items-center justify-between gap-3 text-xs"><span className={`pill ${transaction.success ? "pill-ok" : "pill-danger"}`}>{transaction.success ? "Success" : "Failed"}</span><span className="font-mono truncate text-muted-foreground">{transaction.signature}</span><span className="shrink-0">{transaction.blockTime ? new Date(transaction.blockTime * 1000).toLocaleDateString() : "—"}</span></div>)}
                  {!snapshot.transactions.length ? <p className="text-sm text-muted-foreground">No confirmed transactions found.</p> : null}
                </div>
              </>
            ) : null}
          </section>
        ) : null}

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
          {scanning ? <div className="shimmer-glass h-16 rounded-xl" /> : null}
          {scan ? (
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
           onSend={async (to, asset, amount) => {
             const { sendSol, sendUsdc } = await loadWalletModule();
             return asset === "SOL" ? sendSol(wallet, to, amount) : sendUsdc(wallet, to, amount);
           }}
           onResult={(msg, ok) => { setNotice({ ok, msg }); setSendOpen(false); if (ok) void refreshSnapshot(); }}
        />
      ) : null}
    </div>
  );
}

function SendModal({ from, onClose, onSend, onResult }: { from: string; onClose: () => void; onSend: (to: string, asset: "SOL" | "USDC", amount: number) => Promise<string>; onResult: (msg: string, ok: boolean) => void }) {
  const [to, setTo] = useState("");
  const [asset, setAsset] = useState<"SOL" | "USDC">("SOL");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!to.trim() || !Number(amount)) { onResult("Enter a destination and amount", false); return; }
    setBusy(true);
    try {
      const signature = await onSend(to.trim(), asset, Number(amount));
      onResult(`Confirmed · ${signature.slice(0, 12)}…`, true);
    } catch (error) {
      onResult(error instanceof Error ? error.message : "Transfer was not completed", false);
    } finally {
      setBusy(false);
    }
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

function WalletMetric({ label, value }: { label: string; value: string }) {
  return <div className="glass-pill !rounded-xl px-3 py-2.5"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div><div className="font-bold tabular-nums">{value}</div></div>;
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
