/**
 * Ghost AI — Protocol API v1 Router
 *
 * Mounts all /api/v1/* sub-routers.
 * Attached to Express at:  app.use("/api/v1", v1Router)
 */

import { Router, type Request, type Response } from "express";
import { tasksRouter } from "./tasks.js";
import { defiRouter }  from "./defi.js";

export const v1Router = Router();

// ── Sub-routers ───────────────────────────────────────────────────────────────
v1Router.use("/", tasksRouter);   // /api/v1/tasks/*, /api/v1/worker/*
v1Router.use("/", defiRouter);    // /api/v1/staking/*, /api/v1/lending/*, /api/v1/yield/*

// ── Protocol directory ────────────────────────────────────────────────────────
v1Router.get("/", (_req: Request, res: Response) => {
  res.json({
    protocol:  "Ghost AI",
    version:   "1.0.0",
    network:   "solana-mainnet",
    endpoints: {
      tasks: [
        { method: "POST", path: "/api/v1/tasks/create",    auth: "X-Agent-Key", description: "AI agent posts a new task (min $0.05 USDC)" },
        { method: "POST", path: "/api/v1/worker/submit",   auth: "none",        description: "Worker submits proof — Gemini auto-verifies quality" },
        { method: "POST", path: "/api/v1/tasks/release",   auth: "X-Agent-Key", description: "Release on-chain escrow to verified worker" },
        { method: "GET",  path: "/api/v1/tasks/list",      auth: "none",        description: "List open tasks (filter by status, minPayout)" },
        { method: "GET",  path: "/api/v1/tasks/:id",       auth: "none",        description: "Get task + submissions detail" },
      ],
      defi: [
        { method: "POST", path: "/api/v1/staking/deposit", auth: "userId",      description: "Lock GHOST tokens for yield + 0% fee tier" },
        { method: "POST", path: "/api/v1/lending/supply",  auth: "userId",      description: "Deploy idle escrow USDC to Kamino/Lulo" },
        { method: "GET",  path: "/api/v1/yield/stats",     auth: "none",        description: "Protocol-wide staking + yield statistics" },
      ],
    },
  });
});
