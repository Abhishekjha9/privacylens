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
  | { type: "doc-complete", title: string, url: string, findingsCount: number, success: boolean, error?: string, timedOut?: boolean }
  | { type: "overall-timeout" };

type AnnotatedFinding = ChunkFinding & { sourceDocument?: string; sourceUrl?: string };

type ChunkTask = {
  chunkStr: string;
  policyContext: string;
  chunkNum: number;
  totalChunks: number;
  docIndex: number;
  doc: DiscoveredDocument;
  resolve: (findings: AnnotatedFinding[]) => void;
  reject: (err: any) => void;
};

export async function analyzeMultipleDocuments(
  documents: DiscoveredDocument[],
  onEvent?: (event: MultiDocEvent) => void,
  signal?: AbortSignal
): Promise<MultiDocumentAnalysis> {
  if (documents.length === 0) {
    throw new Error("No documents provided for analysis");
  }

  // 1. Prioritize documents: privacy > terms > cookie > other
  const typeWeight = { privacy: 1, terms: 2, cookie: 3, other: 4 };
  const sortedDocs = [...documents].sort((a, b) => typeWeight[a.type] - typeWeight[b.type]);

  const allFindings: AnnotatedFinding[] = [];
  const documentResults: AnalyzedDocumentResult[] = sortedDocs.map(doc => ({
    type: doc.type,
    url: doc.url,
    title: doc.title,
    source: doc.source,
    confidence: doc.confidence,
    success: false
  }));

  const GLOBAL_CONCURRENCY = 1;
  const DOCUMENT_TIMEOUT_MS = 45000;
  const OVERALL_TIMEOUT_MS = 90000;
  
  let overallTimedOut = false;
  let isCancelled = false;
  
  const docStatus = new Map<number, { timedOut: boolean, completed: boolean, chunksCompleted: number, totalChunks: number }>();
  const taskQueue: ChunkTask[] = [];
  
  // Abort controller logic
  if (signal) {
    if (signal.aborted) isCancelled = true;
    signal.addEventListener("abort", () => {
      isCancelled = true;
    });
  }

  for (let i = 0; i < sortedDocs.length; i++) {
    const doc = sortedDocs[i];
    docStatus.set(i, { timedOut: false, completed: false, chunksCompleted: 0, totalChunks: 0 });
    
    try {
      const domain = (() => { try { return new URL(doc.url).hostname; } catch { return doc.url; } })();
      const policyContext = `${doc.title || 'Legal Document'} from ${domain}`;
      
      const filteredText = getRelevanceFilteredText(doc.extractedText, doc.type);
      const chunks = chunkText(filteredText);
      docStatus.get(i)!.totalChunks = chunks.length;
      
      if (!isCancelled) {
        onEvent?.({ type: "doc-start", title: doc.title, url: doc.url });
      }
      
      if (chunks.length === 0) {
         docStatus.get(i)!.completed = true;
         documentResults[i].success = true;
         documentResults[i].findingsCount = 0;
         if (!isCancelled) {
           onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: 0, success: true });
         }
         continue;
      }
      
      const chunkPromises: Promise<AnnotatedFinding[]>[] = [];
      
      for (let c = 0; c < chunks.length; c++) {
        const p = new Promise<AnnotatedFinding[]>((resolve, reject) => {
          taskQueue.push({
            chunkStr: chunks[c],
            policyContext,
            chunkNum: c + 1,
            totalChunks: chunks.length,
            docIndex: i,
            doc,
            resolve,
            reject
          });
        });
        chunkPromises.push(p);
      }
      
      (async () => {
        try {
          const timeoutPromise = new Promise<void>((_, rj) => setTimeout(() => rj(new Error("Timeout")), DOCUMENT_TIMEOUT_MS));
          const results = await Promise.race([Promise.all(chunkPromises), timeoutPromise]);
          if (!docStatus.get(i)!.timedOut && !overallTimedOut && !isCancelled) {
            const rawFindings = (results as AnnotatedFinding[][]).flat();
            allFindings.push(...rawFindings);
            docStatus.get(i)!.completed = true;
            documentResults[i].success = true;
            documentResults[i].findingsCount = rawFindings.length;
            onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: rawFindings.length, success: true });
          }
        } catch (err: any) {
           if (err.message === "Timeout") {
              docStatus.get(i)!.timedOut = true;
              documentResults[i].success = false;
              documentResults[i].error = "Analysis timed out";
              if (!isCancelled && !overallTimedOut) {
                onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: 0, success: false, timedOut: true });
              }
           } else {
              docStatus.get(i)!.completed = true;
              documentResults[i].success = false;
              documentResults[i].error = err.message;
              if (!isCancelled && !overallTimedOut) {
                onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: 0, success: false, error: err.message });
              }
           }
        }
      })();
      
    } catch (err: any) {
      documentResults[i].success = false;
      documentResults[i].error = err.message;
      docStatus.get(i)!.completed = true;
      if (!isCancelled && !overallTimedOut) {
        onEvent?.({ type: "doc-complete", title: doc.title, url: doc.url, findingsCount: 0, success: false, error: err.message });
      }
    }
  }

  const workers = Array(GLOBAL_CONCURRENCY).fill(0).map(async () => {
    while (taskQueue.length > 0 && !overallTimedOut && !isCancelled) {
      const task = taskQueue.shift();
      if (!task) break;
      
      if (docStatus.get(task.docIndex)?.timedOut || overallTimedOut || isCancelled) {
         task.resolve([]); 
         continue;
      }
      
      try {
        const result = await analyzeChunk(task.chunkStr, task.policyContext, task.chunkNum, task.totalChunks, signal);
        if (docStatus.get(task.docIndex)?.timedOut || overallTimedOut || isCancelled) {
           task.resolve([]); 
           continue;
        }
        
        const status = docStatus.get(task.docIndex)!;
        status.chunksCompleted++;
        onEvent?.({ type: "doc-progress", title: task.doc.title, url: task.doc.url, chunkNum: status.chunksCompleted, totalChunks: status.totalChunks });
        
        if (result && result.findings) {
           const annotated = result.findings.map(f => ({
             ...f,
             sourceDocument: task.doc.source,
             sourceUrl: task.doc.url
           }));
           task.resolve(annotated);
        } else {
           task.resolve([]);
        }
      } catch (err: any) {
        task.resolve([]); 
      }
    }
  });
  
  const overallTimeoutPromise = new Promise<void>((_, rj) => setTimeout(() => rj(new Error("OverallTimeout")), OVERALL_TIMEOUT_MS));
  
  try {
     await Promise.race([Promise.all(workers), overallTimeoutPromise]);
  } catch (err: any) {
     if (err.message === "OverallTimeout") {
        overallTimedOut = true;
        onEvent?.({ type: "overall-timeout" });
     }
  }

  // Allow tasks to flush
  await new Promise(res => setTimeout(res, 100));

  const successCount = documentResults.filter((r) => r.success).length;
  if (successCount === 0) {
    if (isCancelled) throw new Error("Analysis cancelled by user.");
    throw new Error("PrivacyLens could not analyze any of the discovered documents within the timeout.");
  }

  const combinedAnalysis = buildPolicyAnalysis(allFindings, successCount);

  return {
    ...combinedAnalysis,
    documentsAnalyzed: documentResults,
  };
}
