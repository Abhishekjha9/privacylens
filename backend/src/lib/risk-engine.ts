import { ChunkFinding } from "./groq";
import { CategoryType, CategoryAnalysis, RiskLevel, ImportantClause, PolicyAnalysis } from "../types/analysis";

const CATEGORIES: CategoryType[] = [
  "data_collection",
  "data_sharing",
  "tracking",
  "permissions",
  "retention",
  "deletion",
  "ai_training",
  "subscription",
  "legal",
];

export function buildPolicyAnalysis(findings: ChunkFinding[]): PolicyAnalysis {
  const categoriesMap = new Map<CategoryType, ChunkFinding[]>();
  
  CATEGORIES.forEach(cat => categoriesMap.set(cat, []));

  // 1. Deduplicate findings deterministically
  const uniqueFindings: ChunkFinding[] = [];
  const seen = new Set<string>();
  
  for (const f of findings) {
    const normCategory = f.category.toLowerCase().trim();
    const normTitle = f.title.toLowerCase().trim();
    const normEvidence = f.evidence.toLowerCase().trim();
    
    // Create a unique key for deduplication
    const key = `${normCategory}::${normTitle}::${normEvidence}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      uniqueFindings.push(f);
    }
  }

  // 1.5 Group findings by category
  uniqueFindings.forEach(finding => {
    const cat = finding.category as CategoryType;
    if (categoriesMap.has(cat)) {
      categoriesMap.get(cat)!.push(finding);
    }
  });

  // 2. Build CategoryAnalysis
  const categories: CategoryAnalysis[] = [];
  const importantClauses: ImportantClause[] = [];
  
  let overallHigh = 0;
  let overallMedium = 0;

  for (const [cat, catFindings] of categoriesMap.entries()) {
    if (catFindings.length === 0) {
      categories.push({
        category: cat,
        risk: "NOT_FOUND",
        summary: "No relevant explicit statements were found in the policy regarding this category.",
        findings: []
      });
      continue;
    }

    // Determine category risk deterministically: highest severity of findings
    let catRisk: RiskLevel = "EXPECTED";
    if (catFindings.some(f => f.severity === "HIGH")) {
      catRisk = "HIGH";
      overallHigh++;
    } else if (catFindings.some(f => f.severity === "MEDIUM")) {
      catRisk = "MEDIUM";
      overallMedium++;
    } else if (catFindings.some(f => f.severity === "LOW")) {
      catRisk = "LOW";
    }

    const summary = buildCategorySummary(cat, catRisk, catFindings);

    categories.push({
      category: cat,
      risk: catRisk,
      summary,
      findings: catFindings.map(f => ({
        title: f.title,
        explanation: f.explanation,
        evidence: f.evidence,
        severity: f.severity
      }))
    });

    // 3. Extract important clauses (HIGH severity items)
    catFindings.filter(f => f.severity === "HIGH").forEach(f => {
      importantClauses.push({
        title: f.title,
        category: cat,
        severity: f.severity,
        simpleExplanation: f.explanation,
        evidence: f.evidence
      });
    });
  }

  // 4. Determine overall risk deterministically
  let overallRisk: RiskLevel = "LOW";
  if (overallHigh > 0) overallRisk = "HIGH";
  else if (overallMedium > 2) overallRisk = "MEDIUM";
  else if (categories.every(c => c.risk === "NOT_FOUND" || c.risk === "EXPECTED") && categories.some(c => c.risk === "EXPECTED")) {
    overallRisk = "EXPECTED";
  }

  const overallSummary = buildOverallSummary(overallRisk, overallHigh, importantClauses.length);

  return {
    overallRisk,
    summary: overallSummary,
    categories,
    importantClauses
  };
}

function buildCategorySummary(cat: CategoryType, risk: RiskLevel, findings: ChunkFinding[]): string {
  if (findings.length === 1) return findings[0].explanation;
  
  // Create a useful summary based on the actual findings
  const highMedium = findings.filter(f => f.severity === "HIGH" || f.severity === "MEDIUM");
  
  if (highMedium.length > 0) {
    return highMedium.map(f => f.explanation).join(" ");
  }

  return findings.map(f => f.explanation).join(" ");
}

function buildOverallSummary(risk: RiskLevel, highCount: number, clauseCount: number): string {
  if (risk === "HIGH") {
    return `This policy contains ${highCount} high-risk categories and ${clauseCount} important clauses that require your attention.`;
  }
  if (risk === "MEDIUM") {
    return `This policy contains standard data practices but includes some medium-risk clauses regarding tracking or data usage.`;
  }
  return `This policy appears to have minimal risk indicators based on explicit statements.`;
}
