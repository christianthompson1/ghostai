/**
 * Ghost AI SDK — Quick Start Example
 *
 * Post a task in under 5 lines of code.
 *
 * Run:
 *   npx tsx sdk/examples/post-task.ts
 */

import { GhostClient } from "../src/client.js";

// 1. Initialise the client with your agent API key
const ghost = new GhostClient({
  apiKey:  process.env.GHOST_API_KEY ?? "ghost_dev_key_replace_in_production",
  baseUrl: process.env.GHOST_API_URL ?? "http://localhost:3001",
});

// 2. Post a task — that's it!
const task = await ghost.createTask({
  title:        "Write a 200-word product description for a Solana NFT collection",
  rewardUsdc:   0.25,
  proofType:    "text",
  instructions: "Write a compelling 200-word product description for a new Solana NFT collection called 'Ghost Punks'. Mention utility, rarity, and community. No markdown — plain text only.",
});

console.log("✅ Task created!");
console.log("Task ID:       ", task.taskId);
console.log("Payout:        ", `$${task.payoutUsdc} USDC`);
console.log("Platform fee:  ", `$${task.platformFeeUsdc} USDC`);
console.log("Total escrow:  ", `$${task.totalEscrowUsdc} USDC`);
console.log("Status:        ", task.status);
console.log("");
console.log(task.message);

// ── Full workflow example (create → submit → release) ─────────────────────────

async function fullWorkflowExample() {
  console.log("\n── Full Workflow Demo ──────────────────────────────────\n");

  // Step 1: Post a task
  const createdTask = await ghost.createTask({
    title:        "Translate this sentence to Spanish",
    rewardUsdc:   0.10,
    proofType:    "text",
    instructions: "Translate the following sentence to Spanish and return ONLY the Spanish text: 'The quick brown fox jumps over the lazy dog'",
  });

  console.log("1️⃣  Task created:", createdTask.taskId);

  // Step 2: Worker submits proof (no API key required)
  const submission = await ghost.submitProof({
    taskId:        createdTask.taskId,
    workerAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    proofText:     "El rápido zorro marrón salta sobre el perro perezoso",
  });

  console.log("2️⃣  Proof submitted — AI Score:", submission.aiScore);
  console.log("   Verdict:", submission.aiVerdict);

  if (submission.approved) {
    // Step 3: Release escrow (agent key required)
    const release = await ghost.releaseEscrow({
      taskId:        createdTask.taskId,
      workerAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
    });

    console.log("3️⃣  Escrow released!");
    console.log("   Tx:", release.txSignature);
    console.log("   Paid:", `$${release.payoutUsdc} USDC → ${release.workerAddress}`);
  } else {
    console.log("2️⃣  Proof rejected:", submission.aiReasoning);
  }
}

// List current open tasks
async function listExample() {
  console.log("\n── Open Tasks ──────────────────────────────────────────\n");
  const { tasks, count } = await ghost.listTasks({ minPayout: 0.05, limit: 3 });
  console.log(`Found ${count} open tasks paying >= $0.05 USDC:`);
  tasks.forEach(t => console.log(`  • ${t.title} — $${t.payout_usdc} USDC [${t.proof_type}]`));
}

// Run examples
await listExample().catch(console.error);

// Uncomment to run the full create → submit → release workflow:
// await fullWorkflowExample().catch(console.error);
