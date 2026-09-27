export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "NOT_FOUND";

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
}

export interface PolicyAnalysis {
  overallRisk: RiskLevel;
  summary: string;
  categories: CategoryAnalysis[];
  importantClauses: ImportantClause[];
}
