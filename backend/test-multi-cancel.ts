import "dotenv/config";
import { analyzeMultipleDocuments, DiscoveredDocument } from "./src/lib/multi-analyzer";
import fs from 'fs';

async function main() {
  const text = fs.readFileSync("/Users/abhisk/.gemini/antigravity-ide/brain/5d2a84dc-b967-4d60-8ce1-963f4fa0556c/.system_generated/steps/576/content.md", "utf-8");

  const doc1: DiscoveredDocument = {
    title: "Privacy Policy",
    url: "https://example.com/privacy",
    type: "privacy",
    confidence: "high",
    source: "Privacy Policy",
    extractedText: text
  };

  const doc2: DiscoveredDocument = {
    title: "Terms of Service",
    url: "https://example.com/terms",
    type: "terms",
    confidence: "high",
    source: "Terms of Service",
    extractedText: text
  };

  const doc3: DiscoveredDocument = {
    title: "Cookie Policy",
    url: "https://example.com/cookie",
    type: "cookie",
    confidence: "high",
    source: "Cookie Policy",
    extractedText: text
  };

  console.log("Starting multi-document analysis test...");
  
  const ac = new AbortController();
  
  setTimeout(() => {
    console.log("--- SIMULATING CANCEL AT 10 SECONDS ---");
    ac.abort();
  }, 10000);

  const start = Date.now();
  try {
    const result = await analyzeMultipleDocuments([doc1, doc2, doc3], (event) => {
      console.log(`[EVENT] ${event.type} - ${'title' in event ? event.title : ''}`);
    }, ac.signal);
    
    console.log("Success! Finished in", Date.now() - start, "ms");
    console.log(`Findings: ${result.categories.reduce((acc, cat) => acc + cat.findings.length, 0)}`);
  } catch (err: any) {
    console.log("Analysis stopped:", err.message);
  }

  // Check if anything continues logging after cancel
  console.log("Waiting 15 seconds to ensure no ghost tasks...");
  await new Promise(r => setTimeout(r, 15000));
  console.log("Done waiting.");
}

main();
