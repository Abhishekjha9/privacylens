import "dotenv/config";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "missing",
});
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

async function runTest(chars: number, prefixChars: number, useSchema: boolean) {
  const prefix = "You are a privacy bot. " + "P".repeat(prefixChars);
  const prompt = prefix + "\n\nData: " + "D".repeat(chars);
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

  const req: any = {
    messages: [{ role: "user", content: prompt }],
    model: MODEL,
    temperature: 0.1,
    max_tokens: 50,
  };

  if (useSchema) {
    req.response_format = {
      type: "json_schema",
      json_schema: { name: "test", strict: true, schema: JSON_SCHEMA }
    };
  }

  try {
    const chat = await groq.chat.completions.create(req);
    console.log(`PromptTokens: ${chat.usage?.prompt_tokens}, CachedTokens: ${(chat.usage as any)?.prompt_tokens_details?.cached_tokens || 0}`);
  } catch(e: any) {
    console.log(`ERROR: ${e.message}`);
  }
}

async function main() {
  console.log("Request 1 (filling cache)");
  await runTest(2000, 3000, false);
  console.log("Request 2 (should hit cache)");
  await runTest(2001, 3000, false);
}
main();
