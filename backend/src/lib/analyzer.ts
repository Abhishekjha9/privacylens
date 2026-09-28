import { PolicyDocument, PolicyAnalysis } from "../types/analysis";
import { analyzeChunk, ChunkFinding } from "./groq";
import { buildPolicyAnalysis } from "./risk-engine";

export function chunkText(text: string): string[] {
  const MAX_CHUNKS = 9;
  let chunkSize = 6000;
  let overlap = 500;
  
  let chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += (chunkSize - overlap);
  }
  
  if (chunks.length > MAX_CHUNKS) {
    chunkSize = Math.ceil((text.length - overlap) / MAX_CHUNKS) + overlap;
    chunks = [];
    i = 0;
    while (i < text.length) {
      chunks.push(text.slice(i, i + chunkSize));
      i += (chunkSize - overlap);
    }
  }
  
  if (chunks.length > 1 && chunks[chunks.length - 1].length < 1000) {
    const last = chunks.pop()!;
    chunks[chunks.length - 1] += "\\n" + last;
  }
  
  return chunks.slice(0, MAX_CHUNKS);
}

export async function analyzePolicyText(policy: PolicyDocument): Promise<PolicyAnalysis> {
  const startTime = Date.now();
  console.log(`[PrivacyLens] Analyze request received`);
  console.log(`[PrivacyLens] Policy characters: ${policy.extractedText.length}`);

  const chunks = chunkText(policy.extractedText);
  console.log(`[PrivacyLens] Number of chunks: ${chunks.length}`);

  const CONCURRENCY = 3;
  console.log(`[PrivacyLens] Concurrency: ${CONCURRENCY}`);

  const allFindings: ChunkFinding[] = [];
  const policyContext = `${policy.title || 'Privacy Policy'} from ${policy.domain}`;

  let successCount = 0;
  let skipCount = 0;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let totalRetryTokens = 0;
  let totalRetryCount = 0;
  let chunkDurations: { chunkNum: number, durationMs: number }[] = [];

  for (let i = 0; i < chunks.length; i += CONCURRENCY) {
    const batch = chunks.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (chunk, idx) => {
      const chunkNum = i + idx + 1;
      try {
        const result = await analyzeChunk(chunk, policyContext, chunkNum, chunks.length);
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
        
        console.log(`[PrivacyLens] Chunk ${chunkNum} breakdown:
  - STATIC_INSTRUCTIONS_CHARS: ${result.staticInstructionsChars}
  - POLICY_CHUNK_CHARS: ${result.policyChunkChars}
  - FINAL_PROMPT_CHARS: ${result.finalPromptChars}
  - LATENCY: ${result.durationMs}ms`);

        if (result.success) {
           successCount++;
        } else {
           skipCount++;
        }
      } catch (err: any) {
        console.error(`[PrivacyLens] Chunk ${chunkNum} unrecoverable error — skipping`, err?.message ?? err);
        skipCount++;
      }
    });
    
    await Promise.all(promises);
  }

  console.log(`[PrivacyLens] Total findings before deduplication: ${allFindings.length}`);

  if (successCount === 0) {
    throw new Error("PrivacyLens could not analyze any chunks of this policy.");
  }

  const analysis = buildPolicyAnalysis(allFindings);
  
  // To get the total findings after deduplication, we can sum them up from the categories
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
