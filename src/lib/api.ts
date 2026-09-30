import type { PolicyDocument } from '../types/policy';
import type { PolicyAnalysis } from '../types/analysis';

// Use a configurable URL or fallback to localhost for development
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Existing: single policy document analysis (direct policy page mode)
// ---------------------------------------------------------------------------

export async function analyzePolicy(policy: PolicyDocument): Promise<PolicyAnalysis> {
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policy }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Analysis failed with status: ${response.status}`);
  }

  return response.json() as Promise<PolicyAnalysis>;
}

// ---------------------------------------------------------------------------
// New: fetch a discovered document URL via backend (SSRF-protected)
// ---------------------------------------------------------------------------

export interface FetchedDocument {
  text: string;
  title: string;
  finalUrl: string;
  contentFingerprint: string;
}

export async function fetchDocumentViaBackend(url: string): Promise<FetchedDocument> {
  const response = await fetch(`${API_URL}/api/fetch-document`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Fetch failed with status: ${response.status}`);
  }

  return response.json() as Promise<FetchedDocument>;
}

// ---------------------------------------------------------------------------
// New: discover links from a legal hub page via backend
// ---------------------------------------------------------------------------

export interface HubDiscoveryLink {
  url: string;
  text: string;
  type: 'privacy' | 'terms' | 'cookie';
  confidence: 'high' | 'medium';
}

export interface HubDiscoveryResult {
  links: HubDiscoveryLink[];
  hubTitle: string;
}

export async function discoverHubLinks(hubUrl: string): Promise<HubDiscoveryResult> {
  const response = await fetch(`${API_URL}/api/discover-hub`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hubUrl }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Hub discovery failed with status: ${response.status}`);
  }

  return response.json() as Promise<HubDiscoveryResult>;
}

// ---------------------------------------------------------------------------
// New: multi-document analysis (login/signup discovery mode)
// ---------------------------------------------------------------------------

export interface MultiDocumentInput {
  type: 'privacy' | 'terms' | 'cookie' | 'other';
  url: string;
  title: string;
  source: string;
  extractedText: string;
  confidence: 'high' | 'medium' | 'low';
}

export async function analyzeMultipleDocuments(
  documents: MultiDocumentInput[],
  onEvent?: (event: any) => void,
  signal?: AbortSignal
): Promise<PolicyAnalysis> {
  const response = await fetch(`${API_URL}/api/analyze-multi`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents }),
    signal
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Multi-document analysis failed with status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Response body is missing");
  
  const decoder = new TextDecoder();
  let buffer = '';
  let finalAnalysis: PolicyAnalysis | null = null;
  let hasError = false;
  let errorMessage = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        try {
          const event = JSON.parse(line);
          onEvent?.(event);
          if (event.type === 'complete') {
            finalAnalysis = event.analysis;
          } else if (event.type === 'error') {
            hasError = true;
            errorMessage = event.error;
          }
        } catch (e) {
          console.warn("Failed to parse stream event", e);
        }
      }
    }
  }

  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer);
      onEvent?.(event);
      if (event.type === 'complete') {
        finalAnalysis = event.analysis;
      } else if (event.type === 'error') {
        hasError = true;
        errorMessage = event.error;
      }
    } catch (e) {}
  }

  if (hasError) throw new Error(errorMessage || "Analysis failed");
  if (!finalAnalysis) throw new Error("Stream ended without complete analysis");
  
  return finalAnalysis;
}
