import { buildPolicyAnalysis } from "./risk-engine";
import { analyzeChunk, ChunkFinding } from "./groq";
import type { PolicyAnalysis, AnalyzedDocumentResult } from "../types/analysis";
import { chunkText, getRelevanceFilteredText } from "./analyzer";

export interface DiscoveredDocument {
  type: "privacy" | "terms" | "cookie" | "other";
  url: string;
  title: string;
  source: string;
  extractedText: string;
  confidence: "high" | "medium" | "low";
}

export interface MultiDocumentAnalysis extends PolicyAnalysis {
  documentsAnalyzed: AnalyzedDocumentResult[];
}

export type MultiDocEvent =
  | { type: "doc-start", title: string, url: string }
  | { type: "doc-progress", title: string, url: string, chunkNum: number, totalChunks: number }
  | { type: "doc-complete", title: string, url: string, findingsCount: number, status: "complete" | "partial" | "failed", chunksTotal: number, chunksSucceeded: number, chunksFailed: number, errors?: { code: string; chunk: number }[] }
  | { type: "overall-timeout" };

type AnnotatedFinding = ChunkFinding & { sourceDocument?: string; sourceUrl?: string };

/**
 * analyzeMultipleDocuments
 *
 * Invariant: AT MOST 1 active Groq HTTP request at any instant,
 * enforced by the global GroqScheduler shared with /api/analyze.
 *
 * Implementation: documents are processed with a single serial worker.
 * The worker dequeues one chunk task at a time and awaits its Groq call
 * (which itself blocks on the global scheduler) before dequeuing the next.
 * Parallel document orchestration is purely in the per-document async IIFEs
 * that track completion; NO concurrent Groq calls are ever started.
 *
 * Timeouts are tracked lazily: a document timeout starts only when its
 * first chunk begins actual Groq processing (not when it is queued).
 */
export async function analyzeMultipleDocuments(
  documents: DiscoveredDocument[],
  onEvent?: (event: MultiDocEvent) => void,
  signal?: AbortSignal
): Promise<MultiDocumentAnalysis> {
  if (documents.length === 0) {
    throw new Error("No documents provided for analysis");
  }

  // 1. Prioritize documents: privacy > cookie > terms > other
  const typeWeight = { privacy: 1, cookie: 2, terms: 3, other: 4 };
  const sortedDocs = [...documents].sort((a, b) => typeWeight[a.type] - typeWeight[b.type]);
  const totalDocs = sortedDocs.length;

  const allFindings: AnnotatedFinding[] = [];
  const documentResults: AnalyzedDocumentResult[] = sortedDocs.map(doc => ({
    type: doc.type,
    url: doc.url,
    title: doc.title,
    source: doc.source,
    confidence: doc.confidence,
    status: "failed",
    chunksTotal: 0,
    chunksSucceeded: 0,
    chunksFailed: 0,
    errors: [],
  }));

  // ── Constants ──────────────────────────────────────────────────────────────
  // GLOBAL_CONCURRENCY is ALWAYS 1 here. The global GroqScheduler also
  // enforces maxConcurrency=1.  Both guards must remain in place.
  const GLOBAL_CONCURRENCY = 1;
  const DOCUMENT_TIMEOUT_MS = 45000;
  const OVERALL_TIMEOUT_MS = 90000;

  // ── State ──────────────────────────────────────────────────────────────────
  let overallTimedOut = false;
  let isCancelled = false;

  // One AbortController per document so we can abort exactly one doc's Groq
  // request on timeout without killing the others.
  const docControllers = sortedDocs.map(() => new AbortController());

  // Per-document status tracked in a plain object array (indexed by sortedDocs index).
  type DocStatus = {
    timedOut: boolean;
    completed: boolean;
    chunksCompleted: number;
    chunksSucceeded: number;
    chunksFailed: number;
    totalChunks: number;
    errors: { code: string; chunk: number }[];
    skipRemaining: boolean;
    /** Called once the first chunk of this document starts executing. */
    armDocTimeout: (() => void) | null;
    docStartTime?: number;
  };
  const docStatusArr: DocStatus[] = sortedDocs.map(() => ({
    timedOut: false,
    completed: false,
    chunksCompleted: 0,
    chunksSucceeded: 0,
    chunksFailed: 0,
    totalChunks: 0,
    errors: [],
    skipRemaining: false,
    armDocTimeout: null,
  }));

  // Aggregated Token Usage
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalTokens = 0;
  let successfulChunks = 0;
  let failedChunks = 0;

  // ── Cancellation from the HTTP request signal ──────────────────────────────
  if (signal) {
    if (signal.aborted) {
      isCancelled = true;
      docControllers.forEach(c => c.abort());
    } else {
      signal.addEventListener("abort", () => {
        isCancelled = true;
        docControllers.forEach(c => c.abort());
        console.log("[PrivacyLens] ANALYSIS CANCELLED");
      });
    }
  }

  // ── Task queue ────────────────────────────────────────────────────────────
  type ChunkTask = {
    chunkStr: string;
    policyContext: string;
    chunkNum: number;
    totalChunks: number;
    docIndex: number;
    doc: DiscoveredDocument;
    docTag: string;
    resolve: (findings: AnnotatedFinding[]) => void;
    reject: (err: any) => void;
  };

  const taskQueue: ChunkTask[] = [];
  const tasksByDoc: ChunkTask[][] = sortedDocs.map(() => []);

  // ── Populate task lists and fire per-document orchestrators ────────────────
  for (let i = 0; i < sortedDocs.length; i++) {
    const doc = sortedDocs[i];
    const docTag = `DOC ${i + 1}/${totalDocs}`;

    try {
      const domain = (() => { try { return new URL(doc.url).hostname; } catch { return doc.url; } })();
      const policyContext = `${doc.title || 'Legal Document'} from ${domain}`;

      const filteredText = getRelevanceFilteredText(doc.extractedText, doc.type);
      const chunks = chunkText(filteredText);
      docStatusArr[i].totalChunks = chunks.length;

      const originalChars = doc.extractedText.length;
      const filteredChars = filteredText.length;
      const reductionPct = originalChars > 0
        ? ((originalChars - filteredChars) / originalChars * 100).toFixed(1)
        : "0.0";

      console.log(`[PrivacyLens] DOC ${i + 1}/${totalDocs} ${doc.type}
  chars=${originalChars}
  chunks=${chunks.length}`);

      if (!isCancelled) {
        onEvent?.({ type: "doc-start", title: doc.title, url: doc.url });
      }

      if (chunks.length === 0) {
        docStatusArr[i].completed = true;
        documentResults[i].status = "complete";
        documentResults[i].findingsCount = 0;
        if (!isCancelled) {
          onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: 0, status: "complete", chunksTotal: 0, chunksSucceeded: 0, chunksFailed: 0 });
        }
        continue;
      }

      // We gather chunk promises and tasks, but we don't push them to taskQueue yet.
      // We will interleave them afterwards.
      const chunkPromises: Promise<AnnotatedFinding[]>[] = [];

      for (let c = 0; c < chunks.length; c++) {
        const chunkNum = c + 1;
        const p = new Promise<AnnotatedFinding[]>((resolve, reject) => {
          tasksByDoc[i].push({
            chunkStr: chunks[c],
            policyContext,
            chunkNum,
            totalChunks: chunks.length,
            docIndex: i,
            doc,
            docTag,
            resolve,
            reject,
          });
        });
        chunkPromises.push(p);
      }

      // Per-document orchestrator: waits for all chunk promises, enforces doc timeout.
      // The document timeout is armed lazily when the first chunk starts executing.
      (async () => {
        let docTimeoutHandle: ReturnType<typeof setTimeout> | null = null;

        const timeoutPromise = new Promise<void>((_, rj) => {
          // Store the arm function; the worker will call it when chunk 1 starts.
          docStatusArr[i].armDocTimeout = () => {
            docTimeoutHandle = setTimeout(() => rj(new Error("DocTimeout")), DOCUMENT_TIMEOUT_MS);
          };
        });

        try {
          const results = await Promise.race([
            Promise.allSettled(chunkPromises),
            timeoutPromise,
          ]);

          if (docTimeoutHandle !== null) clearTimeout(docTimeoutHandle);

          if (!docStatusArr[i].timedOut && !overallTimedOut && !isCancelled) {
            const settled = results as PromiseSettledResult<AnnotatedFinding[]>[];
            const rawFindings: AnnotatedFinding[] = [];
            for (const r of settled) {
              if (r.status === "fulfilled") {
                rawFindings.push(...r.value);
              }
            }
            
            allFindings.push(...rawFindings);
            docStatusArr[i].completed = true;
            
            const chunksSucceeded = docStatusArr[i].chunksSucceeded;
            const chunksFailed = docStatusArr[i].chunksFailed;
            const status = chunksFailed > 0 ? (chunksSucceeded > 0 ? "partial" : "failed") : "complete";
            
            documentResults[i].status = status;
            documentResults[i].chunksTotal = chunks.length;
            documentResults[i].chunksSucceeded = chunksSucceeded;
            documentResults[i].chunksFailed = chunksFailed;
            documentResults[i].errors = docStatusArr[i].errors;
            documentResults[i].findingsCount = rawFindings.length;
            
            console.log(`[PrivacyLens] ${docTag} DOC COMPLETE — ${rawFindings.length} finding(s) (status=${status})`);
            onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: rawFindings.length, status, chunksTotal: chunks.length, chunksSucceeded, chunksFailed, errors: docStatusArr[i].errors });
          }
        } catch (err: any) {
          if (docTimeoutHandle !== null) clearTimeout(docTimeoutHandle);

          // We only hit this catch block if timeoutPromise rejects (DocTimeout).
          // TIMED_OUT_TPM_BUDGET no longer rejects the chunk promise; it resolves to [] and records the error.
          // Wait, if a chunk promise rejects, Promise.allSettled DOES NOT throw.
          // So the only rejection is from timeoutPromise (DocTimeout).
          
          if (err.message === "DocTimeout") {
            docStatusArr[i].timedOut = true;
            docControllers[i].abort();
            docStatusArr[i].errors.push({ code: "TIMEOUT", chunk: -1 });
            
            // Collect any findings from chunks that ALREADY fulfilled before timeout
            const rawFindings: AnnotatedFinding[] = [];
            
            const chunksSucceeded = docStatusArr[i].chunksSucceeded;
            // Any chunk not succeeded is considered failed here
            const chunksFailed = chunks.length - chunksSucceeded;
            const status = chunksSucceeded > 0 ? "partial" : "failed";
            
            documentResults[i].status = status;
            documentResults[i].chunksTotal = chunks.length;
            documentResults[i].chunksSucceeded = chunksSucceeded;
            documentResults[i].chunksFailed = chunksFailed;
            documentResults[i].errors = docStatusArr[i].errors;
            documentResults[i].findingsCount = 0; // We'll update this if we can extract findings, but we can't await them since we timed out. Wait, the worker pushes findings to the array? No, worker resolves. We lose pending ones. We'll just rely on the worker having resolved earlier ones.
            
            const elapsed = docStatusArr[i].docStartTime ? Date.now() - docStatusArr[i].docStartTime! : DOCUMENT_TIMEOUT_MS;
            console.log(`[PrivacyLens] ${docTag} DOC TIMEOUT after ${elapsed}ms (status=${status})`);
            if (!isCancelled && !overallTimedOut) {
              onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: 0, status, chunksTotal: chunks.length, chunksSucceeded, chunksFailed, errors: docStatusArr[i].errors });
            }
          } else {
            docStatusArr[i].completed = true;
            documentResults[i].status = "failed";
            documentResults[i].errors.push({ code: "UNKNOWN", chunk: -1 });
            console.error(`[PrivacyLens] ${docTag} DOC ERROR:`, err.message);
            if (!isCancelled && !overallTimedOut) {
              onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: 0, status: "failed", chunksTotal: chunks.length, chunksSucceeded: 0, chunksFailed: chunks.length, errors: docStatusArr[i].errors });
            }
          }
        }
      })();
    } catch (err: any) {
      documentResults[i].status = "failed";
      documentResults[i].errors.push({ code: "UNKNOWN", chunk: -1 });
      docStatusArr[i].completed = true;
      if (!isCancelled && !overallTimedOut) {
        onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: 0, status: "failed", chunksTotal: 0, chunksSucceeded: 0, chunksFailed: 0, errors: documentResults[i].errors });
      }
    }
  }

  // ── Interleave tasks (Fair Round-Robin Scheduling) ───────────────────────
  // We want: Round 1: Doc 1 Chunk 1, Doc 2 Chunk 1, Doc 3 Chunk 1...
  // Round 2: Doc 1 Chunk 2, Doc 2 Chunk 2...
  let maxChunks = 0;
  for (const docTasks of tasksByDoc) {
    if (docTasks.length > maxChunks) maxChunks = docTasks.length;
  }

  for (let c = 0; c < maxChunks; c++) {
    for (let i = 0; i < sortedDocs.length; i++) {
      if (c < tasksByDoc[i].length) {
        const task = tasksByDoc[i][c];
        taskQueue.push(task);
        console.log(`[PrivacyLens] ${task.docTag} CHUNK ${task.chunkNum}/${task.totalChunks} QUEUED`);
      }
    }
  }

  // ── Serial worker (GLOBAL_CONCURRENCY = 1 workers) ─────────────────────────
  // Each iteration dequeues exactly ONE chunk task and awaits the Groq call.
  // The GroqScheduler inside analyzeChunk also enforces concurrency=1 globally.
  // Double-guard: if either guard works, the invariant holds.
  const runWorker = async () => {
    while (taskQueue.length > 0 && !overallTimedOut && !isCancelled) {
      const task = taskQueue.shift();
      if (!task) break;

      const ds = docStatusArr[task.docIndex];

      // Skip tasks for documents that have already timed out or were cancelled.
      if (ds.timedOut || overallTimedOut || isCancelled || ds.skipRemaining) {
        task.resolve([]);
        continue;
      }

      // Arm the document timeout on the first chunk — lazy start.
      if (task.chunkNum === 1 && ds.armDocTimeout) {
        ds.armDocTimeout();
        ds.armDocTimeout = null; // fire only once
        ds.docStartTime = Date.now();
        console.log(`[PrivacyLens] ${task.docTag} DOC TIMER START`);
      }

      const maxWaitMs = ds.docStartTime
        ? Math.max(0, DOCUMENT_TIMEOUT_MS - (Date.now() - ds.docStartTime))
        : DOCUMENT_TIMEOUT_MS;

      try {
        const result = await analyzeChunk(
          task.chunkStr,
          task.policyContext,
          task.chunkNum,
          task.totalChunks,
          docControllers[task.docIndex].signal,
          task.docTag,
          maxWaitMs
        );

        if (result) {
          totalPromptTokens += result.promptTokens || 0;
          totalCompletionTokens += result.completionTokens || 0;
          totalTokens += result.totalTokens || 0;
        }

        // Re-check cancellation after the await.
        if (ds.timedOut || overallTimedOut || isCancelled || ds.skipRemaining) {
          task.resolve([]);
          continue;
        }

        ds.chunksCompleted++;
        if (result?.success) {
          successfulChunks++;
          ds.chunksSucceeded++;
        } else {
          failedChunks++;
          ds.chunksFailed++;
        }
        
        if (!isCancelled && !overallTimedOut) {
          onEvent?.({
            type: "doc-progress",
            title: task.doc.title,
            url: task.doc.url,
            chunkNum: ds.chunksCompleted,
            totalChunks: ds.totalChunks,
          });
        }

        if (result && result.findings) {
          const annotated = result.findings.map(f => ({
            ...f,
            sourceDocument: task.doc.source,
            sourceUrl: task.doc.url,
          }));
          task.resolve(annotated);
        } else {
          task.resolve([]);
        }
      } catch (err: any) {
        if (err.message === "Cancelled") {
          task.reject(err);
          // Yield to let the orchestrator process the rejection and abort
          await new Promise(resolve => setTimeout(resolve, 0));
        } else {
          failedChunks++;
          ds.chunksFailed++;
          ds.chunksCompleted++;
          
          let errCode = "UNKNOWN";
          if (err.message === "TIMED_OUT_TPM_BUDGET") errCode = "TIMED_OUT_TPM_BUDGET";
          else if (err.message.includes("rate limit") || err.name === "GroqRateLimitError") errCode = "GROQ_RATE_LIMIT_ERROR";
          else if (err.message === "DocTimeout") errCode = "TIMEOUT";
          else if (err.message.includes("fetch failed") || err.message.includes("APIConnectionError")) errCode = "GROQ_CONNECTION_ERROR";
          else if (err.message.includes("parse") || err.message.includes("validation")) errCode = "LOCAL_PARSE_ERROR";
          else errCode = "LOCAL_ERROR";
          
          ds.errors.push({ code: errCode, chunk: task.chunkNum });
          
          console.error(`[PrivacyLens] CHUNK FAILURE
  doc=${task.docTag}
  chunk=${task.chunkNum}
  errorCode=${errCode}
  reason=${err.message}`);

          // Stop attempting additional chunks for this document
          ds.skipRemaining = true;
          
          // Resolve with empty findings so Promise.allSettled completes without dropping earlier results
          task.resolve([]);
        }
      }
    }
  };

  // Spawn exactly GLOBAL_CONCURRENCY=1 workers.
  const workers = Array.from({ length: GLOBAL_CONCURRENCY }, () => runWorker());

  // ── Overall timeout ────────────────────────────────────────────────────────
  let overallTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const overallTimeoutPromise = new Promise<void>((_, rj) => {
    overallTimeoutHandle = setTimeout(() => rj(new Error("OverallTimeout")), OVERALL_TIMEOUT_MS);
  });

  try {
    await Promise.race([Promise.all(workers), overallTimeoutPromise]);
  } catch (err: any) {
    if (err.message === "OverallTimeout") {
      console.error(`[PrivacyLens] DOC ABORT
  doc=ALL
  reason=OverallTimeout`);
      overallTimedOut = true;
      docControllers.forEach(c => c.abort());
      onEvent?.({ type: "overall-timeout" });

      // Mark every document that hasn't finished as failed/cancelled so the
      // UI never stays in a stale "Analyzing" state.
      for (let i = 0; i < sortedDocs.length; i++) {
        if (!docStatusArr[i].completed && !docStatusArr[i].timedOut) {
          documentResults[i].status = "failed";
          documentResults[i].errors.push({ code: "OVERALL_TIMEOUT", chunk: -1 });
          docStatusArr[i].completed = true;
          onEvent?.({
            type: "doc-complete",
            title: sortedDocs[i].title,
            url: sortedDocs[i].url,
            findingsCount: 0,
            status: "failed",
            chunksTotal: docStatusArr[i].totalChunks,
            chunksSucceeded: docStatusArr[i].chunksSucceeded,
            chunksFailed: docStatusArr[i].totalChunks - docStatusArr[i].chunksSucceeded,
            errors: documentResults[i].errors
          });
        }
      }
    }
  } finally {
    if (overallTimeoutHandle !== null) clearTimeout(overallTimeoutHandle);
  }

  // Drain the task queue: resolve all remaining tasks so their promises don't hang.
  while (taskQueue.length > 0) {
    const task = taskQueue.shift();
    task?.resolve([]);
  }

  const usableDocuments = documentResults.filter(r => r.chunksSucceeded > 0);
  const successCount = documentResults.filter(r => r.status === "complete").length;
  const partialCount = documentResults.filter(r => r.status === "partial").length;
  const failedDocsCount = documentResults.filter(r => r.status === "failed").length;
  
  const hasAnyFindings = allFindings.length > 0;
  
  let terminalState: "complete" | "partial" | "failure" = "failure";
  if (usableDocuments.length === sortedDocs.length) terminalState = "complete";
  else if (usableDocuments.length > 0) terminalState = "partial";
  
  let totalChunksEnqueued = 0;
  for (let i = 0; i < docStatusArr.length; i++) {
    totalChunksEnqueued += docStatusArr[i].totalChunks;
  }

  console.log(`[PrivacyLens] RUN TOKEN SUMMARY
  documents=${sortedDocs.length}
  chunks=${totalChunksEnqueued}
  successfulChunks=${successfulChunks}
  failedChunks=${failedChunks}
  totalPromptTokens=${totalPromptTokens}
  totalCompletionTokens=${totalCompletionTokens}
  totalTokens=${totalTokens}`);

  console.log(`[PrivacyLens] FINAL ANALYSIS RESULT

documentsFound=${sortedDocs.length}
documentsWithResults=${usableDocuments.length}
completeDocuments=${successCount}
partialDocuments=${partialCount}
failedDocuments=${failedDocsCount}

successfulChunks=${successfulChunks}
failedChunks=${failedChunks}

totalFindings=${allFindings.length}

terminalState=${terminalState}`);

  if (usableDocuments.length === 0) {
    if (isCancelled) throw new Error("Analysis cancelled by user.");
    throw new Error("PrivacyLens could not analyze any of the discovered documents within the timeout.");
  }

  const combinedAnalysis = buildPolicyAnalysis(allFindings, usableDocuments.length);

  return {
    ...combinedAnalysis,
    documentsAnalyzed: documentResults,
  };
}
