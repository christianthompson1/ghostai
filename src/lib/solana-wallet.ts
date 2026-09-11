import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
  type ParsedAccountData,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
  getMint,
} from "@solana/spl-token";
import { TOP_SOLANA_TOKENS } from "@/lib/market-data";
import {
  USDC_MINT,
  type RpcMarketQuote,
  type RpcOrderBook,
  type WalletSnapshot,
  type WalletToken,
  type WalletTransaction,
} from "@/lib/solana-wallet-shared";

const RPC_URL = (import.meta.env.VITE_SOLANA_RPC_URL as string | undefined) || "https://api.mainnet-beta.solana.com";
const JUPITER = "https://lite-api.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

export type WalletProvider = {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toString(): string } }>;
  disconnect?: () => Promise<void>;
  signTransaction?: (transaction: Transaction | VersionedTransaction) => Promise<Transaction | VersionedTransaction>;
  signAndSendTransaction?: (transaction: Transaction | VersionedTransaction) => Promise<{ signature: string }>;
};

export type JupiterQuote = {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct?: string;
  routePlan?: Array<{ swapInfo?: { label?: string; ammKey?: string }; percent?: number }>;
};

function provider(): WalletProvider | null {
  if (typeof window === "undefined") return null;
  const browser = window as Window & {
    solana?: WalletProvider;
    phantom?: { solana?: WalletProvider };
    backpack?: WalletProvider;
    solflare?: WalletProvider;
  };
  return browser.phantom?.solana ?? browser.backpack ?? browser.solflare ?? browser.solana ?? null;
}

export function solanaConnection(): Connection {
  return new Connection(RPC_URL, "confirmed");
}

export function walletProviderAvailable(): boolean {
  return provider() !== null;
}

export async function connectWallet(): Promise<string> {
  const wallet = provider();
  if (!wallet) throw new Error("Install Phantom, Backpack, or another Solana wallet to continue.");
  const response = await wallet.connect();
  const address = response.publicKey?.toString() || wallet.publicKey?.toString();
  if (!address) throw new Error("The wallet did not return a public address.");
  return address;
}

export async function disconnectWallet(): Promise<void> {
  await provider()?.disconnect?.();
}

function parsedTokenAmount(account: unknown): { amount: string; decimals: number } | null {
  const data = (account as { account?: { data?: ParsedAccountData } })?.account?.data;
  if (!data || typeof data !== "object" || !("parsed" in data)) return null;
  const parsed = data.parsed as { info?: { tokenAmount?: { amount?: string; decimals?: number } } };
  const tokenAmount = parsed.info?.tokenAmount;
  if (!tokenAmount?.amount || typeof tokenAmount.decimals !== "number") return null;
  return { amount: tokenAmount.amount, decimals: tokenAmount.decimals };
}

async function readTransactions(connection: Connection, owner: PublicKey): Promise<WalletTransaction[]> {
  const signatures = await connection.getSignaturesForAddress(owner, { limit: 20 });
  if (!signatures.length) return [];
  const parsed = await connection.getParsedTransactions(signatures.map((item) => item.signature), {
    maxSupportedTransactionVersion: 0,
  });
  return signatures.map((item, index) => {
    const transaction = parsed[index] as ParsedTransactionWithMeta | null;
    const programIds = transaction?.transaction.message.instructions
      .map((instruction) => "programId" in instruction ? instruction.programId.toString() : "unknown")
      .filter((value, position, all) => all.indexOf(value) === position)
      .slice(0, 5) ?? [];
    return {
      signature: item.signature,
      slot: item.slot,
      blockTime: item.blockTime ?? null,
      success: !item.err,
      feeSol: (transaction?.meta?.fee ?? 0) / LAMPORTS_PER_SOL,
      programIds,
    };
  });
}

export async function loadWalletSnapshot(address: string): Promise<WalletSnapshot> {
  const connection = solanaConnection();
  const owner = new PublicKey(address);
  const [lamports, tokenAccounts, transactions] = await Promise.all([
    connection.getBalance(owner, "confirmed"),
    connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed"),
    readTransactions(connection, owner),
  ]);

  const tokens = tokenAccounts.value.map((account): WalletToken | null => {
    const parsed = parsedTokenAmount(account);
    const info = (account.account.data as ParsedAccountData).parsed?.info as { mint?: string } | undefined;
    if (!parsed || !info?.mint || parsed.amount === "0") return null;
    const metadata = TOP_SOLANA_TOKENS.find((token) => token.mint === info.mint);
    return {
      mint: info.mint,
      amount: Number(parsed.amount) / 10 ** parsed.decimals,
      rawAmount: parsed.amount,
      decimals: parsed.decimals,
      symbol: metadata?.symbol,
      name: metadata?.name,
    } satisfies WalletToken;
  }).filter((token): token is WalletToken => token !== null);

  return { address, sol: lamports / LAMPORTS_PER_SOL, tokens, transactions };
}

async function signAndSend(transaction: Transaction | VersionedTransaction): Promise<string> {
  const wallet = provider();
  if (!wallet?.signAndSendTransaction) throw new Error("This wallet cannot sign transactions in the browser.");
  const result = await wallet.signAndSendTransaction(transaction);
  const signature = result.signature;
  await solanaConnection().confirmTransaction(signature, "confirmed");
  return signature;
}

export async function sendSol(address: string, destination: string, amount: number): Promise<string> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid SOL amount.");
  const connection = solanaConnection();
  const transaction = new Transaction().add(SystemProgram.transfer({
    fromPubkey: new PublicKey(address),
    toPubkey: new PublicKey(destination),
    lamports: Math.round(amount * LAMPORTS_PER_SOL),
  }));
  transaction.feePayer = new PublicKey(address);
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return signAndSend(transaction);
}

export async function sendUsdc(address: string, destination: string, amount: number): Promise<string> {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid USDC amount.");
  const connection = solanaConnection();
  const owner = new PublicKey(address);
  const recipient = new PublicKey(destination);
  const mint = new PublicKey(USDC_MINT);
  const source = await getAssociatedTokenAddress(mint, owner);
  const target = await getAssociatedTokenAddress(mint, recipient);
  const transaction = new Transaction();
  const targetInfo = await connection.getAccountInfo(target, "confirmed");
  if (!targetInfo) transaction.add(createAssociatedTokenAccountInstruction(owner, target, recipient, mint));
  transaction.add(createTransferCheckedInstruction(source, mint, target, owner, BigInt(Math.round(amount * 1_000_000)), 6));
  transaction.feePayer = owner;
  transaction.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return signAndSend(transaction);
}

export async function getJupiterQuote(
  inputMint: string,
  outputMint: string,
  amountBaseUnits: string,
  slippageBps = 50,
): Promise<JupiterQuote> {
  const url = `${JUPITER}/swap/v1/quote?inputMint=${encodeURIComponent(inputMint)}&outputMint=${encodeURIComponent(outputMint)}&amount=${encodeURIComponent(amountBaseUnits)}&slippageBps=${slippageBps}`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error("No live route is available for this market.");
  return (await response.json()) as JupiterQuote;
}

export async function executeJupiterSwap(address: string, quote: JupiterQuote): Promise<string> {
  const response = await fetch(`${JUPITER}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ quoteResponse: quote, userPublicKey: address, dynamicComputeUnitLimit: true, prioritizationFeeLamports: "auto" }),
  });
  if (!response.ok) throw new Error("The live swap route could not be built.");
  const json = await response.json() as { swapTransaction?: string };
  if (!json.swapTransaction) throw new Error("The swap provider returned no transaction.");
  const bytes = Uint8Array.from(atob(json.swapTransaction), (char) => char.charCodeAt(0));
  return signAndSend(VersionedTransaction.deserialize(bytes));
}

export async function tokenDecimals(mint: string): Promise<number> {
  const info = await getMint(solanaConnection(), new PublicKey(mint), "confirmed");
  return info.decimals;
}

async function quote(inputMint: string, outputMint: string, amountBaseUnits: string): Promise<JupiterQuote> {
  const response = await fetch(
    `${JUPITER}/swap/v1/quote?inputMint=${encodeURIComponent(inputMint)}&outputMint=${encodeURIComponent(outputMint)}&amount=${encodeURIComponent(amountBaseUnits)}&slippageBps=50`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new Error("No executable Solana route is available for this market.");
  return (await response.json()) as JupiterQuote;
}

function routeLabels(result: JupiterQuote): string[] {
  return (result.routePlan ?? [])
    .map((step) => step.swapInfo?.label ?? step.swapInfo?.ammKey ?? "AMM")
    .filter((value, index, all) => all.indexOf(value) === index);
}

function quotePriceUsd(result: JupiterQuote, tokenDecimalsValue: number, inputIsToken: boolean): number {
  const input = Number(result.inAmount);
  const output = Number(result.outAmount);
  if (!Number.isFinite(input) || !Number.isFinite(output) || input <= 0 || output <= 0) return 0;
  return inputIsToken
    ? (output / 1_000_000) / (input / 10 ** tokenDecimalsValue)
    : (input / 1_000_000) / (output / 10 ** tokenDecimalsValue);
}

export async function fetchRpcMarketQuotes(
  tokens: Array<{ mint: string; symbol: string; name: string; image?: string }>,
): Promise<RpcMarketQuote[]> {
  const connection = solanaConnection();
  const slot = await connection.getSlot("confirmed");
  const rows = await Promise.all(tokens.slice(0, 16).map(async (token) => {
    try {
      const decimals = token.mint === SOL_MINT ? 9 : await tokenDecimals(token.mint);
      const amount = String(10 ** decimals);
      const result = await quote(token.mint, USDC_MINT, amount);
      const priceUsd = quotePriceUsd(result, decimals, true);
      if (!priceUsd) return null;
      return {
        ...token,
        priceUsd,
        change24h: 0,
        volume24h: 0,
        liquidityUsd: 0,
        venue: "Jupiter route",
        slot,
        source: "solana-rpc",
      } satisfies RpcMarketQuote;
    } catch {
      return null;
    }
  }));
  return rows.filter((row): row is RpcMarketQuote => row !== null);
}

export async function fetchRpcOrderBook(mint: string): Promise<RpcOrderBook> {
  const connection = solanaConnection();
  const slot = await connection.getSlot("confirmed");
  const decimals = mint === SOL_MINT ? 9 : await tokenDecimals(mint);
  const oneToken = String(10 ** decimals);
  const buyNotional = 100;
  const [buy, sell] = await Promise.all([
    quote(USDC_MINT, mint, String(buyNotional * 1_000_000)),
    quote(mint, USDC_MINT, oneToken),
  ]);
  const bestAsk = quotePriceUsd(buy, decimals, false);
  const bestBid = quotePriceUsd(sell, decimals, true);
  const priceUsd = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
  const routes = Array.from(new Set([...routeLabels(buy), ...routeLabels(sell)]));
  return {
    mint,
    timestamp: new Date().toISOString(),
    priceUsd,
    change24h: 0,
    liquidityUsd: 0,
    venueCount: 1,
    bestBid,
    bestAsk,
    bidDepthUsd: bestBid > 0 ? bestBid : 0,
    askDepthUsd: buyNotional,
    slot,
    source: "solana-rpc",
    venues: [{
      venue: "Jupiter executable route",
      priceUsd,
      liquidityUsd: 0,
      volume24h: 0,
      buys24h: 0,
      sells24h: 0,
      buyPressurePct: null,
      liquiditySharePct: null,
      route: routes,
      quoteNotionalUsd: buyNotional,
    }],
  };
}
