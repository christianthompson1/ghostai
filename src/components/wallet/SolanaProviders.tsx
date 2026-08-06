import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";

/**
 * Solana wallet context for the whole app.
 * Phantom and Solflare are registered explicitly; Backpack and any other
 * Wallet-Standard wallet (including Web3Auth-injected providers) are
 * auto-detected by the adapter at runtime.
 */
export function SolanaProviders({ children }: { children: ReactNode }) {
  const endpoint =
    (import.meta.env.VITE_HELIUS_RPC_URL as string | undefined) ??
    "https://api.mainnet-beta.solana.com";

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    [],
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect onError={() => {}}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
