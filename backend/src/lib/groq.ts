import Groq from "groq-sdk";
import { CHUNK_ANALYSIS_PROMPT } from "./prompts";

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "missing_key",
});

export const MODEL = process.env.GROQ_MODEL || "llama-3.1-8b-instant";

export interface ChunkFinding {
  category: string;
  title: string;
  explanation: string;
  evidence: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
}

export interface ChunkAnalysisResult {
  findings: ChunkFinding[];
}

console.log(`[PrivacyLens] GROQ_API_KEY loaded: ${!!process.env.GROQ_API_KEY}`);
console.log(`[PrivacyLens] GROQ_MODEL: ${MODEL}`);

const JSON_SCHEMA = {
  type: "object",
  properties: {
    categories: {
      type: "array",
      items: { type: "string" }
    },
    severities: {
      type: "array",
      items: { type: "string" }
    },
    titles: {
      type: "array",
      items: { type: "string" }
    },
    explanations: {
      type: "array",
      items: { type: "string" }
    },
    evidence: {
      type: "array",
      items: { type: "string" }
    }
  },
  required: [
    "categories",
    "severities",
    "titles",
    "explanations",
    "evidence"
  ],
  additionalProperties: false
};

const MAX_RETRIES = 2;

const ALLOWED_CATEGORIES = [
  "data_collection",
  "data_sharing",
  "tracking",
  "permissions",
  "retention",
  "deletion",
  "ai_training",
  "subscription",
  "user_rights",
  "security",
  "legal",
  "other"
];

export async function analyzeChunk(chunkText: string, policyContext: string, chunkIndex: number = 1, totalChunks: number = 1): Promise<ChunkAnalysisResult> {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is missing. Please set it in backend/.env");
  }

  const prompt = `${CHUNK_ANALYSIS_PROMPT}\n\nDocument Context: ${policyContext}\n\nChunk to analyze:\n"""\n${chunkText}\n"""`;

  let attempt = 1;
  let lastError: any = null;

  while (attempt <= MAX_RETRIES + 1) {
    try {
      console.log(`\n[PrivacyLens] --- GROQ REQUEST ---`);
      console.log(`- Model: ${MODEL}`);
      console.log(`- Chunk Number: ${chunkIndex}/${totalChunks}`);
      console.log(`- Chunk Char Count: ${chunkText.length}`);
      console.log(`- Max Completion Tokens: 1600`);
      console.log(`- Reasoning Effort: low`);
      console.log(`- Include Reasoning: false`);
      console.log(`- Response Format Type: json_schema`);
      console.log(`- Schema Name: privacy_policy_analysis`);
      console.log(`- Strict: true`);
      console.log(`- Number of Messages: 1`);
      console.log(`- Prompt Char Count: ${prompt.length}`);
      
      console.log(`\n[PrivacyLens] Prompt preview:`);
      console.log(prompt.slice(0, 1500));
      console.log(`\n[PrivacyLens] JSON Schema:`);
      console.log(JSON.stringify(JSON_SCHEMA, null, 2));

      const chatCompletion = await groq.chat.completions.create({
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        model: MODEL,
        temperature: 0.1,
        max_tokens: 1600,
        // @ts-ignore
        include_reasoning: false,
        reasoning_effort: "low",
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "privacy_policy_analysis",
            strict: true,
            schema: JSON_SCHEMA
          }
        },
      }, { timeout: 30000 });

      const responseContent = chatCompletion.choices[0]?.message?.content;
      
      console.log(`\n[PrivacyLens] --- GROQ RESPONSE ---`);
      console.log(`- Finish Reason: ${chatCompletion.choices[0]?.finish_reason}`);
      if (chatCompletion.usage) {
        console.log(`- Usage: Prompt=${chatCompletion.usage.prompt_tokens}, Completion=${chatCompletion.usage.completion_tokens}, Total=${chatCompletion.usage.total_tokens}`);
      }

      if (!responseContent) {
        throw new Error("Groq returned an empty response.");
      }

      const parsed = JSON.parse(responseContent);
      
      const {
        categories,
        severities,
        titles,
        explanations,
        evidence
      } = parsed;

      if (!Array.isArray(categories) || !Array.isArray(severities) || !Array.isArray(titles) || !Array.isArray(explanations) || !Array.isArray(evidence)) {
        throw new Error("Invalid structured analysis: One or more properties are not arrays.");
      }

      const count = categories.length;

      if (
        severities.length !== count ||
        titles.length !== count ||
        explanations.length !== count ||
        evidence.length !== count
      ) {
        throw new Error(
          `Mismatched PrivacyLens finding arrays in chunk ${chunkIndex}: ` +
          `categories=${categories.length}, ` +
          `severities=${severities.length}, ` +
          `titles=${titles.length}, ` +
          `explanations=${explanations.length}, ` +
          `evidence=${evidence.length}`
        );
      }

      const findings: ChunkFinding[] = categories.map((category: string, index: number) => {
        const catLower = category.toLowerCase().trim();
        const sevUpper = severities[index].toUpperCase().trim();
        const t = titles[index].trim();
        const expl = explanations[index].trim();
        const ev = evidence[index].trim();

        if (!ALLOWED_CATEGORIES.includes(catLower)) {
          throw new Error(`Invalid category "${catLower}" in chunk ${chunkIndex}, index ${index}`);
        }
        if (sevUpper !== "LOW" && sevUpper !== "MEDIUM" && sevUpper !== "HIGH") {
          throw new Error(`Invalid severity "${sevUpper}" in chunk ${chunkIndex}, index ${index}`);
        }
        if (!t || !expl || !ev) {
          throw new Error(`Missing required fields in chunk ${chunkIndex}, index ${index}`);
        }

        return {
          category: catLower,
          severity: sevUpper,
          title: t,
          explanation: expl,
          evidence: ev
        } as ChunkFinding;
      });

      console.log(`[PrivacyLens] Groq response successfully parsed. ${findings.length} findings extracted.`);

      return { findings };

    } catch (error: any) {
      lastError = error;
      
      const isTransient = 
        error.status === 429 || 
        error.status === 500 || 
        error.status === 502 || 
        error.status === 503 || 
        error.name === 'APIConnectionError' || 
        error.name === 'APIConnectionTimeoutError' ||
        error.name === 'AbortError';

      if (!isTransient || attempt > MAX_RETRIES) {
        console.error(`\n[PrivacyLens] --- GROQ 400/FATAL ERROR ---`);
        if (error.status) console.error(`- Status: ${error.status}`);
        if (error.error?.code) console.error(`- Error Code: ${error.error.code}`);
        if (error.error?.message) console.error(`- Error Message: ${error.error.message}`);
        if (error.error?.failed_generation) console.error(`- Failed Generation: ${error.error.failed_generation}`);
        console.error(`- Chunk Number: ${chunkIndex}/${totalChunks}`);
        console.error(`- Chunk Char Count: ${chunkText.length}`);
        console.error(`- Max Completion Tokens: 1600`);
        console.error(`- Model: ${MODEL}`);
        console.error(`- Reasoning Effort: low`);
        
        throw error;
      }

      const delayMs = attempt === 1 ? 500 : 1000;
      console.warn(`[PrivacyLens] Transient error on attempt ${attempt}. Retrying in ${delayMs}ms...`);
      await new Promise(res => setTimeout(res, delayMs));
      attempt++;
    }
  }

  throw lastError;
}
