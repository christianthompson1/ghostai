import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { Wallet as WalletIcon, LogOut, Loader2, Check, Copy } from "lucide-react";
import { API } from "@/lib/api";

export function shortAddress(a?: string | null, n = 4) {
  if (!a) return "";
  return `${a.slice(0, n)}…${a.slice(-n)}`;
}

/**
 * Liquid-glass wallet connect control.
 * Connected → truncated address + live SOL balance, tap to copy, disconnect.
 * Disconnected → glass sheet listing every detected Solana wallet.
 */
export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { connection } = useConnection();
  const { publicKey, connected, connecting, disconnect, select, wallets, wallet } = useWallet();
  const [open, setOpen] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const address = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  // Sync the connected wallet with the Ghost AI backend.
  useEffect(() => {
    if (!address) return;
    API.syncUser({ walletAddress: address, provider: wallet?.adapter.name ?? "solana" });
  }, [address, wallet?.adapter.name]);

  // Live SOL balance.
  useEffect(() => {
    let cancelled = false;
    if (!address) { setBalance(null); return; }
    const read = async () => {
      try {
        const lamports = await connection.getBalance(new PublicKey(address));
        if (!cancelled) setBalance(lamports / LAMPORTS_PER_SOL);
      } catch {
        if (!cancelled) setBalance(null);
      }
    };
    read();
    const id = setInterval(read, 20_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [address, connection]);

  const copy = useCallback(() => {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }, [address]);

  if (connected && address) {
    return (
      <div className="glass-pill flex items-center gap-2 px-2.5 py-1.5">
        <span className="h-2 w-2 rounded-full bg-[color:var(--sky)] shadow-[0_0_8px_var(--sky)]" />
        <button onClick={copy} className="min-w-0 text-left" title="Copy address">
          <div className="font-mono text-xs font-semibold truncate">{shortAddress(address)}</div>
          {!compact ? (
            <div className="text-[10px] text-muted-foreground tabular-nums">
              {balance === null ? "—" : `${balance.toFixed(4)} SOL`}
            </div>
          ) : null}
        </button>
        {copied ? <Check className="h-3.5 w-3.5 sky-text" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
        <button onClick={() => disconnect()} aria-label="Disconnect wallet" className="text-muted-foreground hover:text-foreground transition">
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-primary w-full justify-center text-sm">
        {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <WalletIcon className="h-4 w-4" />}
        Connect Wallet
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center p-4"
          style={{ background: "color-mix(in oklab, var(--background) 45%, transparent)", backdropFilter: "blur(18px) saturate(160%)" }}
          onClick={() => setOpen(false)}
        >
          <div
            className="glass-strong w-full max-w-sm rounded-[26px] p-5 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-bold text-lg">Connect a wallet</h2>
            <p className="text-xs text-muted-foreground -mt-2">
              Phantom, Solflare, Backpack and any Wallet-Standard provider.
            </p>
            {wallets.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4">
                No Solana wallet detected in this browser. Install Phantom, Solflare or Backpack to continue.
              </div>
            ) : (
              wallets.map((w) => (
                <button
                  key={w.adapter.name}
                  onClick={() => { select(w.adapter.name); setOpen(false); }}
                  className="glass-pill flex items-center gap-3 px-3 py-3 text-left transition hover:scale-[1.02] active:scale-95"
                >
                  {w.adapter.icon ? (
                    <img src={w.adapter.icon} alt="" className="h-7 w-7 rounded-lg" />
                  ) : (
                    <WalletIcon className="h-7 w-7 sky-text" />
                  )}
                  <span className="font-semibold text-sm flex-1">{w.adapter.name}</span>
                  <span className="text-[10px] uppercase text-muted-foreground">{w.readyState}</span>
                </button>
              ))
            )}
            <button onClick={() => setOpen(false)} className="btn-ghost justify-center mt-1">Cancel</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
