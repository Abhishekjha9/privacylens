import React, { useState } from 'react';
import type { PolicyAnalysis, CategoryAnalysis, RiskLevel, Finding, ImportantClause } from '../types/analysis';
import { Shield, AlertTriangle, Info, CheckCircle2, ChevronDown, ChevronUp, FileText, XCircle, ExternalLink } from 'lucide-react';

interface ReportUIProps {
  analysis: PolicyAnalysis;
}

export const ReportUI: React.FC<ReportUIProps> = ({ analysis }) => {
  const successCount = analysis.documentsAnalyzed?.filter(d => d.status === 'complete' || d.status === 'partial' || (d as any).success).length || 1;
  const docText = `${successCount} document${successCount !== 1 ? 's' : ''} analyzed`;

  const hasPartialDocs = analysis.documentsAnalyzed?.some(d => d.status === 'partial');

  // Filter out NOT_FOUND from Detailed Findings
  const detailedFindings = analysis.categories.filter(c => c.risk !== 'NOT_FOUND');

  // Key Concerns (limit to top 5)
  // We prioritize HIGH > MEDIUM > LOW
  // (In the risk engine, we already appended them in this order: HIGH, MEDIUM, then LOW).
  const keyConcerns = analysis.importantClauses.slice(0, 5);

  return (
    <div className="flex flex-col gap-6 p-4">
      {/* 1. OVERALL PRIVACY RISK */}
      <div className="bg-white border rounded-xl shadow-sm p-5 relative overflow-hidden">
        <div className="flex items-center gap-2 mb-3">
          <Shield className="w-5 h-5 text-gray-700" />
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Overall Privacy Risk</h2>
        </div>
        
        <div className="flex items-center justify-center py-4 mb-2">
          <OverallRiskBadge risk={analysis.overallRisk} />
        </div>
        
        <p className="text-sm text-gray-700 text-center mb-4 leading-relaxed px-2">
          {analysis.summary}
        </p>
        
        <div className="mt-4 pt-4 border-t border-gray-100 flex items-center justify-center gap-2 text-xs text-gray-500">
          <FileText className="w-3.5 h-3.5" />
          {docText}
        </div>
      </div>

      {hasPartialDocs && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl shadow-sm p-4 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0" />
            <p>
              Some parts could not be analyzed because the AI rate limit was reached. Results below are based on partially analyzed documents.
            </p>
          </div>
        </div>
      )}

      {/* Documents analyzed banner (multi-doc mode) */}
      {analysis.documentsAnalyzed && analysis.documentsAnalyzed.length > 0 && (
        <DocumentsBanner docs={analysis.documentsAnalyzed} />
      )}

      {/* 2. KEY PRIVACY CONCERNS */}
      {keyConcerns.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1">Key Concerns</h3>
          {keyConcerns.map((clause, idx) => (
            <ConcernCard key={idx} clause={clause} />
          ))}
        </div>
      )}

      {/* 3. DETAILED FINDINGS */}
      {detailedFindings.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider px-1 mt-2">Detailed Findings</h3>
          {detailedFindings.map((category, idx) => (
            <CategoryCard key={idx} category={category} />
          ))}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Documents Analyzed Banner
// ---------------------------------------------------------------------------

interface DocResult {
  type: string;
  url: string;
  title: string;
  source: string;
  success?: boolean;
  status?: "complete" | "partial" | "failed";
  chunksTotal?: number;
  chunksSucceeded?: number;
  chunksFailed?: number;
  error?: string;
  errors?: { code: string; chunk: number }[];
  findingsCount?: number;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  cookie: 'Cookie Policy',
  other: 'Legal Document',
};

const DocumentsBanner: React.FC<{ docs: DocResult[] }> = ({ docs }) => {
  const [expanded, setExpanded] = useState(false);
  const successCount = docs.filter(d => d.status === 'complete' || d.status === 'partial' || (d as any).success).length;
  if (docs.length === 0) return null;

  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center justify-between p-3 hover:bg-gray-100 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 text-gray-600">
          <span className="text-sm font-medium">
            View analyzed documents ({successCount}/{docs.length})
          </span>
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 space-y-2">
          {docs.map((doc, idx) => {
            const isSuccess = doc.status === 'complete' || (doc as any).success;
            const isPartial = doc.status === 'partial';
            const isFailed = doc.status === 'failed' || (!(doc as any).success && !doc.status);

            return (
            <div key={idx} className="flex items-start gap-2 py-1">
              {isSuccess ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
              ) : isPartial ? (
                <Info className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {doc.title || DOC_TYPE_LABEL[doc.type] || 'Document'}
                  </p>
                  {doc.url && (isSuccess || isPartial) && (
                    <button
                      title={`Open ${doc.title || 'document'} in new tab`}
                      onClick={() => chrome.tabs.create({ url: doc.url })}
                      className="shrink-0 text-indigo-500 hover:text-indigo-700 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                {isFailed && doc.errors && doc.errors.length > 0 && (
                  <p className="text-xs text-red-500 mt-0.5">{doc.errors.map(e => e.code).join(', ')}</p>
                )}
                {isPartial && (
                  <p className="text-xs text-amber-600 mt-0.5">Coverage: {doc.chunksSucceeded} of {doc.chunksTotal} parts analyzed</p>
                )}
                {(isSuccess || isPartial) && doc.findingsCount !== undefined && (
                  <p className="text-xs text-gray-500 mt-0.5">{doc.findingsCount} finding{doc.findingsCount !== 1 ? 's' : ''}</p>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Overall Risk Badge
// ---------------------------------------------------------------------------

const OverallRiskBadge: React.FC<{ risk: RiskLevel }> = ({ risk }) => {
  if (risk === 'HIGH') {
    return (
      <div className="flex items-center gap-2 text-red-600">
        <AlertTriangle className="w-8 h-8" />
        <span className="text-2xl font-black tracking-tight">HIGH</span>
      </div>
    );
  }
  if (risk === 'MEDIUM') {
    return (
      <div className="flex items-center gap-2 text-orange-500">
        <Info className="w-8 h-8" />
        <span className="text-2xl font-black tracking-tight">MEDIUM</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-emerald-600">
      <CheckCircle2 className="w-8 h-8" />
      <span className="text-2xl font-black tracking-tight">LOW</span>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Small Risk Badge
// ---------------------------------------------------------------------------

const RiskBadge: React.FC<{ risk: RiskLevel }> = ({ risk }) => {
  const colors: Record<RiskLevel, string> = {
    EXPECTED: 'bg-gray-100 text-gray-600 border-gray-200',
    HIGH: 'bg-red-100 text-red-700 border-red-200',
    MEDIUM: 'bg-orange-100 text-orange-700 border-orange-200',
    LOW: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    NOT_FOUND: 'bg-gray-100 text-gray-500 border-gray-200',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${colors[risk]}`}>
      {risk}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Concern Card (Replaces ImportantClauses)
// ---------------------------------------------------------------------------

const ConcernCard: React.FC<{ clause: ImportantClause }> = ({ clause }) => {
  const [showOriginal, setShowOriginal] = useState(false);

  const handleViewSource = () => {
    if (!clause.sourceUrl) return;
    chrome.tabs.create({ url: clause.sourceUrl, active: false });
  };

  const isHigh = clause.severity === 'HIGH';
  const isMed = clause.severity === 'MEDIUM';

  const containerClasses = isHigh 
    ? "bg-red-50 border-red-200" 
    : isMed 
      ? "bg-orange-50 border-orange-200" 
      : "bg-yellow-50 border-yellow-200";

  return (
    <div className={`border rounded-xl shadow-sm p-4 ${containerClasses}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-start gap-2">
            <h4 className="font-bold text-gray-900 text-sm leading-tight">{clause.title}</h4>
            <RiskBadge risk={clause.severity} />
          </div>
          <p className="text-xs font-semibold text-gray-500 uppercase mt-1">
            {clause.category.replace(/_/g, ' ')}
          </p>
        </div>
      </div>

      <p className="text-sm text-gray-800 mb-4">{clause.simpleExplanation}</p>

      <div className="flex items-center justify-between border-t border-black/5 pt-3">
        {clause.sourceDocument && (
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
            <span>Source:</span>
            <span className="text-indigo-600 bg-white px-2 py-0.5 rounded border border-indigo-100 shadow-sm">{clause.sourceDocument}</span>
          </div>
        )}
        
        <div className="flex items-center gap-3 ml-auto">
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            {showOriginal ? 'Hide evidence' : 'View evidence'}
          </button>
          
          {clause.sourceUrl && (
            <button
              onClick={handleViewSource}
              className="text-xs text-gray-400 hover:text-indigo-600 flex items-center gap-1 transition-colors"
              title="Open source document"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {showOriginal && (
        <div className="mt-3 bg-white p-3 rounded border border-black/10 text-xs font-mono text-gray-600 italic">
          "{clause.evidence}"
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Category Card (Detailed Findings)
// ---------------------------------------------------------------------------

const CategoryCard: React.FC<{ category: CategoryAnalysis }> = ({ category }) => {
  const [expanded, setExpanded] = useState(false);

  const formatTitle = (cat: string) =>
    cat.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  // Do not automatically expand expected/low items unless user clicks
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      <button
        className="w-full flex items-start justify-between p-3 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 pr-2">
          <div className="flex items-center justify-between mb-1.5">
            <h4 className="font-semibold text-gray-800 text-sm">{formatTitle(category.category)}</h4>
            <RiskBadge risk={category.risk} />
          </div>
          <p className="text-xs text-gray-600 line-clamp-2">{category.summary}</p>
        </div>
        <div className="pt-1">
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {expanded && category.findings.length > 0 && (
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 bg-gray-50/50">
          <div className="flex flex-col gap-3 mt-2">
            {category.findings.map((finding, idx) => (
              <FindingCard key={idx} finding={finding} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Finding Card
// ---------------------------------------------------------------------------

const FindingCard: React.FC<{ finding: Finding }> = ({ finding }) => {
  const handleViewSource = () => {
    if (!finding.sourceUrl) return;
    chrome.tabs.create({ url: finding.sourceUrl, active: false });
  };

  return (
    <div className="bg-white p-3 rounded border border-gray-200 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="font-semibold text-gray-800">{finding.title}</p>
        <RiskBadge risk={finding.severity} />
      </div>

      <p className="text-gray-600 mb-3 text-xs leading-relaxed">{finding.explanation}</p>

      {finding.severity !== 'EXPECTED' && (
        <div className="bg-gray-50 p-2 rounded text-xs font-mono text-gray-500 italic mb-3 border border-gray-100">
          "{finding.evidence}"
        </div>
      )}

      <div className="flex items-center justify-between mt-1 pt-2 border-t border-gray-100">
        {finding.sourceDocument && (
          <span className="text-[10px] uppercase font-bold tracking-wider text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
            {finding.sourceDocument}
          </span>
        )}
        {finding.sourceUrl && (
          <button
            onClick={handleViewSource}
            className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors ml-auto uppercase tracking-wide"
          >
            Source <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
};
