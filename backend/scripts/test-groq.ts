import "dotenv/config";

import { analyzeChunk } from "../src/lib/groq";

async function main() {
  console.log("Testing Groq...");
  try {
    const result = await analyzeChunk(
      "We may share your personal information with third-party advertising partners.",
      "Privacy Policy from test.com"
    );
    console.log("Success! Result:");
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error("Test failed:", err);
  }
}

main();
