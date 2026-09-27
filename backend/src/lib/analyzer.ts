import { PolicyDocument, PolicyAnalysis } from "../types/analysis";
import { analyzeChunk, ChunkFinding } from "./groq";
import { buildPolicyAnalysis } from "./risk-engine";

// Reusing logic from Phase 1 extension chunker
export function chunkText(text: string, chunkSize: number = 6000, overlap: number = 500): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += (chunkSize - overlap);
  }
  return chunks;
}

export async function analyzePolicyText(policy: PolicyDocument): Promise<PolicyAnalysis> {
  console.log(`[PrivacyLens] Analyze request received`);
  console.log(`[PrivacyLens] Policy characters: ${policy.extractedText.length}`);

  const chunks = chunkText(policy.extractedText, 6000);
  console.log(`[PrivacyLens] Chunks: ${chunks.length}`);
  
  const allFindings: ChunkFinding[] = [];
  const policyContext = `${policy.title || 'Privacy Policy'} from ${policy.domain}`;

  for (let i = 0; i < chunks.length; i++) {
    console.log(`[PrivacyLens] Sending chunk ${i + 1}/${chunks.length} to Groq`);
    try {
      const result = await analyzeChunk(chunks[i], policyContext, i + 1, chunks.length);
      if (result && result.findings) {
        allFindings.push(...result.findings);
      }
    } catch (err: any) {
      const errorMsg = `AI analysis failed on chunk ${i + 1} of ${chunks.length}`;
      console.error(`[PrivacyLens] ${errorMsg}`, err);
      throw new Error(errorMsg);
    }
  }

  console.log(`[PrivacyLens] Analysis merged. Building final analysis...`);
  return buildPolicyAnalysis(allFindings);
}
