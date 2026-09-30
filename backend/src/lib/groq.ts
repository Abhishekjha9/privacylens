import Groq from "groq-sdk";
import { CHUNK_ANALYSIS_PROMPT } from "./prompts";
import { globalScheduler } from "./scheduler";

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "missing_key",
});

export const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

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

// ── JSON Schema (array-of-objects — no correlated-array mismatch possible) ───
const JSON_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          category: { type: "string" },
          severity: { type: "string" },
          title: { type: "string" },
          explanation: { type: "string" },
          evidence: { type: "string" }
        },
        required: ["category", "severity", "title", "explanation", "evidence"],
        additionalProperties: false
      }
    }
  },
  required: ["findings"],
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
  if (lower.includes('cross-border') || lower.includes('direct marketing')) return 'data_sharing';
  if (lower.includes('lawful bases') || lower.includes('legal basis')) return 'legal';
  return 'other';
}

/**
 * Parse the array-of-objects response from Groq.
 * Each finding is self-contained — no correlated-array mismatch possible.
 */
function parseFindingsResponse(parsed: any, chunkIndex: number): ChunkFinding[] {
  if (!Array.isArray(parsed?.findings)) {
    throw new Error(`LOCAL_VALIDATION_ERROR chunk=${chunkIndex}: 'findings' is not an array`);
  }

  const findings: ChunkFinding[] = [];

  for (let i = 0; i < parsed.findings.length; i++) {
    const f = parsed.findings[i];
    if (!f || typeof f !== "object") {
      console.warn(`[PrivacyLens] LOCAL_VALIDATION_ERROR chunk=${chunkIndex} index=${i}: not an object — skipping`);
      continue;
    }

    const catLower = mapCategory(f.category ?? "");
    const sevUpper = (f.severity ?? "").toUpperCase().trim();
    const t = (f.title ?? "").trim();
    const expl = (f.explanation ?? "").trim();
    const ev = (f.evidence ?? "").trim();

    if (!ALLOWED_SEVERITIES.includes(sevUpper)) {
      console.warn(`[PrivacyLens] LOCAL_VALIDATION_ERROR chunk=${chunkIndex} index=${i}: invalid severity "${sevUpper}" — skipping`);
      continue;
    }
    if (!t || !expl || !ev) {
      console.warn(`[PrivacyLens] LOCAL_VALIDATION_ERROR chunk=${chunkIndex} index=${i}: missing required fields — skipping`);
      continue;
    }

    findings.push({ category: catLower, severity: sevUpper as ChunkFinding["severity"], title: t, explanation: expl, evidence: ev });
  }

  return findings;
}

function getRetryDelay(headers: Headers | undefined, error: any): number {
  // Prefer server-provided Retry-After header
  const retryAfter = headers?.get("retry-after");
  if (retryAfter) {
    const seconds = parseFloat(retryAfter);
    if (!isNaN(seconds)) return Math.ceil(seconds * 1000);
  }
  // Fall back to parsing the error message
  const msg = error?.error?.message || error?.message || "";
  const match = msg.match(/try again in ([\d\.]+)s/i);
  if (match && match[1]) return parseFloat(match[1]) * 1000;
  return 800;
}

// ── Internal error types ──────────────────────────────────────────────────────
class GroqHttpError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`GROQ_HTTP_ERROR status=${status}`);
  }
}
class GroqRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number, public readonly body: string) {
    super(`GROQ_RATE_LIMIT_ERROR retryAfter=${retryAfterMs}ms`);
  }
}

/**
 * callGroq — fires one Groq HTTP request.
 *
 * Acquire/release contract:
 *   1. acquire() before the fetch
 *   2. release() EXACTLY ONCE in the finally block of the fetch
 *   3. LOCAL parse/validation errors happen AFTER release — they are never
 *      classified as Groq HTTP errors
 */
async function callGroq(
  prompt: string,
  chunkIndex: number,
  totalChunks: number,
  label: string,
  docTag: string,
  signal?: AbortSignal,
  maxWaitMs?: number
): Promise<{ findings: ChunkFinding[], completionTokens: number, promptTokens: number, totalTokens: number, retryTokens: number, retryCount: number }> {
  const MAX_RETRIES = 1;
  let attempt = 0;
  let lastError: any = null;
  let retryTokens = 0;
  let retryCount = 0;

  const estimatedTokens = Math.ceil(prompt.length / 4) + 100; // +100 for compact completion
  const startTime = Date.now();

  while (attempt <= MAX_RETRIES) {
    if (signal?.aborted) throw new Error("Cancelled");
    attempt++;

    console.log(`[PrivacyLens] GROQ REQUEST START
  doc=${docTag}
  chunk=${chunkIndex}
  estimatedInputTokens=${estimatedTokens}`);

    const leaseId = await globalScheduler.acquire(estimatedTokens, signal, maxWaitMs, docTag, chunkIndex);

    if (signal?.aborted) {
      globalScheduler.releaseError(leaseId, estimatedTokens);
      throw new Error("Cancelled");
    }

    // ── Groq HTTP request ─────────────────────────────────────────────────────
    // Everything inside this try/finally is the "acquired" window.
    // release() is called EXACTLY ONCE in the finally block.
    // Local parse/validation runs OUTSIDE this try/finally.
    let rawResponse: string | null = null;
    let completionTokens = 0;
    let promptTokens = 0;
    let totalTokens = 0;
    let httpSuccess = false;
    let responseHeaders: Headers | undefined;

    console.log(`[PrivacyLens] ${docTag} CHUNK ${chunkIndex}/${totalChunks} GROQ START`);
    console.log(`\n[PrivacyLens] --- GROQ REQUEST (${label}, attempt ${attempt}) ---`);
    console.log(`- Chunk: ${chunkIndex}/${totalChunks} (Prompt: ${prompt.length} chars, Est Tokens: ${estimatedTokens})`);
    console.log(`- Request: { model: "${MODEL}", temperature: 0.1, max_tokens: 600, schema: "privacy_policy_analysis_v2", strict: true }`);

    let httpError: GroqHttpError | GroqRateLimitError | Error | null = null;

    try {
      const chatCompletion = await groq.chat.completions.create(
        {
          messages: [{ role: "user", content: prompt }],
          model: MODEL,
          temperature: 0.1,
          max_tokens: 600,
          // @ts-ignore
          include_reasoning: false,
          reasoning_effort: "low",
          response_format: {
            type: "json_schema",
            json_schema: { name: "privacy_policy_analysis_v2", strict: true, schema: JSON_SCHEMA }
          },
        },
        // @ts-ignore
        { timeout: 30000, signal }
      );

      completionTokens = chatCompletion.usage?.completion_tokens ?? 0;
      promptTokens = chatCompletion.usage?.prompt_tokens ?? 0;
      totalTokens = chatCompletion.usage?.total_tokens ?? 0;
      rawResponse = chatCompletion.choices[0]?.message?.content ?? null;
      httpSuccess = true;

      // Log rate-limit headers from a successful response for observability
      try {
        const raw = (chatCompletion as any)._response ?? (chatCompletion as any).response;
        if (raw?.headers) {
          responseHeaders = raw.headers;
          const limit = raw.headers.get?.("x-ratelimit-limit-tokens") || raw.headers.get?.("X-RateLimit-Limit-Tokens") || "unknown";
          const remaining = raw.headers.get?.("x-ratelimit-remaining-tokens") || raw.headers.get?.("X-RateLimit-Remaining-Tokens") || "unknown";
          const reset = raw.headers.get?.("x-ratelimit-reset-tokens") || raw.headers.get?.("X-RateLimit-Reset-Tokens") || "unknown";
          
          console.log(`[PrivacyLens] GROQ LIMITS
  limitTokens=${limit}
  remainingTokens=${remaining}
  resetTokens=${reset}`);
        }
      } catch { /* headers not available */ }

    } catch (fetchErr: any) {
      const status = fetchErr?.status ?? fetchErr?.response?.status;
      let body: string;
      try { body = JSON.stringify(fetchErr?.error ?? fetchErr?.message ?? fetchErr); }
      catch { body = String(fetchErr); }

      if (status === 429) {
        const retryMs = getRetryDelay(responseHeaders, fetchErr);
        httpError = new GroqRateLimitError(retryMs, body);
        console.error(`[PrivacyLens] GROQ REQUEST ERROR
  doc=${docTag}
  chunk=${chunkIndex}
  errorCode=429
  status=429
  retryAfter=${retryMs}
  remainingTPM=unknown`);
      } else if (status === 400 && fetchErr?.error?.code === "json_validate_failed") {
        // Schema generation failure from Groq itself
        httpError = new GroqHttpError(400, body);
        console.error(`[PrivacyLens] GROQ REQUEST ERROR
  doc=${docTag}
  chunk=${chunkIndex}
  errorCode=SCHEMA
  status=400
  retryAfter=null
  remainingTPM=unknown`);
      } else if (status) {
        httpError = new GroqHttpError(status, body);
        console.error(`[PrivacyLens] GROQ REQUEST ERROR
  doc=${docTag}
  chunk=${chunkIndex}
  errorCode=HTTP
  status=${status}
  retryAfter=null
  remainingTPM=unknown`);
      } else {
        httpError = fetchErr;
        console.error(`[PrivacyLens] GROQ REQUEST ERROR
  doc=${docTag}
  chunk=${chunkIndex}
  errorCode=CONNECTION
  status=unknown
  retryAfter=null
  remainingTPM=unknown`);
      }
    } finally {
      // ── ONE release per acquire, always ───────────────────────────────────
      globalScheduler.release(leaseId, httpSuccess ? totalTokens : estimatedTokens, estimatedTokens);
      if (httpSuccess) {
        console.log(`[PrivacyLens] GROQ REQUEST SUCCESS
  doc=${docTag}
  chunk=${chunkIndex}
  promptTokens=${promptTokens}
  completionTokens=${completionTokens}
  totalTokens=${totalTokens}
  latencyMs=${Date.now() - startTime}`);
      }
    }

    // ── If HTTP failed, decide whether to retry ───────────────────────────────
    if (httpError !== null) {
      lastError = httpError;

      if (signal?.aborted) throw new Error("Cancelled");

      const isRetryable =
        httpError instanceof GroqRateLimitError ||
        (httpError instanceof GroqHttpError && (httpError.status === 500 || httpError.status === 502 || httpError.status === 503)) ||
        (!(httpError instanceof GroqHttpError) && (httpError as any)?.name === "APIConnectionError");

      if (!isRetryable || attempt > MAX_RETRIES) throw httpError;

      retryCount++;
      const delay = httpError instanceof GroqRateLimitError ? httpError.retryAfterMs : 800;
      console.warn(`[PrivacyLens] Chunk ${chunkIndex} retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
      continue;
    }

    // ── HTTP succeeded — now do LOCAL parse/validation ────────────────────────
    // Any error here is a LOCAL error, NOT a Groq HTTP error.
    if (!rawResponse) {
      console.warn(`[PrivacyLens] LOCAL_PARSE_ERROR chunk=${chunkIndex}/${totalChunks}: empty response body`);
      // Treat empty response as a non-retryable local failure — return empty findings
      return { findings: [], completionTokens, promptTokens, totalTokens, retryTokens, retryCount };
    }

    let parsed: any;
    try {
      parsed = JSON.parse(rawResponse);
    } catch (parseErr) {
      console.error(`[PrivacyLens] LOCAL_PARSE_ERROR chunk=${chunkIndex}/${totalChunks}: JSON.parse failed — responseLength=${rawResponse.length}`);
      return { findings: [], completionTokens, promptTokens, totalTokens, retryTokens, retryCount };
    }

    let findings: ChunkFinding[];
    try {
      findings = parseFindingsResponse(parsed, chunkIndex);
    } catch (valErr: any) {
      // Diagnostic: log the shape of the parsed object, not the raw content
      const shape = {
        hasFindingsKey: "findings" in parsed,
        findingsIsArray: Array.isArray(parsed?.findings),
        findingsLength: Array.isArray(parsed?.findings) ? parsed.findings.length : "n/a",
        responseContentLength: rawResponse.length,
      };
      console.error(`[PrivacyLens] LOCAL_VALIDATION_ERROR chunk=${chunkIndex}/${totalChunks}: ${valErr.message}`, JSON.stringify(shape));
      return { findings: [], completionTokens, promptTokens, totalTokens, retryTokens, retryCount };
    }

    return { findings, completionTokens, promptTokens, totalTokens, retryTokens, retryCount };
  }

  throw lastError;
}

/**
 * Analyzes one chunk of a legal/privacy document.
 */
export async function analyzeChunk(
  chunkText: string,
  policyContext: string,
  chunkIndex: number = 1,
  totalChunks: number = 1,
  signal?: AbortSignal,
  docTag: string = "DOC",
  maxWaitMs?: number
): Promise<ChunkAnalysisResult> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing. Please set it in backend/.env");
  }

  const mainPrompt =
    `${CHUNK_ANALYSIS_PROMPT}\n\nDocument Context: ${policyContext}\n\n--- POLICY TEXT START ---\n${chunkText}\n--- POLICY TEXT END ---`;

  console.log(`[PrivacyLens] ${docTag} CHUNK ${chunkIndex}/${totalChunks} QUEUED (${chunkText.length} chars)`);
  const startTime = Date.now();

  try {
    const { findings, completionTokens, promptTokens, totalTokens, retryTokens, retryCount } = await callGroq(
      mainPrompt,
      chunkIndex,
      totalChunks,
      "primary",
      docTag,
      signal,
      maxWaitMs
    );
    const durationMs = Date.now() - startTime;
    console.log(`[PrivacyLens] ${docTag} CHUNK ${chunkIndex}/${totalChunks} SUCCESS (${durationMs}ms, ${findings.length} findings, ${totalTokens} tokens)`);
    return {
      findings,
      success: findings.length > 0 || completionTokens > 0,
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
  } catch (err: any) {
    if (signal?.aborted) throw err;
    console.error(`[PrivacyLens] GROQ REQUEST ERROR
  doc=${docTag}
  chunk=${chunkIndex}
  errorCode=DOC_ABORT
  status=Local
  retryAfter=null
  remainingTPM=null`);
    throw err;
  }
}
