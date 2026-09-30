import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeMultipleDocuments } from './multi-analyzer';
import * as chunkAnalyzer from './groq';

describe('multi-analyzer scheduling and error semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  const makeDoc = (id: string, text: string) => ({
    title: `Doc ${id}`,
    url: `https://example.com/${id}`,
    domain: 'example.com',
    type: 'privacy-policy' as any,
    confidence: 'high' as const,
    wordCount: text.split(' ').length,
    characterCount: text.length,
    estimatedReadingMinutes: 1,
    extractedText: text,
    source: id,
  });

  it('TEST 1: 2 chunks, Chunk 1 SUCCESS, Chunk 2 TIMED_OUT_TPM_BUDGET -> partial', async () => {
    // 12000 chars creates 2 chunks (since chunk size is 6000)
    const docs = [makeDoc('1', 'a'.repeat(12000))];

    const spy = vi.spyOn(chunkAnalyzer, 'analyzeChunk').mockImplementation(async (chunkStr, context, chunkNum) => {
      if (chunkNum === 1) {
        return {
          success: true,
          findings: [{ category: 'data_sharing', title: 'Test', explanation: 'exp', evidence: 'evi', severity: 'HIGH' }],
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150
        };
      } else {
        throw new Error('TIMED_OUT_TPM_BUDGET');
      }
    });

    const events: any[] = [];
    const result = await analyzeMultipleDocuments(docs, (e) => events.push(e));

    const docCompleteEvent = events.find(e => e.type === 'doc-complete');
    expect(docCompleteEvent.status).toBe('partial');
    expect(docCompleteEvent.chunksSucceeded).toBe(1);
    expect(docCompleteEvent.chunksFailed).toBe(1);
    expect(docCompleteEvent.findingsCount).toBe(1);
    
    expect(result.documentsAnalyzed[0].status).toBe('partial');
    expect(result.documentsAnalyzed[0].chunksSucceeded).toBe(1);
    expect(result.documentsAnalyzed[0].errors[0].code).toBe('TIMED_OUT_TPM_BUDGET');
    
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('TEST 2: 2 chunks, Chunk 1 SUCCESS, Chunk 2 GROQ_RATE_LIMIT_ERROR -> partial', async () => {
    const docs = [makeDoc('1', 'a'.repeat(12000))];

    const spy = vi.spyOn(chunkAnalyzer, 'analyzeChunk').mockImplementation(async (chunkStr, context, chunkNum) => {
      if (chunkNum === 1) {
        return {
          success: true,
          findings: [{ category: 'data_sharing', title: 'Test2', explanation: 'exp2', evidence: 'evi2', severity: 'MEDIUM' }],
          promptTokens: 100, completionTokens: 50, totalTokens: 150
        };
      } else {
        const err = new Error('rate limit reached');
        err.name = 'GroqRateLimitError';
        throw err;
      }
    });

    const events: any[] = [];
    const result = await analyzeMultipleDocuments(docs, (e) => events.push(e));

    expect(result.documentsAnalyzed[0].status).toBe('partial');
    expect(result.documentsAnalyzed[0].chunksSucceeded).toBe(1);
    expect(result.documentsAnalyzed[0].errors[0].code).toBe('GROQ_RATE_LIMIT_ERROR');
  });

  it('TEST 3: 2 chunks, Chunk 1 FAILED, Chunk 2 FAILED -> failed', async () => {
    const docs = [makeDoc('1', 'a'.repeat(12000))];

    vi.spyOn(chunkAnalyzer, 'analyzeChunk').mockImplementation(async () => {
      throw new Error('LOCAL_PARSE_ERROR');
    });

    try {
      await analyzeMultipleDocuments(docs, () => {});
      expect.fail('Should have thrown analysis error');
    } catch (e: any) {
      expect(e.message).toContain('could not analyze any');
    }
  });

  it('TEST 4: 3 docs, 1st chunk success, 2nd chunk timeout for all -> overall analysis does NOT fail, partial report', async () => {
    const docs = [
      makeDoc('1', 'a'.repeat(12000)),
      makeDoc('2', 'b'.repeat(12000)),
      makeDoc('3', 'c'.repeat(12000)),
    ];

    vi.spyOn(chunkAnalyzer, 'analyzeChunk').mockImplementation(async (chunkStr, context, chunkNum) => {
      if (chunkNum === 1) {
        return {
          success: true,
          findings: [{ category: 'data_sharing', title: 'Test3', explanation: 'exp3', evidence: 'evi3', severity: 'HIGH' }],
          promptTokens: 100, completionTokens: 50, totalTokens: 150
        };
      } else {
        throw new Error('TIMED_OUT_TPM_BUDGET');
      }
    });

    const events: any[] = [];
    const result = await analyzeMultipleDocuments(docs, (e) => events.push(e));

    expect(result.documentsAnalyzed).toHaveLength(3);
    for (const doc of result.documentsAnalyzed) {
      expect(doc.status).toBe('partial');
      expect(doc.chunksSucceeded).toBe(1);
      expect(doc.chunksFailed).toBe(1);
    }
  });

  it('TEST 5: all chunks fail -> overall fatal failure', async () => {
    const docs = [
      makeDoc('1', 'a'.repeat(12000)),
      makeDoc('2', 'b'.repeat(12000)),
    ];

    vi.spyOn(chunkAnalyzer, 'analyzeChunk').mockImplementation(async () => {
      throw new Error('TIMED_OUT_TPM_BUDGET');
    });

    try {
      await analyzeMultipleDocuments(docs, () => {});
      expect.fail('Should have thrown analysis error');
    } catch (e: any) {
      expect(e.message).toContain('could not analyze any of the discovered documents within the timeout');
    }
  });
});
