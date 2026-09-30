import Groq from "groq-sdk";
import { CHUNK_ANALYSIS_PROMPT, FALLBACK_ANALYSIS_PROMPT } from "./prompts";
import { globalScheduler } from "./scheduler";

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "missing_key",
});

export const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

export interface ChunkFinding {
  category: string;
  title: string;
  explanation: string;
  evidence: string;
  severity: "EXPECTED" | "LOW" | "MEDIUM" | "HIGH";
}

export interface ChunkAnalysisResult {
  findings: ChunkFinding[];
  success?: boolean;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  durationMs?: number;
  retryTokens?: number;
  retryCount?: number;
  staticInstructionsChars?: number;
  policyChunkChars?: number;
  finalPromptChars?: number;
}

console.log(`[PrivacyLens] GROQ_API_KEY loaded: ${!!process.env.GROQ_API_KEY}`);
console.log(`[PrivacyLens] GROQ_MODEL: ${MODEL}`);

const JSON_SCHEMA = {
  type: "object",
  properties: {
    categories: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
    severities: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
    titles: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
    explanations: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 },
    evidence: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5 }
  },
  required: ["categories", "severities", "titles", "explanations", "evidence"],
  additionalProperties: false
};

const ALLOWED_CATEGORIES = [
  "data_collection", "data_sharing", "tracking", "permissions", "retention", 
  "deletion", "ai_training", "subscription", "user_rights", "security", "legal", "other"
];
const ALLOWED_SEVERITIES = ["EXPECTED", "LOW", "MEDIUM", "HIGH"];

function mapCategory(cat: string): string {
  const lower = cat.toLowerCase().trim();
  if (ALLOWED_CATEGORIES.includes(lower)) return lower;
  if (lower.includes('cross-border data transfers') || lower.includes('direct marketing')) return 'data_sharing';
  if (lower.includes('lawful bases for processing')) return 'legal';
  return 'other';
}

function parseParallelArrayResponse(parsed: any, chunkIndex: number): ChunkFinding[] {
  const { categories, severities, titles, explanations, evidence } = parsed;
  if (!Array.isArray(categories) || !Array.isArray(severities) || !Array.isArray(titles) || !Array.isArray(explanations) || !Array.isArray(evidence)) {
    throw new Error(`Invalid structured analysis in chunk ${chunkIndex}: one or more properties are not arrays`);
  }
  const count = categories.length;
  if (severities.length !== count || titles.length !== count || explanations.length !== count || evidence.length !== count) {
    throw new Error(`Mismatched finding arrays in chunk ${chunkIndex}`);
  }
  if (count > 5) throw new Error(`Chunk ${chunkIndex} returned ${count} findings (max 5)`);

  const findings: ChunkFinding[] = [];
  for (let i = 0; i < count; i++) {
    const catLower = mapCategory(categories[i] ?? "");
    const sevUpper = (severities[i] ?? "").toUpperCase().trim();
    const t = (titles[i] ?? "").trim();
    const expl = (explanations[i] ?? "").trim();
    const ev = (evidence[i] ?? "").trim();

    if (!ALLOWED_SEVERITIES.includes(sevUpper)) {
      console.warn(`[PrivacyLens] Chunk ${chunkIndex} index ${i}: invalid severity "${sevUpper}" — skipping`);
      continue;
    }
    if (!t || !expl || !ev) {
      console.warn(`[PrivacyLens] Chunk ${chunkIndex} index ${i}: missing required fields — skipping`);
      continue;
    }

    findings.push({ category: catLower, severity: sevUpper as ChunkFinding["severity"], title: t, explanation: expl, evidence: ev });
  }
  return findings;
}

function getRetryDelay(error: any): number {
  const msg = error?.error?.message || error?.message || "";
  const match = msg.match(/try again in ([\d\.]+)s/i);
  if (match && match[1]) {
    return parseFloat(match[1]) * 1000;
  }
  return 800;
}

async function callGroq(
  prompt: string, chunkIndex: number, totalChunks: number, chunkText: string, label: string, signal?: AbortSignal
): Promise<{findings: ChunkFinding[], completionTokens: number, promptTokens: number, totalTokens: number, retryTokens: number, retryCount: number}> {
  const MAX_RETRIES = 1;
  let attempt = 0;
  let lastError: any = null;
  let retryTokens = 0;
  let retryCount = 0;

  const estimatedTokens = Math.ceil(prompt.length / 4) + 150; // +150 for completion buffer

  while (attempt <= MAX_RETRIES) {
    if (signal?.aborted) throw new Error("Cancelled");
    attempt++;
    
    await globalScheduler.acquire(estimatedTokens);
    if (signal?.aborted) {
      globalScheduler.release(0, estimatedTokens);
      throw new Error("Cancelled");
    }

    try {
      console.log(`\n[PrivacyLens] --- GROQ REQUEST (${label}, attempt ${attempt}) ---`);
      console.log(`- Chunk: ${chunkIndex}/${totalChunks} (Prompt: ${prompt.length} chars, Est Tokens: ${estimatedTokens})`);

      const chatCompletion = await groq.chat.completions.create(
        {
          messages: [{ role: "user", content: prompt }],
          model: MODEL,
          temperature: 0.1,
          max_tokens: 1000,
          // @ts-ignore
          include_reasoning: false,
          reasoning_effort: "low",
          response_format: { type: "json_schema", json_schema: { name: "privacy_policy_analysis", strict: true, schema: JSON_SCHEMA } },
        },
        // @ts-ignore
        { timeout: 30000, signal }
      );

      const completionTokens = chatCompletion.usage?.completion_tokens ?? 0;
      const promptTokens = chatCompletion.usage?.prompt_tokens ?? 0;
      const totalTokens = chatCompletion.usage?.total_tokens ?? 0;
      
      globalScheduler.release(totalTokens, estimatedTokens);

      const responseContent = chatCompletion.choices[0]?.message?.content;
      if (!responseContent) throw new Error("Groq returned an empty response");

      const parsed = JSON.parse(responseContent);
      const findings = parseParallelArrayResponse(parsed, chunkIndex);
      return { findings, completionTokens, promptTokens, totalTokens, retryTokens, retryCount };
    } catch (error: any) {
      globalScheduler.release(estimatedTokens, estimatedTokens); // release roughly estimated since actual unknown
      lastError = error;
      if (signal?.aborted) throw new Error("Cancelled");

      const isRateLimit = error.status === 429;
      const isTransient = isRateLimit || error.status === 500 || error.status === 502 || error.status === 503 || error.name === "APIConnectionError" || error.name === "APIConnectionTimeoutError";

      if (!isTransient || attempt > MAX_RETRIES) throw error;

      retryCount++;
      const delay = isRateLimit ? getRetryDelay(error) : 800;
      console.warn(`[PrivacyLens] Chunk ${chunkIndex} error (${error.status}), retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastError;
}

function isSchemaGenerationFailure(error: any): boolean {
  return error?.status === 400 && (error?.error?.code === "json_validate_failed" || (typeof error?.error?.message === "string" && error.error.message.toLowerCase().includes("validate")));
}

/**
 * Analyzes one chunk. Tries the main prompt first. If Groq returns a
 * schema-generation 400, retries with the simpler fallback prompt.
 * Returns findings (possibly empty) rather than throwing, so callers
 * can skip a bad chunk and continue.
 */
export async function analyzeChunk(
  chunkText: string,
  policyContext: string,
  chunkIndex: number = 1,
  totalChunks: number = 1,
  signal?: AbortSignal
): Promise<ChunkAnalysisResult> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing. Please set it in backend/.env");
  }

  const mainPrompt =
    `${CHUNK_ANALYSIS_PROMPT}\n\nDocument Context: ${policyContext}\n\n--- POLICY TEXT START ---\n${chunkText}\n--- POLICY TEXT END ---`;

  console.log(`[PrivacyLens] Chunk ${chunkIndex}/${totalChunks} started`);
  const startTime = Date.now();
  let fallbackRetryTokens = 0;
  let fallbackRetryCount = 0;

  // --- Primary attempt ---
  try {
    const { findings, completionTokens, promptTokens, totalTokens, retryTokens, retryCount } = await callGroq(
      mainPrompt,
      chunkIndex,
      totalChunks,
      chunkText,
      "primary",
      signal
    );
    const durationMs = Date.now() - startTime;
    return { 
      findings, 
      success: true,
      promptTokens, 
      completionTokens, 
      totalTokens,
      durationMs,
      retryTokens,
      retryCount,
      staticInstructionsChars: mainPrompt.length - chunkText.length,
      policyChunkChars: chunkText.length,
      finalPromptChars: mainPrompt.length
    };
  } catch (primaryError: any) {
    if (signal?.aborted) throw primaryError;
    if (isSchemaGenerationFailure(primaryError)) {
      console.error(
        `[PrivacyLens] Chunk ${chunkIndex} schema validation failed (code: ${primaryError?.error?.code})`
      );
      console.log(
        `[PrivacyLens] Retrying chunk ${chunkIndex} with fallback prompt...`
      );
    } else {
      // Not a schema failure — log and re-throw so analyzer can decide
      console.error(
        `[PrivacyLens] Chunk ${chunkIndex} non-schema error: status=${primaryError?.status}, name=${primaryError?.name}`
      );
      throw primaryError;
    }
  }

  // --- Fallback attempt (only reached on schema generation failure) ---
  const fallbackPrompt =
    `${FALLBACK_ANALYSIS_PROMPT}\n\n--- POLICY TEXT START ---\n${chunkText}\n--- POLICY TEXT END ---`;

  try {
    const { findings, completionTokens, promptTokens, totalTokens, retryTokens, retryCount } = await callGroq(
      fallbackPrompt,
      chunkIndex,
      totalChunks,
      chunkText,
      "fallback",
      signal
    );
    const durationMs = Date.now() - startTime;
    return { 
      findings, 
      success: true,
      promptTokens, 
      completionTokens, 
      totalTokens,
      durationMs,
      retryTokens: retryTokens + fallbackRetryTokens,
      retryCount: retryCount + fallbackRetryCount + 1, // +1 for the fallback attempt itself
      staticInstructionsChars: fallbackPrompt.length - chunkText.length,
      policyChunkChars: chunkText.length,
      finalPromptChars: fallbackPrompt.length
    };
  } catch (fallbackError: any) {
    if (signal?.aborted) throw fallbackError;
    const durationMs = Date.now() - startTime;
    return { 
      findings: [], 
      success: false,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      durationMs,
      retryTokens: fallbackRetryTokens,
      retryCount: fallbackRetryCount + 1,
      staticInstructionsChars: fallbackPrompt.length - chunkText.length,
      policyChunkChars: chunkText.length,
      finalPromptChars: fallbackPrompt.length
    };
  }
}
