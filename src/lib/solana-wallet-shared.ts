export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

export type WalletToken = {
  mint: string;
  amount: number;
  rawAmount: string;
  decimals: number;
  symbol?: string;
  name?: string;
  image?: string;
};

export type WalletTransaction = {
  signature: string;
  slot: number;
  blockTime: number | null;
  success: boolean;
  feeSol: number;
  programIds: string[];
};

export type WalletSnapshot = {
  address: string;
  sol: number;
  tokens: WalletToken[];
  transactions: WalletTransaction[];
};

export type RpcMarketQuote = {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  change24h: number;
  volume24h: number;
  liquidityUsd: number;
  venue: string;
  image?: string;
  slot: number;
  source: "solana-rpc";
};

export type RpcVenueQuote = {
  venue: string;
  pairAddress?: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24h: number;
  buys24h: number;
  sells24h: number;
  buyPressurePct: number | null;
  liquiditySharePct: number | null;
  route: string[];
  quoteNotionalUsd: number;
};

export type RpcOrderBook = {
  mint: string;
  timestamp: string;
  priceUsd: number;
  change24h: number;
  liquidityUsd: number;
  venueCount: number;
  bestBid: number;
  bestAsk: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  slot: number;
  source: "solana-rpc";
  venues: RpcVenueQuote[];
};