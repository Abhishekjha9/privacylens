export type RiskLevel = "EXPECTED" | "LOW" | "MEDIUM" | "HIGH" | "NOT_FOUND";

export type CategoryType =
  | "data_collection"
  | "data_sharing"
  | "tracking"
  | "permissions"
  | "retention"
  | "deletion"
  | "ai_training"
  | "subscription"
  | "legal";

export interface Finding {
  title: string;
  explanation: string;
  evidence: string;
  severity: RiskLevel;
  /** Which source document this finding came from (e.g. "Privacy Policy") */
  sourceDocument?: string;
  /** URL of the source document — used for evidence navigation (opens in new tab) */
  sourceUrl?: string;
}

export interface CategoryAnalysis {
  category: CategoryType;
  risk: RiskLevel;
  summary: string;
  findings: Finding[];
}

export interface ImportantClause {
  title: string;
  category: CategoryType;
  severity: RiskLevel;
  simpleExplanation: string;
  evidence: string;
  /** Which source document this clause came from */
  sourceDocument?: string;
  /** URL of the source document */
  sourceUrl?: string;
}

export interface AnalyzedDocumentResult {
  type: string;
  url: string;
  title: string;
  source: string;
  confidence: string;
  status: "complete" | "partial" | "failed";
  chunksTotal: number;
  chunksSucceeded: number;
  chunksFailed: number;
  errors: { code: string; chunk: number }[];
  findingsCount?: number;
}

export interface PolicyAnalysis {
  overallRisk: RiskLevel;
  summary: string;
  categories: CategoryAnalysis[];
  importantClauses: ImportantClause[];
  /** Present in multi-document mode — list of all attempted documents */
  documentsAnalyzed?: AnalyzedDocumentResult[];
}

export interface PolicyDocument {
  title: string;
  url: string;
  domain: string;
  type: string;
  confidence: number;
  wordCount: number;
  characterCount: number;
  estimatedReadingMinutes: number;
  extractedText: string;
}
