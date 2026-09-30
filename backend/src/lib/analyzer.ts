import { PolicyDocument, PolicyAnalysis } from "../types/analysis";
import { analyzeChunk, ChunkFinding } from "./groq";
import { buildPolicyAnalysis } from "./risk-engine";

// ── Token budget ──────────────────────────────────────────────────────────────
// Target ≤5000 input tokens per analysis window (est 4 chars/token).
// This leaves headroom for the instruction prefix and completion tokens
// within the 8K TPM limit.
const MAX_FILTERED_CHARS = 12000; // ~3000 tokens — fits in 1 chunk with instruction overhead
const INSTRUCTION_OVERHEAD_CHARS = 700; // prompt + context prefix

// ── Section-aware relevance scoring ─────────────────────────────────────────

const DATA_SIGNALS = /\b(personal data|personal information|information we collect|account information|device information|location data|contact|biometric|sensitive|collect(?:ion|ing|ed|s)?|usage data|log data)\b/i;
const SHARING_SIGNALS = /\b(shar(?:e|ing|ed)|third.?part(?:y|ies)|service provider|affiliate|partner|disclos(?:e|ure)|sell|sale|sold|transfer|resell)\b/i;
const TRACKING_SIGNALS = /\b(cookie|track(?:ing)?|advertising|analytic|pixel|identifier|ip address|cross.?site|interest.?based|personali[sz]ed ads|profil(?:e|ing)|fingerprint|web beacon|device id)\b/i;
const RETENTION_SIGNALS = /\b(retain|retention|stor(?:e|ing|age)|how long|delet(?:e|ion)|erasure|purge|expir(?:e|ation))\b/i;
const AI_SIGNALS = /\b(artificial intelligence|machine learning|\bai\b|model train|training data|automated decision|generative|large language|llm|improve our (?:model|service|ai))\b/i;
const RIGHTS_SIGNALS = /\b(right to (?:access|delete|correct|know|opt.?out)|privacy right|data subject|gdpr|ccpa|dsar|withdraw consent|object to processing|portab)\b/i;
const SECURITY_SIGNALS = /\b(secur(?:e|ity|ing)|encrypt(?:ion)?|breach|incident|protect|safeguard|vulnerab)\b/i;
const LEGAL_SIGNALS = /\b(jurisdiction|international transfer|cross.?border|legal obligation|law enforcement|court order|regulat(?:or|ory)|subpoena|compelled)\b/i;
const PAYMENT_SIGNALS = /\b(payment|billing|subscri(?:be|ption)|purchas|transaction|charg(?:e|ing)|fee|refund)\b/i;
const CHILDREN_SIGNALS = /\b(children|child|minor|under (?:13|16|18)|coppa|parental consent)\b/i;

// Boilerplate to skip aggressively
const BOILERPLATE = /^(?:copyright|all rights reserved|skip to|navigation|follow us|contact us|help center|sign in|log in|register|create account|about us|careers|investor|sitemap|accessibility|cookie preference|©|\s*menu\s*|\s*search\s*)/i;

// Heading detector
const HEADING_RE = /^(?:#{1,3}\s+|[A-Z][A-Z0-9 ]{2,50}:?\s*$|(?:\d+\.?\s+)[A-Z])/;

interface Section {
  heading: string;
  paragraphs: string[];
  score: number;
}

function scoreText(text: string): number {
  let score = 0;
  if (DATA_SIGNALS.test(text)) score += 3;
  if (SHARING_SIGNALS.test(text)) score += 4;
  if (TRACKING_SIGNALS.test(text)) score += 4;
  if (RETENTION_SIGNALS.test(text)) score += 3;
  if (AI_SIGNALS.test(text)) score += 5;
  if (RIGHTS_SIGNALS.test(text)) score += 4;
  if (SECURITY_SIGNALS.test(text)) score += 2;
  if (LEGAL_SIGNALS.test(text)) score += 3;
  if (PAYMENT_SIGNALS.test(text)) score += 2;
  if (CHILDREN_SIGNALS.test(text)) score += 4;
  return score;
}

/**
 * Section-aware relevance filter.
 *
 * Algorithm:
 * 1. Split text into lines and detect section boundaries (headings).
 * 2. Assign each section a relevance score based on signal keywords.
 * 3. Keep sections with score > 0, sorted by score (highest first).
 * 4. Stop adding sections once MAX_FILTERED_CHARS is reached.
 * 5. Re-sort kept sections by original order before joining.
 */
export function getRelevanceFilteredText(text: string, docType: string): string {
  // For extremely short documents, no filtering needed
  if (text.length <= 3000) return text;

  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let currentSection: Section = { heading: "", paragraphs: [], score: 0 };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // Skip obvious boilerplate lines
    if (BOILERPLATE.test(line.trimStart())) continue;
    // Skip very short junk lines (but not empty, which are paragraph separators)
    if (line.trim().length > 0 && line.trim().length < 15) continue;

    if (HEADING_RE.test(line.trim()) && line.trim().length > 0) {
      // Save current section
      if (currentSection.paragraphs.some(p => p.trim().length > 30)) {
        const sectionText = currentSection.heading + "\n" + currentSection.paragraphs.join("\n");
        currentSection.score = scoreText(sectionText);
        sections.push(currentSection);
      }
      currentSection = { heading: line, paragraphs: [], score: 0 };
    } else {
      currentSection.paragraphs.push(line);
    }
  }

  // Don't forget the last section
  if (currentSection.paragraphs.some(p => p.trim().length > 30)) {
    const sectionText = currentSection.heading + "\n" + currentSection.paragraphs.join("\n");
    currentSection.score = scoreText(sectionText);
    sections.push(currentSection);
  }

  // If we have fewer than 3 sections, fall back to the simpler paragraph filter
  if (sections.length < 3) {
    return paragraphFilter(text, docType);
  }

  // Sort by score descending, take highest-value sections up to budget
  const sorted = [...sections.map((s, i) => ({ ...s, originalIndex: i }))].sort((a, b) => b.score - a.score);

  const kept: number[] = [];
  let budget = MAX_FILTERED_CHARS - INSTRUCTION_OVERHEAD_CHARS;

  for (const s of sorted) {
    if (s.score === 0) continue; // Skip entirely irrelevant sections
    const sText = s.heading + "\n" + s.paragraphs.join("\n");
    if (sText.length <= budget) {
      kept.push(s.originalIndex);
      budget -= sText.length;
    }
    if (budget <= 0) break;
  }

  if (kept.length === 0) {
    // Nothing scored — fall back to paragraph filter
    return paragraphFilter(text, docType);
  }

  // Re-order by original document position
  kept.sort((a, b) => a - b);

  const result = kept
    .map(idx => {
      const s = sections[idx];
      return [s.heading, ...s.paragraphs].filter(l => l.trim().length > 0).join("\n");
    })
    .join("\n\n");

  return result.length < 500 ? paragraphFilter(text, docType) : result;
}

/**
 * Fallback paragraph-level filter (used when section detection finds <3 sections).
 */
function paragraphFilter(text: string, _docType: string): string {
  const paragraphs = text.split(/\n\s*\n|\r\n\r\n/);
  const keep = new Set<number>();

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i].trim();
    if (p.length < 30) continue;
    if (BOILERPLATE.test(p)) continue;
    if (scoreText(p) > 0) {
      keep.add(Math.max(0, i - 1));
      keep.add(i);
      keep.add(Math.min(paragraphs.length - 1, i + 1));
    }
  }

  // Always keep first 2 paragraphs (intro context)
  for (let i = 0; i < 2 && i < paragraphs.length; i++) keep.add(i);

  const result = paragraphs
    .filter((p, i) => keep.has(i) && p.trim().length > 0)
    .join("\n\n");

  // Hard budget: truncate if still over limit
  if (result.length > MAX_FILTERED_CHARS) {
    return result.slice(0, MAX_FILTERED_CHARS);
  }

  return result.length < 500 ? text.slice(0, MAX_FILTERED_CHARS) : result;
}

export function chunkText(text: string): string[] {
  // Target chunk size to fit within 1500 tokens/request
  // = ~4000 chars. With instruction overhead of ~300 chars.
  const CHUNK_SIZE = 4000;
  const OVERLAP = 200;
  const MAX_CHUNKS = 5; // Re-adjust max chunks for smaller size

  if (text.length <= CHUNK_SIZE) return [text];

  let chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + CHUNK_SIZE));
    i += (CHUNK_SIZE - OVERLAP);
  }

  if (chunks.length > MAX_CHUNKS) {
    // Adaptive: spread text across MAX_CHUNKS
    const adaptiveSize = Math.ceil((text.length - OVERLAP) / MAX_CHUNKS) + OVERLAP;
    chunks = [];
    i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + adaptiveSize));
      i += (adaptiveSize - OVERLAP);
    }
  }

  // Merge tiny tail chunk
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 800) {
    const last = chunks.pop()!;
    chunks[chunks.length - 1] += "\n" + last;
  }

  return chunks.slice(0, MAX_CHUNKS);
}

export async function analyzePolicyText(policy: PolicyDocument): Promise<PolicyAnalysis> {
  const startTime = Date.now();
  console.log(`[PrivacyLens] Analyze request received`);
  console.log(`[PrivacyLens] Policy characters: ${policy.extractedText.length}`);

  const filteredText = getRelevanceFilteredText(policy.extractedText, policy.type);
  const originalChunks = chunkText(policy.extractedText);
  const chunks = chunkText(filteredText);

  const originalChars = policy.extractedText.length;
  const filteredChars = filteredText.length;
  const reduction = originalChars > 0 ? ((originalChars - filteredChars) / originalChars * 100).toFixed(1) : '0.0';
  const originalTokens = Math.ceil(originalChars / 4);
  const filteredTokens = Math.ceil(filteredChars / 4);

  console.log(`[PrivacyLens] RELEVANCE FILTERING METRICS:
  - Original characters: ${originalChars}
  - Filtered characters: ${filteredChars}
  - Reduction %: ${reduction}%
  - Original estimated tokens: ${originalTokens}
  - Filtered estimated tokens: ${filteredTokens}
  - Original chunk count: ${originalChunks.length}
  - Filtered chunk count: ${chunks.length}`);

  console.log(`[PrivacyLens] Number of chunks: ${chunks.length}`);
  console.log(`[PrivacyLens] Concurrency: 1 (serial)`);

  const allFindings: ChunkFinding[] = [];
  const policyContext = `${policy.title || 'Privacy Policy'} from ${policy.domain}`;

  let successCount = 0;
  let skipCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalRetryTokens = 0;
  let totalRetryCount = 0;
  const chunkDurations: { chunkNum: number, durationMs: number }[] = [];

  for (let chunkNum = 1; chunkNum <= chunks.length; chunkNum++) {
    const chunk = chunks[chunkNum - 1];
    try {
      const result = await analyzeChunk(chunk, policyContext, chunkNum, chunks.length, undefined, 'DIRECT');
      if (result && result.findings) {
        allFindings.push(...result.findings);
      }
      if (result.promptTokens) totalPromptTokens += result.promptTokens;
      if (result.completionTokens) totalCompletionTokens += result.completionTokens;
      if (result.totalTokens) totalTokens += result.totalTokens;
      if (result.retryTokens) totalRetryTokens += result.retryTokens;
      if (result.retryCount) totalRetryCount += result.retryCount;

      if (result.durationMs) {
        chunkDurations.push({ chunkNum, durationMs: result.durationMs });
      }

      if (result.success) {
        successCount++;
      } else {
        skipCount++;
      }
    } catch (err: any) {
      console.error(`[PrivacyLens] Chunk ${chunkNum} unrecoverable error — skipping`, err?.message ?? err);
      skipCount++;
    }
  }

  console.log(`[PrivacyLens] Total findings before deduplication: ${allFindings.length}`);

  if (successCount === 0) {
    throw new Error("PrivacyLens could not analyze any chunks of this policy.");
  }

  const analysis = buildPolicyAnalysis(allFindings);
  const deduplicatedCount = analysis.categories.reduce((acc, cat) => acc + cat.findings.length, 0);

  const endTime = Date.now();
  const totalTime = endTime - startTime;

  chunkDurations.sort((a, b) => a.chunkNum - b.chunkNum);

  console.log(`[PrivacyLens] LATENCY REPORT:`);
  chunkDurations.forEach(c => console.log(`  - Chunk ${c.chunkNum} duration: ${c.durationMs}ms`));
  console.log(`[PrivacyLens] Total analysis time: ${totalTime}ms`);

  const avgTokens = successCount > 0 ? Math.round(totalTokens / successCount) : 0;

  console.log(`[PrivacyLens] TOKEN USAGE REPORT:`);
  console.log(`  TOTAL PROMPT TOKENS: ${totalPromptTokens}`);
  console.log(`  TOTAL COMPLETION TOKENS: ${totalCompletionTokens}`);
  console.log(`  TOTAL TOKENS: ${totalTokens}`);
  console.log(`  AVERAGE TOKENS PER SUCCESSFUL CHUNK: ${avgTokens}`);
  console.log(`  TOTAL RETRY TOKENS: ${totalRetryTokens}`);
  console.log(`  TOTAL RETRIES: ${totalRetryCount}`);

  console.log(`[PrivacyLens] SUCCESS REPORT:`);
  console.log(`  Successful chunks: ${successCount}`);
  console.log(`  Failed chunks: ${skipCount}`);
  console.log(`  Total findings after deduplication: ${deduplicatedCount}`);

  return analysis;
}
