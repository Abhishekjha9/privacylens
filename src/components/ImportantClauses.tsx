import React, { useState } from 'react';
import type { ImportantClause } from '../types/analysis';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';

export const ImportantClauses: React.FC<{ clauses: ImportantClause[] }> = ({ clauses }) => {
  if (clauses.length === 0) return null;

  return (
    <div className="px-4 pb-4">
      <h3 className="text-sm font-semibold text-gray-500 uppercase px-1 mb-3">Important Clauses</h3>
      <div className="flex flex-col gap-3">
        {clauses.map((clause, idx) => (
          <ClauseCard key={idx} clause={clause} />
        ))}
      </div>
    </div>
  );
};

const ClauseCard: React.FC<{ clause: ImportantClause }> = ({ clause }) => {
  const [showOriginal, setShowOriginal] = useState(false);

  return (
    <div className="bg-red-50 border border-red-100 rounded-lg shadow-sm p-3">
      <div className="flex items-start gap-2 mb-2">
        <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
        <div>
          <h4 className="font-semibold text-red-900 text-sm">{clause.title}</h4>
          <p className="text-xs font-medium text-red-700/80 uppercase mt-0.5">{clause.category.replace('_', ' ')}</p>
        </div>
      </div>
      
      <p className="text-sm text-gray-800 mb-3 ml-7">
        {clause.simpleExplanation}
      </p>

      <div className="ml-7">
        <button 
          onClick={() => setShowOriginal(!showOriginal)}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1 transition-colors"
        >
          {showOriginal ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showOriginal ? 'Hide original wording' : 'Show original wording'}
        </button>

        {showOriginal && (
          <div className="mt-2 bg-white/60 p-2 rounded border border-red-100/50 text-xs font-mono text-gray-600 italic">
            "{clause.evidence}"
          </div>
        )}
      </div>
    </div>
  );
};
