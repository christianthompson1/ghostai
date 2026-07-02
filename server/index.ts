/**
 * Ghost AI — Backend Processing Engine
 *
 * Isolated server for all API endpoints, backend routes, and token calculations.
 * This server is completely separate from the frontend (/src, /public).
 *
 * Port: 3001  (frontend runs on 5000)
 */

import express from "express";
import cors from "cors";
import { router as apiRouter } from "./routes/api.js";

const app = express();
const PORT = process.env.SERVER_PORT ? Number(process.env.SERVER_PORT) : 3001;

// ── Middleware ──────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: true, // allow all origins in dev; tighten in production
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ──────────────────────────────────────────────────────────────────
app.use("/api", apiRouter);

// ── Health check ────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ghost-ai-server", timestamp: new Date().toISOString() });
});

// ── 404 catch-all ───────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Ghost AI Server] Running on http://0.0.0.0:${PORT}`);
  console.log(`[Ghost AI Server] Health: http://0.0.0.0:${PORT}/health`);
  console.log(`[Ghost AI Server] API:    http://0.0.0.0:${PORT}/api`);
});

export default app;
