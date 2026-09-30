import { chunkText } from './backend/src/lib/analyzer';
import * as fs from 'fs';
import * as path from 'path';

// Let's use the real linkedin policy
const policyHtml = fs.readFileSync('./backend/scripts/linkedin-policy.html', 'utf-8');
const { extractTextFromHtml } = require('./backend/src/lib/fetch-document');
const text = extractTextFromHtml(policyHtml);
console.log(`Original Text Length: ${text.length}`);

const oldChunks = chunkText(text);
console.log(`Old Chunk count: ${oldChunks.length}`);
