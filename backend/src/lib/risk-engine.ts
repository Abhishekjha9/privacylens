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

// Extended ChunkFinding with source traceability
type AnnotatedFinding = ChunkFinding & { sourceDocument?: string; sourceUrl?: string };

export function buildPolicyAnalysis(findings: AnnotatedFinding[], documentCount: number = 1): PolicyAnalysis {
  const categoriesMap = new Map<CategoryType, AnnotatedFinding[]>();
  
  CATEGORIES.forEach(cat => categoriesMap.set(cat, []));

  // 1. Deduplicate findings deterministically
  const uniqueFindings: AnnotatedFinding[] = [];
  const seen = new Set<string>();
  
  for (const f of findings) {
    const normCategory = f.category.toLowerCase().trim();
    const normTitle = f.title.toLowerCase().trim();
    const normEvidence = f.evidence.toLowerCase().trim();
    
    // Unique key: category + title + evidence
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
  const highCategories: string[] = [];
  const mediumCategories: string[] = [];
  const lowCategories: string[] = [];

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

    // Category risk: highest severity among findings (deterministic)
    let catRisk: RiskLevel = "EXPECTED";
    if (catFindings.some(f => f.severity === "HIGH")) {
      catRisk = "HIGH";
      overallHigh++;
      highCategories.push(formatCategoryName(cat));
    } else if (catFindings.some(f => f.severity === "MEDIUM")) {
      catRisk = "MEDIUM";
      overallMedium++;
      mediumCategories.push(formatCategoryName(cat));
    } else if (catFindings.some(f => f.severity === "LOW")) {
      catRisk = "LOW";
      lowCategories.push(formatCategoryName(cat));
    }

    const summary = buildCategorySummary(catRisk, catFindings);

    categories.push({
      category: cat,
      risk: catRisk,
      summary,
      findings: catFindings.map(f => ({
        title: f.title,
        explanation: f.explanation,
        evidence: f.evidence,
        severity: f.severity,
        ...(f.sourceDocument ? { sourceDocument: f.sourceDocument } : {}),
        ...(f.sourceUrl ? { sourceUrl: f.sourceUrl } : {}),
      }))
    });

    // Important clauses: HIGH and MEDIUM severity items
    catFindings.filter(f => f.severity === "HIGH" || f.severity === "MEDIUM").forEach(f => {
      importantClauses.push({
        title: f.title,
        category: cat,
        severity: f.severity,
        simpleExplanation: f.explanation,
        evidence: f.evidence,
        ...(f.sourceDocument ? { sourceDocument: f.sourceDocument } : {}),
        ...(f.sourceUrl ? { sourceUrl: f.sourceUrl } : {}),
      });
    });
  }

  // Add LOW severity items to importantClauses, but at the end
  for (const [cat, catFindings] of categoriesMap.entries()) {
    catFindings.filter(f => f.severity === "LOW").forEach(f => {
      importantClauses.push({
        title: f.title,
        category: cat,
        severity: f.severity,
        simpleExplanation: f.explanation,
        evidence: f.evidence,
        ...(f.sourceDocument ? { sourceDocument: f.sourceDocument } : {}),
        ...(f.sourceUrl ? { sourceUrl: f.sourceUrl } : {}),
      });
    });
  }

  // 4. Overall risk (deterministic)
  let overallRisk: RiskLevel = "LOW";
  if (overallHigh > 0) overallRisk = "HIGH";
  else if (overallMedium > 0) overallRisk = "MEDIUM"; // Based on prompt: "Any MEDIUM = MEDIUM" conceptually, actually it says "We identified several...". Wait, "Any MEDIUM = MEDIUM" is fine for overall risk.
  else if (
    categories.every(c => c.risk === "NOT_FOUND" || c.risk === "EXPECTED") &&
    categories.some(c => c.risk === "EXPECTED")
  ) {
    // Actually the user said "LOW" if there are no meaningful concerns. "EXPECTED" should not be the overall verdict.
    overallRisk = "LOW";
  }

  // 5. Build deterministic explanation from actual findings (no AI)
  const overallSummary = buildOverallSummary(
    overallRisk,
    highCategories,
    mediumCategories,
    lowCategories,
    documentCount
  );

  return {
    overallRisk,
    summary: overallSummary,
    categories,
    importantClauses
  };
}

function formatCategoryName(cat: string): string {
  return cat.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function buildCategorySummary(risk: RiskLevel, findings: AnnotatedFinding[]): string {
  if (findings.length === 1) return findings[0].explanation;
  
  const highMedium = findings.filter(f => f.severity === "HIGH" || f.severity === "MEDIUM");
  if (highMedium.length > 0) {
    return highMedium.map(f => f.explanation).join(" ");
  }
  return findings.map(f => f.explanation).join(" ");
}

function buildOverallSummary(
  risk: RiskLevel,
  highCategories: string[],
  mediumCategories: string[],
  lowCategories: string[],
  documentCount: number
): string {
  let docContext = "";
  if (documentCount > 1) {
    docContext = `Across ${documentCount} analyzed documents, `;
  } else {
    docContext = `Based on the analyzed document, `;
  }

  if (risk === "LOW") {
    return `${docContext}no significant privacy concerns were identified.`;
  }

  const allConcerns = Array.from(new Set([...highCategories, ...mediumCategories, ...lowCategories]));
  const formattedConcerns = allConcerns.slice(0, 3).map(c => c.toLowerCase()).join(", ").replace(/, ([^,]*)$/, ' and $1');

  if (risk === "MEDIUM") {
    if (formattedConcerns) {
      return `${docContext}we identified some privacy practices that deserve attention, particularly regarding ${formattedConcerns}.`;
    }
    return `${docContext}we identified several privacy practices that deserve attention.`;
  }

  // HIGH
  if (formattedConcerns) {
    return `${docContext}several significant privacy concerns were identified, including issues with ${formattedConcerns}.`;
  }
  return `${docContext}several significant privacy concerns were identified.`;
}
