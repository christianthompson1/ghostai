const unavailable = (): never => {
  throw new Error("Wallet actions are only available in the browser.");
};

export const connectWallet = unavailable;
export const disconnectWallet = async (): Promise<void> => undefined;
export const loadWalletSnapshot = unavailable;
export const sendSol = unavailable;
export const sendUsdc = unavailable;
export const executeJupiterSwap = unavailable;
export const getJupiterQuote = unavailable;
export const tokenDecimals = unavailable;