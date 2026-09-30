/**
 * Multi-document analysis tests.
 * Tests: sourceDocument traceability, document count, partial failures,
 *        risk aggregation, deduplication across documents.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPolicyAnalysis } from './risk-engine';
import type { ChunkFinding } from './groq';

// ---------------------------------------------------------------------------
// Test 31: sourceDocument survives aggregation in risk engine
// ---------------------------------------------------------------------------

describe('sourceDocument traceability through risk engine', () => {
  it('preserves sourceDocument on all findings after aggregation', () => {
    const findings: (ChunkFinding & { sourceDocument?: string; sourceUrl?: string })[] = [
      {
        category: 'data_sharing',
        title: 'Shares data with ad partners',
        explanation: 'Data is shared for advertising.',
        evidence: 'We share your data with advertising partners.',
        severity: 'HIGH',
        sourceDocument: 'Privacy Policy',
        sourceUrl: 'https://example.com/privacy',
      },
      {
        category: 'tracking',
        title: 'Cross-site tracking',
        explanation: 'Tracks users across sites.',
        evidence: 'We use cookies to track your activity across websites.',
        severity: 'MEDIUM',
        sourceDocument: 'Cookie Policy',
        sourceUrl: 'https://example.com/cookies',
      },
    ];

    const result = buildPolicyAnalysis(findings);

    const sharingCat = result.categories.find(c => c.category === 'data_sharing');
    expect(sharingCat?.findings[0].sourceDocument).toBe('Privacy Policy');
    expect(sharingCat?.findings[0].sourceUrl).toBe('https://example.com/privacy');

    const trackingCat = result.categories.find(c => c.category === 'tracking');
    expect(trackingCat?.findings[0].sourceDocument).toBe('Cookie Policy');
    expect(trackingCat?.findings[0].sourceUrl).toBe('https://example.com/cookies');

    // importantClauses (HIGH) should also carry sourceDocument + sourceUrl
    const highClause = result.importantClauses.find(c => c.title === 'Shares data with ad partners');
    expect(highClause?.sourceDocument).toBe('Privacy Policy');
    expect(highClause?.sourceUrl).toBe('https://example.com/privacy');
  });

  it('preserves sourceDocument when multiple documents share a category', () => {
    const findings: (ChunkFinding & { sourceDocument?: string })[] = [
      {
        category: 'data_collection',
        title: 'Account data collected',
        explanation: 'Collects name and email.',
        evidence: 'We collect your name and email address.',
        severity: 'LOW',
        sourceDocument: 'Privacy Policy',
      },
      {
        category: 'data_collection',
        title: 'Usage data collected',
        explanation: 'Collects usage analytics.',
        evidence: 'We collect usage data to improve our service.',
        severity: 'EXPECTED',
        sourceDocument: 'Terms of Service',
      },
    ];

    const result = buildPolicyAnalysis(findings);
    const dataCat = result.categories.find(c => c.category === 'data_collection');

    expect(dataCat?.findings.length).toBe(2);
    // Both source documents preserved
    const sources = dataCat?.findings.map(f => f.sourceDocument);
    expect(sources).toContain('Privacy Policy');
    expect(sources).toContain('Terms of Service');
  });
});

// ---------------------------------------------------------------------------
// Test 26-30: risk engine edge cases for multi-doc scenarios
// ---------------------------------------------------------------------------

describe('Risk engine — multi-document scenarios', () => {
  // Test 26: Three successful documents combined
  it('correctly aggregates findings from 3 distinct documents', () => {
    const findings: (ChunkFinding & { sourceDocument?: string })[] = [
      {
        category: 'data_sharing', title: 'Ad tracking', explanation: 'x', evidence: 'We share with advertisers',
        severity: 'HIGH', sourceDocument: 'Privacy Policy',
      },
      {
        category: 'tracking', title: 'Behavioral tracking', explanation: 'y', evidence: 'We track behavior',
        severity: 'MEDIUM', sourceDocument: 'Cookie Policy',
      },
      {
        category: 'retention', title: 'Long retention', explanation: 'z', evidence: 'We keep data for 5 years',
        severity: 'MEDIUM', sourceDocument: 'Terms of Service',
      },
    ];

    const result = buildPolicyAnalysis(findings);
    expect(result.overallRisk).toBe('HIGH'); // At least one HIGH finding
    expect(result.importantClauses.length).toBeGreaterThan(0);
  });

  // Test 30: Duplicate findings are deduplicated across documents
  it('deduplicates identical findings from two documents', () => {
    const sharedFinding = {
      category: 'data_sharing',
      title: 'Shares with partners',
      explanation: 'Data shared with partners.',
      evidence: 'We share your information with trusted partners.',
      severity: 'HIGH' as const,
    };

    const findings: (ChunkFinding & { sourceDocument?: string })[] = [
      { ...sharedFinding, sourceDocument: 'Privacy Policy' },
      { ...sharedFinding, sourceDocument: 'Terms of Service' }, // exact same evidence
    ];

    const result = buildPolicyAnalysis(findings);
    const cat = result.categories.find(c => c.category === 'data_sharing');

    // Should be deduped to 1 finding (same title+evidence+category key)
    expect(cat?.findings.length).toBe(1);
  });

  // Test 32: correct document count in risk engine output
  it('includes all documents in documentsAnalyzed when injected', () => {
    // buildPolicyAnalysis doesn't include documentsAnalyzed itself — that's added by multi-analyzer.
    // Here we test that the risk engine output has the correct finding counts.
    const findings: (ChunkFinding & { sourceDocument?: string })[] = [
      { category: 'data_collection', title: 'Name collected', explanation: 'x', evidence: 'We collect name', severity: 'LOW', sourceDocument: 'Privacy Policy' },
      { category: 'data_collection', title: 'Email collected', explanation: 'y', evidence: 'We collect email', severity: 'LOW', sourceDocument: 'Terms of Service' },
    ];

    const result = buildPolicyAnalysis(findings);
    const cat = result.categories.find(c => c.category === 'data_collection');
    expect(cat?.findings.length).toBe(2);
  });

  // Test — partial failure: findings from succeeded docs still processed
  it('processes findings from succeeded docs even if some are empty', () => {
    // Simulates one document failing (providing zero findings) and one succeeding
    const findings: ChunkFinding[] = [
      { category: 'data_sharing', title: 'Share', explanation: 'x', evidence: 'shares data', severity: 'HIGH' },
    ];

    const result = buildPolicyAnalysis(findings);
    expect(result.overallRisk).toBe('HIGH');
  });
});

// ---------------------------------------------------------------------------
// Test 29: AI chunk failure simulation — risk engine still works with partial findings
// ---------------------------------------------------------------------------

describe('Risk engine — resilience with partial findings', () => {
  it('produces a valid result with empty findings (simulates all chunks failed)', () => {
    const result = buildPolicyAnalysis([]);
    expect(result.categories).toHaveLength(9); // All categories present
    expect(result.categories.every(c => c.risk === 'NOT_FOUND')).toBe(true);
    expect(result.overallRisk).toBe('LOW');
  });

  it('produces correct overall risk with mixed severities', () => {
    const findings: ChunkFinding[] = [
      { category: 'data_collection', title: 'a', explanation: 'x', evidence: 'collects data', severity: 'EXPECTED' },
      { category: 'tracking', title: 'b', explanation: 'y', evidence: 'no tracking', severity: 'EXPECTED' },
    ];

    const result = buildPolicyAnalysis(findings);
    expect(result.overallRisk).toBe('LOW');
    expect(result.summary).toContain('no significant privacy concerns were identified');
  });
});

// ---------------------------------------------------------------------------
// Deterministic risk explanation tests
// ---------------------------------------------------------------------------

describe('Deterministic risk explanations', () => {
  it('includes HIGH category names in the summary', () => {
    const findings: (ChunkFinding & { sourceDocument?: string })[] = [
      { category: 'data_sharing', title: 'Ad sharing', explanation: 'x', evidence: 'shares with advertisers', severity: 'HIGH', sourceDocument: 'Privacy Policy' },
    ];

    const result = buildPolicyAnalysis(findings);
    expect(result.overallRisk).toBe('HIGH');
    expect(result.summary.toLowerCase()).toContain('data sharing');
  });

  it('generates LOW summary when only low findings present', () => {
    const findings: ChunkFinding[] = [
      { category: 'data_collection', title: 'Minimal data', explanation: 'x', evidence: 'only basic data', severity: 'LOW' },
    ];
    const result = buildPolicyAnalysis(findings);
    expect(result.overallRisk).toBe('LOW');
    expect(result.summary).toContain('no significant privacy concerns were identified');
  });

  it('generates EXPECTED summary when all findings are EXPECTED', () => {
    const findings: ChunkFinding[] = [
      { category: 'data_collection', title: 'Account data', explanation: 'x', evidence: 'name and email only', severity: 'EXPECTED' },
      { category: 'retention', title: 'Standard retention', explanation: 'y', evidence: 'kept as long as account', severity: 'EXPECTED' },
    ];
    const result = buildPolicyAnalysis(findings);
    expect(result.overallRisk).toBe('LOW');
    expect(result.summary).toContain('no significant privacy concerns were identified');
  });
});
