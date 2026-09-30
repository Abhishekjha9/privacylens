import "dotenv/config";
import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "missing",
});
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

async function runTest(chars: number, format: "json_schema" | "json_object") {
  const prompt = `Analyze this. Output JSON format: {"findings":[{"category":"","severity":"","title":"","explanation":"","evidence":""}]}. Data: ` + "D".repeat(chars);
  
  const req: any = {
    messages: [{ role: "user", content: prompt }],
    model: MODEL,
    temperature: 0.1,
    max_tokens: 50,
  };

  if (format === "json_schema") {
    req.response_format = {
      type: "json_schema",
      json_schema: { 
        name: "test", 
        strict: true, 
        schema: {
          type: "object",
          properties: {
            findings: {
              type: "array",
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
        }
      }
    };
  } else {
    req.response_format = { type: "json_object" };
  }

  try {
    const chat = await groq.chat.completions.create(req);
    console.log(`Format: ${format}, PromptTokens: ${chat.usage?.prompt_tokens}`);
  } catch(e: any) {
    console.log(`Format: ${format}, ERROR: ${e.message}`);
  }
}

async function main() {
  await runTest(7000, "json_schema");
  await runTest(7000, "json_object");
}
main();
