# Real Wallet, Trading, and Solana Market Data

## User-facing result
- Profile connects to an injected Solana wallet, displays live SOL/token balances, and lists confirmed transactions from mainnet RPC.
- Send uses the connected wallet to sign a real SOL or USDC transfer; the UI waits for confirmation and refreshes balances.
- Trade uses live wallet balances instead of a demo portfolio and provides buy/sell forms that request a live Jupiter route, ask the wallet to sign, confirm the transaction, and publish execution status to the backend.
- Trade market data comes from Solana mainnet RPC/Jupiter quote data in the browser; the order-book panel refreshes after executions and shows only live, clearly labeled venue/route depth.

## Implementation
1. Add a small browser-safe Solana wallet/RPC module using the injected wallet provider, `@solana/web3.js`, mainnet RPC, and Jupiter quote/swap endpoints.
2. Replace profile localStorage wallet linking and backend send/ATA actions with connect/disconnect, RPC balance/token account reads, confirmed signature history, and wallet-signed transfers. Keep QR receive and developer identity display.
3. Replace trade paper state, demo cash/positions, and paper buy/sell handlers with connected-wallet balances plus Jupiter buy/sell forms. Refresh RPC balances, selected-market quotes, and order-book summaries after confirmed signatures.
4. Update shared market types/helpers so the trade page no longer depends on placeholder/demo market sources. Preserve the existing glass UI and tabs, adding loading and unavailable states rather than fabricated rows.
5. Validate with typecheck, build diagnostics, and browser checks for profile/trade empty-wallet states and the wallet connection affordances.

## Technical notes
- A wallet signature is required for every state-changing transaction; private keys never leave the wallet extension.
- The browser uses a public Solana mainnet RPC fallback unless a publishable RPC URL is already configured; no secret key is added to frontend code.
- Unsupported wallets or RPC/Jupiter outages produce plain actionable notices and never pretend a transaction succeeded.
