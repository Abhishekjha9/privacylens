export type PolicyType = 
  | "privacy-policy"
  | "terms-of-service"
  | "terms-and-conditions"
  | "cookie-policy"
  | "user-agreement"
  | "unknown";

export interface PolicyDetection {
  isPolicy: boolean;
  type: PolicyType;
  confidence: number; // 0-100
  signals: string[];
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

// Extractor states
export type ExtractionState = 
  | "initial"
  | "detecting"
  | "detected"
  | "not-found"
  | "extracting"
  | "success"
  | "error";

// Messages passed between components
export type MessageType = 
  | { type: "PING" }
  | { type: "DETECT_POLICY" }
  | { type: "EXTRACT_POLICY" }
  | { type: "POLICY_DETECTED"; payload: PolicyDetection }
  | { type: "POLICY_EXTRACTED"; payload: PolicyDocument }
  | { type: "EXTRACTION_ERROR"; payload: string };
