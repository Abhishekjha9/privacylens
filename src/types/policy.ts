export type PolicyType = 
  | "privacy-policy"
  | "terms-of-service"
  | "terms-and-conditions"
  | "cookie-policy"
  | "user-agreement"
  | "unknown";

/** How the extension classifies the current page */
export type PageMode =
  | "policy"       // Already on a policy/terms page → direct extraction (existing behavior)
  | "login"        // Login / signup / consent page → discovery mode
  | "unknown";     // Neither

export interface PolicyDetection {
  isPolicy: boolean;
  type: PolicyType;
  confidence: number; // 0-100
  signals: string[];
}

/** Detection result for login/signup pages */
export interface LoginPageDetection {
  isLoginPage: boolean;
  confidence: number; // 0-100
  signals: string[];
}

/** Unified page detection – resolves PageMode and any sub-detections */
export interface PageDetection {
  mode: PageMode;
  policyDetection?: PolicyDetection;
  loginDetection?: LoginPageDetection;
}

export interface PolicyDocument {
  title: string;
  url: string;
  domain: string;
  type: PolicyType;
  confidence: number;
  wordCount: number;
  characterCount: number;
  estimatedReadingMinutes: number;
  extractedText: string;
}

/** A discovered legal link found on the login/signup page */
export type DiscoveredDocType = "privacy" | "terms" | "cookie" | "other";
export type DiscoveredConfidence = "high" | "medium" | "low";

export interface DiscoveredLink {
  url: string;
  text: string;
  type: DiscoveredDocType;
  confidence: DiscoveredConfidence;
}

/** Full discovery result from the content script */
export interface DiscoveryResponse {
  links: DiscoveredLink[];
  hubCandidates: DiscoveredLink[];
  additionalCount: number;
}

/** Status of a discovered document during retrieval + analysis */
export type DiscoveredDocStatus = "waiting" | "fetching" | "analyzing" | "complete" | "partial" | "failed" | "timed_out" | "cancelled";
export interface DiscoveredDocState {
  link: DiscoveredLink;
  status: DiscoveredDocStatus;
  error?: string;
  extractedText?: string;
  title?: string;
  /** Source URL for evidence navigation */
  sourceUrl?: string;
  progress?: number;
  chunksTotal?: number;
  chunksSucceeded?: number;
  chunksFailed?: number;
}

// Extractor states
export type ExtractionState = 
  | "initial"
  | "detecting"
  | "detected"
  | "not-found"
  | "extracting"
  | "discovering"      // Discovering legal links on login page
  | "fetching"         // Fetching discovered documents in background
  | "analyzing"
  | "success"
  | "no-docs-found"    // Login page but no legal links found
  | "error"
  | "analysis-error";

// Messages passed between components
export type MessageType = 
  | { type: "PING" }
  | { type: "DETECT_POLICY" }
  | { type: "DETECT_PAGE" }
  | { type: "EXTRACT_POLICY" }
  | { type: "DISCOVER_LEGAL_LINKS" }
  | { type: "POLICY_DETECTED"; payload: PolicyDetection }
  | { type: "POLICY_EXTRACTED"; payload: PolicyDocument }
  | { type: "EXTRACTION_ERROR"; payload: string };
