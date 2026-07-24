/**
 * Ghost AI — Apply Supabase Migration via Management API
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=sbp_... node --import tsx/esm server/scripts/apply-migration.ts
 *
 * Get your access token at: https://supabase.com/dashboard/account/tokens
 */

import fs   from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = new URL(process.env.SUPABASE_URL ?? "").hostname.split(".")[0];
const TOKEN       = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error("❌  SUPABASE_ACCESS_TOKEN is required.");
  console.error("   Get it at: https://supabase.com/dashboard/account/tokens");
  process.exit(1);
}

const sqlPath = path.join(__dirname, "../../supabase/migrations/20260707000000_ghost_ai_protocol.sql");
const sql     = fs.readFileSync(sqlPath, "utf8");

console.log(`\n🔗  Project ref: ${PROJECT_REF}`);
console.log(`📄  Applying migration: ${path.basename(sqlPath)}\n`);

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method:  "POST",
  headers: {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type":  "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

if (!res.ok) {
  const body = await res.text();
  console.error(`❌  Migration failed (HTTP ${res.status}):`, body);
  process.exit(1);
}

const result = await res.json();
console.log("✅  Migration applied successfully!\n");
console.log("Tables created: agents, users, tasks, submissions, stakes, lending_positions, tips");
console.log("\nResult:", JSON.stringify(result, null, 2));
