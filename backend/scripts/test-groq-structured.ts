import "dotenv/config";
import Groq from "groq-sdk";
import fs from "fs";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function runTest(name: string, schema: any, text: string) {
  console.log(`\n--- RUNNING ${name} ---`);
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: `Analyze this privacy-policy text and return any important privacy concerns as short strings. If there are none, return an empty findings array.\n\nText:\n${text}`
        }
      ],
      model: "openai/gpt-oss-20b",
      temperature: 0.1,
      max_tokens: 2000,
      // @ts-ignore
      include_reasoning: false,
      reasoning_effort: "low",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "privacy_findings",
          strict: true,
          schema: schema
        }
      },
    });

    console.log(`[${name}] Finish Reason: ${chatCompletion.choices[0]?.finish_reason}`);
    if (chatCompletion.usage) {
      console.log(`[${name}] Completion Tokens: ${chatCompletion.usage.completion_tokens}`);
    }
    console.log(`[${name}] Parsed JSON:`);
    console.log(chatCompletion.choices[0]?.message?.content);
    return true;
  } catch (err: any) {
    console.error(`[${name}] FAILED:`);
    if (err.status) console.error("Status:", err.status);
    if (err.error) console.error("Error payload:", JSON.stringify(err.error, null, 2));
    else console.error(err);
    return false;
  }
}

async function main() {
  const dummyText = "This website collects personal information including your name and email address.";
  
  const SCHEMA_A = {
    type: "object",
    properties: {
      findings: { type: "array", items: { type: "string" } }
    },
    required: ["findings"],
    additionalProperties: false
  };

  const passA = await runTest("TEST A: Minimal Schema", SCHEMA_A, dummyText);

  const SCHEMA_B = {
    type: "object",
    properties: {
      findings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            category: {
              type: "string",
              enum: [
                "DATA_COLLECTION", "DATA_SHARING", "TRACKING", "RETENTION", 
                "USER_RIGHTS", "SECURITY", "SUBSCRIPTIONS", "LEGAL", "OTHER"
              ]
            },
            severity: {
              type: "string",
              enum: ["LOW", "MEDIUM", "HIGH"]
            },
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

  const passB = await runTest("TEST B: Finding Object Schema", SCHEMA_B, dummyText);

  // Test C: Real 6000-char chunk
  let realText = dummyText;
  try {
    const fullText = fs.readFileSync("/Users/abhisk/.gemini/antigravity-ide/brain/5d2a84dc-b967-4d60-8ce1-963f4fa0556c/.system_generated/steps/576/content.md", "utf-8");
    realText = fullText.substring(0, 6000);
  } catch (e) {}

  const passC = await runTest("TEST C: Real 6000-char chunk", SCHEMA_B, realText);

  console.log("\n--- FINAL REPORT ---");
  console.log(`TEST A: minimal schema — ${passA ? "PASS" : "FAIL"}`);
  console.log(`TEST B: finding object schema — ${passB ? "PASS" : "FAIL"}`);
  console.log(`TEST C: real 6,000-char chunk — ${passC ? "PASS" : "FAIL"}`);
}

main();
