import React from 'react';
import { Shield, FileSearch, Loader2, CheckCircle2, XCircle, Clock, AlertCircle } from 'lucide-react';
import type { DiscoveredDocState, DiscoveredDocStatus } from '../types/policy';
import type { ExtractionState } from '../types/policy';

interface DiscoveryStatusProps {
  state: ExtractionState;
  discoveredDocs: DiscoveredDocState[];
  progressLabel?: string;
}

const DOC_TYPE_LABEL: Record<string, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  cookie: 'Cookie Policy',
  other: 'Legal Document',
};

const StatusIcon: React.FC<{ status: DiscoveredDocStatus }> = ({ status }) => {
  switch (status) {
    case 'complete':
      return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
    case 'partial':
      return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />;
    case 'failed':
    case 'timed_out':
    case 'cancelled':
      return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    case 'fetching':
    case 'analyzing':
      return <Loader2 className="w-4 h-4 text-indigo-500 shrink-0 animate-spin" />;
    default:
      return <Clock className="w-4 h-4 text-gray-300 shrink-0" />;
  }
};

const statusText: Record<DiscoveredDocStatus, string> = {
  waiting: 'Waiting...',
  fetching: 'Fetching...',
  analyzing: 'Analyzing...',
  complete: 'Complete',
  partial: 'Partially analyzed',
  failed: 'Failed',
  timed_out: 'Timed out',
  cancelled: 'Cancelled'
};

export const DiscoveryStatus: React.FC<DiscoveryStatusProps> = ({ state, discoveredDocs, progressLabel }) => {
  const isDiscovering = state === 'discovering';
  const isFetching = state === 'fetching';
  const isAnalyzing = state === 'analyzing';

  return (
    <div className="m-4 bg-white rounded-xl shadow-sm border border-indigo-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-indigo-50 bg-gradient-to-r from-indigo-50 to-white">
        <div className="p-2 rounded-lg bg-indigo-100">
          <Shield className="w-5 h-5 text-indigo-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm">
            Before you continue, I'll check this service's privacy and legal documents.
          </p>
        </div>
      </div>

      {/* Discovery step */}
      <div className="p-4 space-y-3">
        {/* Step 1: Find documents */}
        <div className="flex items-center gap-3">
          <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
            isDiscovering
              ? 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-300 ring-offset-1'
              : discoveredDocs.length > 0 || isFetching || isAnalyzing
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-gray-100 text-gray-400'
          }`}>
            {isDiscovering ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : discoveredDocs.length > 0 || isFetching || isAnalyzing ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <FileSearch className="w-3.5 h-3.5" />
            )}
          </div>
          <div className="flex-1">
            <p className={`text-sm font-medium ${isDiscovering ? 'text-indigo-700' : 'text-gray-700'}`}>
              {isDiscovering ? 'Finding legal documents...' : 
               discoveredDocs.length > 0
                 ? `Found ${discoveredDocs.length} document${discoveredDocs.length !== 1 ? 's' : ''}`
                 : 'Finding legal documents'}
            </p>
          </div>
        </div>

        {/* Document list */}
        {discoveredDocs.length > 0 && (
          <div className="ml-9 space-y-2">
            {discoveredDocs.map((docState, idx) => (
              <div
                key={idx}
                className={`flex items-center gap-2 p-2 rounded-lg text-sm transition-colors ${
                  docState.status === 'complete'
                    ? 'bg-emerald-50 border border-emerald-100'
                    : docState.status === 'partial'
                    ? 'bg-amber-50 border border-amber-100'
                    : docState.status === 'failed' || docState.status === 'timed_out' || docState.status === 'cancelled'
                    ? 'bg-red-50 border border-red-100'
                    : docState.status === 'analyzing' || docState.status === 'fetching'
                    ? 'bg-indigo-50 border border-indigo-100'
                    : 'bg-gray-50 border border-gray-100'
                }`}
              >
                <StatusIcon status={docState.status} />
                <span className={`flex-1 font-medium truncate ${
                  (docState.status === 'failed' || docState.status === 'timed_out' || docState.status === 'cancelled') ? 'text-red-700' :
                  docState.status === 'complete' ? 'text-emerald-800' :
                  docState.status === 'partial' ? 'text-amber-800' :
                  'text-gray-700'
                }`}>
                  {docState.link.text || DOC_TYPE_LABEL[docState.link.type] || 'Legal Document'}
                </span>
                <span className={`text-xs shrink-0 ${
                  (docState.status === 'failed' || docState.status === 'timed_out' || docState.status === 'cancelled') ? 'text-red-500' :
                  docState.status === 'complete' ? 'text-emerald-600' :
                  docState.status === 'partial' ? 'text-amber-600' :
                  'text-gray-400'
                }`}>
                  {(docState.status === 'failed' || docState.status === 'timed_out' || docState.status === 'cancelled') ? (docState.error || 'Failed') : 
                   (docState.status === 'analyzing' && docState.progress !== undefined) 
                     ? `Analyzing... ${docState.progress}%` 
                     : (docState.status === 'partial' && (docState as any).chunksSucceeded !== undefined)
                     ? `Coverage: ${(docState as any).chunksSucceeded} of ${(docState as any).chunksTotal} parts analyzed`
                     : statusText[docState.status]}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Step 2: Analyze */}
        {(isFetching || isAnalyzing || progressLabel) && (
          <div className="flex items-center gap-3">
            <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
              isAnalyzing
                ? 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-300 ring-offset-1'
                : 'bg-gray-100 text-gray-400'
            }`}>
              {isAnalyzing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <span>2</span>
              )}
            </div>
            <p className={`text-sm font-medium ${isAnalyzing ? 'text-indigo-700' : 'text-gray-500'}`}>
              {progressLabel || (isAnalyzing ? 'Analyzing documents...' : 'Analyze documents')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
