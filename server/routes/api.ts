/**
 * Ghost AI — API Router
 *
 * All backend API endpoints are registered here.
 * Add sub-routers per domain (tokens, solana, chat, etc.) as the engine grows.
 */

import { Router } from "express";

export const router = Router();

// ── Placeholder: ready for endpoint configuration ───────────────────────────
router.get("/", (_req, res) => {
  res.json({
    message: "Ghost AI API — ready for endpoint configuration",
    endpoints: [],
  });
});

// ── Add domain routers below ─────────────────────────────────────────────────
// Example (uncomment when ready):
// import { router as tokenRouter } from "./tokens.js";
// router.use("/tokens", tokenRouter);
