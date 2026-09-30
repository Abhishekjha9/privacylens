import * as fs from 'fs';

function estimateTokens(chars: number): number {
  // Estimated based on real run metrics:
  // Prompt tokens: chars * ~0.28 + ~70 overhead
  // Completion tokens: ~300 per chunk (assuming max findings)
  const promptTokens = Math.ceil(chars / 3.7) + 100;
  const completionTokens = 290;
  return promptTokens + completionTokens;
}

const docs = [
  { name: 'Privacy Policy', chars: 8037 },
  { name: 'Cookie Policy', chars: 9761 },
  { name: 'User Agreement', chars: 11000 } // Estimated
];

const BUDGET = 6400;

function runBenchmark(chunkSize: number) {
  const chunksPerDoc = docs.map(d => Math.ceil(d.chars / chunkSize));
  let totalAnalyzedChars = 0;
  let totalTokens = 0;
  const docAnalyzedChars = [0, 0, 0];
  const docChunksDone = [0, 0, 0];
  
  const estimatedPerChunk = estimateTokens(chunkSize);
  
  let round = 0;
  let budgetRemaining = BUDGET;
  let moreToProcess = true;

  while(budgetRemaining > 0 && moreToProcess) {
    moreToProcess = false;
    for (let i = 0; i < docs.length; i++) {
      if (docChunksDone[i] < chunksPerDoc[i]) {
        moreToProcess = true;
        
        // Calculate chars for this specific chunk
        const remainingChars = docs[i].chars - docAnalyzedChars[i];
        const charsInThisChunk = Math.min(remainingChars, chunkSize);
        
        // The token cost for the actual chunk size
        const cost = estimateTokens(charsInThisChunk);
        
        if (budgetRemaining >= cost) {
          budgetRemaining -= cost;
          totalTokens += cost;
          docAnalyzedChars[i] += charsInThisChunk;
          docChunksDone[i]++;
          totalAnalyzedChars += charsInThisChunk;
        } else {
          budgetRemaining = 0; // Exhausted
          break;
        }
      }
    }
    round++;
  }

  console.log(`\n--- CHUNK SIZE: ${chunkSize} ---`);
  console.log(`Estimated Avg Tokens/Chunk: ${estimatedPerChunk}`);
  console.log(`Total First-Round Tokens: ${totalTokens}`);
  console.log(`Remaining Budget: ${budgetRemaining}`);
  console.log(`Total Analyzed Chars: ${totalAnalyzedChars} / ${docs.reduce((a, b) => a + b.chars, 0)}`);
  for (let i = 0; i < docs.length; i++) {
    console.log(`  ${docs[i].name}: ${docChunksDone[i]}/${chunksPerDoc[i]} chunks (${Math.round((docAnalyzedChars[i]/docs[i].chars)*100)}%)`);
  }
}

const sizes = [3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000];
for (const size of sizes) {
  runBenchmark(size);
}
