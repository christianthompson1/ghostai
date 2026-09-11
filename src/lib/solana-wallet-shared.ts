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