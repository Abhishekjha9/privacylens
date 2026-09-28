import "dotenv/config";
import { analyzePolicyText } from "../src/lib/analyzer";
import { PolicyDocument } from "../src/types/analysis";

import fs from 'fs';

async function main() {
  console.log("Testing Analyzer API with Real LinkedIn Policy...");
  
  const text = fs.readFileSync("/Users/abhisk/.gemini/antigravity-ide/brain/5d2a84dc-b967-4d60-8ce1-963f4fa0556c/.system_generated/steps/576/content.md", "utf-8");
  const chunkText = text;

  const mockPolicy: PolicyDocument = {
    title: "LinkedIn Privacy Policy",
    url: "https://www.linkedin.com/legal/privacy-policy",
    domain: "linkedin.com",
    type: "privacy-policy",
    confidence: 100,
    wordCount: chunkText.split(/\s+/).length,
    characterCount: chunkText.length,
    estimatedReadingMinutes: Math.ceil(chunkText.split(/\s+/).length / 200),
    extractedText: chunkText
  };

  const start = Date.now();
  try {
    const analysis = await analyzePolicyText(mockPolicy);
    const end = Date.now();
    console.log("Success! Full Analysis:");
    console.log(JSON.stringify(analysis, null, 2));
    console.log(`[PrivacyLens] Total analysis time: ${end - start}ms`);
  } catch (err) {
    console.error("Test failed:");
    console.error(err);
  }
}

main();
