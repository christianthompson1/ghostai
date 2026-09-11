import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getSignatureStatus, saveRealExecution } from "../../lib/db.js";

export const tradesRouter = Router();

const executionSchema = z.object({
  wallet: z.string().min(32).max(64),
  signature: z.string().min(80).max(100),
  action: z.enum(["buy", "sell"]),
  mint: z.string().min(32).max(64),
  symbol: z.string().min(1).max(32),
  inputMint: z.string().min(32).max(64),
  outputMint: z.string().min(32).max(64),
  inputAmount: z.string().min(1).max(40),
  outputAmount: z.string().min(1).max(40),
  priceUsd: z.number().finite().positive().optional(),
});

async function rpcCall(method: string, params: unknown[]) {
  const rpcUrl = process.env.HELIUS_RPC_URL || "https://api.mainnet-beta.solana.com";
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  if (!response.ok) throw new Error("Solana RPC unavailable");
  const json = await response.json() as { result?: unknown; error?: unknown };
  if (json.error) throw new Error("Solana RPC rejected the request");
  return json.result;
}

tradesRouter.post("/executions", async (req: Request, res: Response) => {
  const parsed = executionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Execution payload is invalid" });
    return;
  }
  try {
    const status = await getSignatureStatus(parsed.data.signature);
    if (!status?.confirmationStatus || status.err) {
      res.status(409).json({ error: "The submitted transaction is not confirmed on Solana" });
      return;
    }
    const execution = {
      ...parsed.data,
      confirmationStatus: status.confirmationStatus,
      slot: status.slot ?? null,
      confirmedAt: new Date().toISOString(),
    };
    saveRealExecution(execution);
    res.status(201).json({ execution });
  } catch {
    res.status(502).json({ error: "Could not verify the confirmed Solana transaction" });
  }
});

tradesRouter.get("/executions", async (req: Request, res: Response) => {
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet : "";
  if (wallet.length < 32 || wallet.length > 64) {
    res.status(400).json({ error: "A wallet address is required" });
    return;
  }
  res.json({ executions: [] });
});