import { describe, it, expect } from "vitest";
import { buildPolicyAnalysis } from "./risk-engine";
import { ChunkFinding } from "./groq";

describe("Risk Engine", () => {
  it("should merge duplicate findings based on exact evidence", () => {
    const findings: ChunkFinding[] = [
      {
        category: "data_sharing",
        title: "Shares data with advertisers",
        explanation: "They share data.",
        evidence: "We share data with our partners.",
        severity: "HIGH"
      },
      {
        category: "data_sharing",
        title: "Shares data with advertisers",
        explanation: "They share data.",
        evidence: "We share data with our partners.",
        severity: "HIGH"
      }
    ];

    const result = buildPolicyAnalysis(findings);
    const cat = result.categories.find(c => c.category === "data_sharing");
    
    expect(cat?.findings.length).toBe(1);
    expect(cat?.risk).toBe("HIGH");
  });

  it("should determine category risk based on highest severity finding", () => {
    const findings: ChunkFinding[] = [
      {
        category: "data_collection",
        title: "Low risk collection",
        explanation: "x",
        evidence: "x",
        severity: "LOW"
      },
      {
        category: "data_collection",
        title: "High risk collection",
        explanation: "y",
        evidence: "y",
        severity: "HIGH"
      }
    ];

    const result = buildPolicyAnalysis(findings);
    const cat = result.categories.find(c => c.category === "data_collection");
    
    expect(cat?.risk).toBe("HIGH");
  });

  it("should handle NOT_FOUND categories correctly", () => {
    const findings: ChunkFinding[] = [];
    const result = buildPolicyAnalysis(findings);
    
    expect(result.categories.every(c => c.risk === "NOT_FOUND")).toBe(true);
    expect(result.overallRisk).toBe("LOW"); // Minimal risk explicitly stated
  });
});
