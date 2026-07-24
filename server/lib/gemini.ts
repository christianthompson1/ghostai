/**
 * Ghost AI — Gemini 2.5 Flash Quality Verification
 *
 * Used by the worker submission endpoint to automatically verify that a
 * submitted proof meets the task's stated quality requirements off-chain
 * before triggering any on-chain payment release.
 *
 * Returns a structured verdict so the caller can gate the escrow release.
 */

import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY ?? "";
if (!apiKey) console.warn("[Gemini] GEMINI_API_KEY is not set — AI verification will return safe rejections");

// Lazy client: created on first use so missing key doesn't crash startup
let _ai: GoogleGenAI | null = null;
function getAi(): GoogleGenAI {
  if (!_ai) {
    if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
    _ai = new GoogleGenAI({ apiKey });
  }
  return _ai;
}
const ai = { get models() { return getAi().models; } };

export interface VerificationResult {
  approved:   boolean;
  score:      number;        // 0–100
  verdict:    string;        // one-line summary for logs / DB
  reasoning:  string;        // full AI explanation
}

const SYSTEM_PROMPT = `You are a strict quality-control AI for the Ghost AI task marketplace on Solana.
Your job is to verify that a worker's submitted proof fully satisfies the task instructions.

Respond ONLY with valid JSON matching this exact schema:
{
  "approved": boolean,
  "score": number (0-100),
  "verdict": "one-line summary",
  "reasoning": "detailed explanation"
}

Scoring guide:
- 90-100: Exceptional — exceeds all requirements
- 70-89:  Meets all requirements — approve
- 50-69:  Partially meets requirements — reject, explain gaps
- 0-49:   Does not meet requirements — reject
Approve only if score >= 70.`;

/**
 * Ask Gemini 2.5 Flash to review a worker's proof against task instructions.
 */
export async function verifyProof(
  taskTitle:       string,
  taskInstructions: string,
  proofType:       string,
  proofText:       string,
): Promise<VerificationResult> {
  const userPrompt = `TASK TITLE: ${taskTitle}
TASK INSTRUCTIONS: ${taskInstructions}
EXPECTED PROOF TYPE: ${proofType}

WORKER SUBMISSION:
${proofText}

Evaluate whether this submission satisfies the task instructions.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType:  "application/json",
        temperature:       0.1,   // low temp for consistent grading
      },
    });

    const raw = response.text ?? "{}";

    // Strip markdown fences if the model wraps the JSON
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed  = JSON.parse(cleaned) as Partial<VerificationResult>;

    return {
      approved:  Boolean(parsed.approved),
      score:     typeof parsed.score === "number" ? Math.round(parsed.score) : 0,
      verdict:   String(parsed.verdict  ?? "No verdict"),
      reasoning: String(parsed.reasoning ?? "No reasoning"),
    };
  } catch (err) {
    // Non-fatal: return a safe rejection with the error logged
    console.error("[Gemini] verifyProof error:", (err as Error).message);
    return {
      approved:  false,
      score:     0,
      verdict:   "Verification service error — submission rejected for safety",
      reasoning: (err as Error).message,
    };
  }
}

/**
 * Generate a formatted task description for Irys metadata storage.
 */
export async function generateTaskMetadata(
  title:        string,
  instructions: string,
  payoutUsdc:   number,
): Promise<string> {
  try {
    const response = await ai.models.generateContent({
      model:    "gemini-2.5-flash",
      contents: `Create a concise, professional task listing for an AI task marketplace.
Title: ${title}
Instructions: ${instructions}
Payout: $${payoutUsdc} USDC

Return a 2-3 sentence professional description that AI agents can parse.`,
      config: { temperature: 0.4 },
    });
    return response.text ?? instructions;
  } catch {
    return instructions;
  }
}
