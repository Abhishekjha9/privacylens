import { getRelevanceFilteredText, chunkText } from "../src/lib/analyzer";
import fs from 'fs';

function main() {
  const text = fs.readFileSync("/Users/abhisk/.gemini/antigravity-ide/brain/5d2a84dc-b967-4d60-8ce1-963f4fa0556c/.system_generated/steps/576/content.md", "utf-8");
  
  const originalChars = text.length;
  const originalChunks = chunkText(text).length;
  const originalTokens = Math.ceil(originalChars / 4);

  const filtered = getRelevanceFilteredText(text, 'privacy');
  
  const filteredChars = filtered.length;
  const filteredChunks = chunkText(filtered).length;
  const filteredTokens = Math.ceil(filteredChars / 4);
  const reduction = ((originalChars - filteredChars) / originalChars * 100).toFixed(2);

  console.log(`Original chars: ${originalChars}`);
  console.log(`Filtered chars: ${filteredChars}`);
  console.log(`Reduction: ${reduction}%`);
  console.log(`Original estimated tokens: ${originalTokens}`);
  console.log(`Filtered estimated tokens: ${filteredTokens}`);
  console.log(`Original chunk count: ${originalChunks}`);
  console.log(`Filtered chunk count: ${filteredChunks}`);
}

main();
