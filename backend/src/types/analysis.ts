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
  /** Which source document this finding came from (multi-doc mode) */
  sourceDocument?: string;
  /** URL of the source document for evidence navigation */
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
  sourceDocument?: string;
  sourceUrl?: string;
}

export interface AnalyzedDocumentResult {
  type: string;
  url: string;
  title: string;
  source: string;
  confidence: string;
  success: boolean;
  error?: string;
  findingsCount?: number;
}

export interface PolicyAnalysis {
  overallRisk: RiskLevel;
  summary: string;
  categories: CategoryAnalysis[];
  importantClauses: ImportantClause[];
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
