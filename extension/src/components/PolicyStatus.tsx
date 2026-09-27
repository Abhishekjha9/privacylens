import React from 'react';
import type { PolicyDocument, PolicyDetection } from '../types/policy';
import { FileText, Clock, AlertCircle } from 'lucide-react';

interface PolicyStatusProps {
  detection: PolicyDetection | null;
  document: PolicyDocument | null;
}

export const PolicyStatus: React.FC<PolicyStatusProps> = ({ detection, document }) => {
  if (!detection) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-gray-500">
        <div className="animate-pulse w-8 h-8 rounded-full bg-gray-200 mb-4"></div>
        <p>Analyzing page...</p>
      </div>
    );
  }

  if (!detection.isPolicy) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center bg-gray-50 m-4 rounded-xl border border-gray-200">
        <AlertCircle className="w-10 h-10 text-gray-400 mb-3" />
        <p className="font-medium text-gray-800 mb-2">No privacy policy or terms document detected on this page.</p>
        <p className="text-sm text-gray-500">Try opening a Privacy Policy or Terms & Conditions page.</p>
      </div>
    );
  }

  // Determine what to show for policy stats (use document if available, else just type)
  const formatType = (type: string) => {
    return type.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  };

  return (
    <div className="p-4 m-4 bg-white rounded-xl shadow-sm border border-indigo-100">
      <div className="flex items-center gap-2 text-indigo-600 mb-4">
        <FileText className="w-5 h-5" />
        <span className="font-semibold">{formatType(detection.type)} detected</span>
      </div>
      
      {document ? (
        <div className="bg-gray-50 p-4 rounded-lg space-y-3">
          <div>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Website</p>
            <p className="text-sm font-medium text-gray-900">{document.domain}</p>
          </div>
          
          <div className="flex items-center gap-6">
            <div>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Word Count</p>
              <p className="text-sm font-medium text-gray-900">{document.wordCount.toLocaleString()} words</p>
            </div>
            
            <div className="flex items-start gap-1">
              <div>
                <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Est. Reading Time</p>
                <div className="flex items-center gap-1">
                  <Clock className="w-4 h-4 text-gray-500" />
                  <p className="text-sm font-medium text-gray-900">~{document.estimatedReadingMinutes} min</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-600">
          <p>We've found a likely {formatType(detection.type)} document.</p>
          <p className="mt-1">Extract it to see details and reading time.</p>
        </div>
      )}
    </div>
  );
};
