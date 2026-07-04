/**
 * Ghost AI — Backend Processing Engine
 *
 * Isolated server for all API endpoints, backend routes, and token calculations.
 * This server is completely separate from the frontend (/src, /public).
 *
 * Port: 3001  (frontend runs on 5000)
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { router as apiRouter } from "./routes/api.js";

const app = express();
const PORT = process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : 3001;

// ── CORS ─────────────────────────────────────────────────────────────────────
// Explicit middleware so every response — including preflight OPTIONS — carries
// the correct Access-Control-Allow-Origin header.  The cors() package wraps
// this same logic but can silently skip headers on certain edge cases; doing it
// directly guarantees the header is always present and eliminates the browser
// "Failed to fetch" error from Lovable's preview iframe.
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept, X-Requested-With"
  );
  // Cache preflight for 24 hours so browsers don't repeat the OPTIONS round-trip
  res.setHeader("Access-Control-Max-Age", "86400");

  // Preflight response — no body, just headers
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }

  next();
});

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/api", apiRouter);

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    service: "ghost-ai-server",
    timestamp: new Date().toISOString(),
  });
});

// ── 404 catch-all ────────────────────────────────────────────────────────────
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Ghost AI Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Ghost AI Server] Health: http://0.0.0.0:${PORT}/health`);
  console.log(`[Ghost AI Server] API:    http://0.0.0.0:${PORT}/api`);
});

export default app;
