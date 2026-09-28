import React, { useState } from 'react';
import type { PolicyAnalysis, CategoryAnalysis, RiskLevel } from '../types/analysis';
import { ShieldAlert, AlertTriangle, Info, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';

interface ReportUIProps {
  analysis: PolicyAnalysis;
}

export const ReportUI: React.FC<ReportUIProps> = ({ analysis }) => {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="bg-white border rounded-xl shadow-sm p-4">
        <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-2">
          <ShieldAlert className="w-5 h-5 text-indigo-600" />
          Privacy Risk Indicators
        </h2>
        
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs font-semibold text-gray-500 uppercase">Overall</span>
          <RiskBadge risk={analysis.overallRisk} />
        </div>
        
        <p className="text-sm text-gray-600">{analysis.summary}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-500 uppercase px-1">Categories</h3>
        {analysis.categories.map((category, idx) => (
          <CategoryCard key={idx} category={category} />
        ))}
      </div>
    </div>
  );
};

const RiskBadge: React.FC<{ risk: RiskLevel }> = ({ risk }) => {
  const colors: Record<RiskLevel, string> = {
    EXPECTED: 'bg-blue-50 text-blue-600 border-blue-200',
    HIGH: 'bg-red-100 text-red-700 border-red-200',
    MEDIUM: 'bg-orange-100 text-orange-700 border-orange-200',
    LOW: 'bg-green-100 text-green-700 border-green-200',
    NOT_FOUND: 'bg-gray-100 text-gray-700 border-gray-200'
  };

  const icons: Record<RiskLevel, React.ReactNode> = {
    EXPECTED: <CheckCircle2 className="w-3 h-3" />,
    HIGH: <AlertTriangle className="w-3 h-3" />,
    MEDIUM: <Info className="w-3 h-3" />,
    LOW: <CheckCircle2 className="w-3 h-3" />,
    NOT_FOUND: null
  };

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${colors[risk]}`}>
      {icons[risk]}
      {risk}
    </span>
  );
};

const CategoryCard: React.FC<{ category: CategoryAnalysis }> = ({ category }) => {
  const [expanded, setExpanded] = useState(false);

  const formatTitle = (cat: string) => cat.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  return (
    <div className="bg-white border rounded-lg shadow-sm overflow-hidden">
      <button 
        className="w-full flex items-start justify-between p-3 hover:bg-gray-50 transition-colors text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex-1 pr-2">
          <div className="flex items-center justify-between mb-1">
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
        <div className="px-3 pb-3 pt-1 border-t border-gray-100 bg-gray-50">
          <div className="flex flex-col gap-3 mt-2">
            {category.findings.map((finding, idx) => (
              <div key={idx} className="bg-white p-3 rounded border border-gray-100 text-sm">
                <p className="font-medium text-gray-800 mb-1">{finding.title}</p>
                <p className="text-gray-600 mb-2">{finding.explanation}</p>
                <div className="bg-gray-100 p-2 rounded text-xs font-mono text-gray-500 italic">
                  "{finding.evidence}"
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
