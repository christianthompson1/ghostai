import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, Copy, Check, Send, QrCode, Wallet, Sparkles, Trash2, KeyRound, X, Link2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { apiGet, apiPost } from "@/lib/api";

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
  const [walletDraft, setWalletDraft] = useState("");
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
    setWalletDraft(stored);
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
          <div className="flex gap-2 flex-wrap">
            <input
              value={walletDraft}
              onChange={(e) => setWalletDraft(e.target.value)}
              placeholder="Paste your Phantom / Backpack / Solflare public key"
              className="glass-input flex-1 min-w-[240px] font-mono text-xs"
            />
            <button onClick={saveWallet} className="btn-primary text-sm">Link</button>
          </div>
          {wallet ? (
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => copy(wallet, "wallet")} className="pill pill-sky font-mono text-[10px]">
                {copied === "wallet" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {wallet.slice(0, 6)}…{wallet.slice(-6)}
              </button>
              <button onClick={() => setReceiveOpen(true)} className="btn-glass text-sm"><QrCode className="h-4 w-4" /> Receive</button>
              <button onClick={() => setSendOpen(true)} className="btn-glass text-sm"><Send className="h-4 w-4" /> Send</button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Link a wallet to enable send, receive and the ATA rent cleaner.</p>
          )}
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
          onResult={(msg, ok) => { setNotice({ ok, msg }); setSendOpen(false); }}
        />
      ) : null}
    </div>
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
