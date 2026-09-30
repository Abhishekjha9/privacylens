import "dotenv/config";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "missing",
});
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

async function runTest(chars: number, useSchema: boolean) {
  const prompt = "Return a valid JSON with findings empty array. " + "A".repeat(chars);
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
    console.log(`Chars: ${chars}, Schema: ${useSchema}, PromptTokens: ${chat.usage?.prompt_tokens}`);
  } catch(e) {
    console.log(`Chars: ${chars}, Schema: ${useSchema}, ERROR`);
  }
}

async function main() {
  await runTest(7000, true);
  await runTest(4000, true);
  await runTest(7000, false);
  await runTest(4000, false);
}
main();
