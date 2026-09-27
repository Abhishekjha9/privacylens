import React from 'react';
import type { ExtractionState } from '../types/policy';
import { FileSearch, Loader2 } from 'lucide-react';

interface AnalyzeButtonProps {
  state: ExtractionState;
  onExtract: () => void;
}

export const AnalyzeButton: React.FC<AnalyzeButtonProps> = ({ state, onExtract }) => {
  const isLoading = state === 'detecting' || state === 'extracting';
  const isDisabled = isLoading || state === 'not-found';
  
  let buttonText = 'Extract Policy';
  if (state === 'detecting') buttonText = 'Detecting...';
  if (state === 'extracting') buttonText = 'Extracting...';
  if (state === 'success') buttonText = 'Re-extract Policy';

  return (
    <div className="px-4 pb-4">
      <button
        onClick={onExtract}
        disabled={isDisabled}
        className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium text-white shadow-md transition-all ${
          isDisabled 
            ? 'bg-gray-400 cursor-not-allowed'
            : 'bg-indigo-600 hover:bg-indigo-700 active:scale-[0.98]'
        }`}
      >
        {isLoading ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <FileSearch className="w-5 h-5" />
        )}
        {buttonText}
      </button>
      
      {state === 'error' && (
        <p className="text-red-500 text-sm mt-2 text-center">
          Failed to extract policy. Please try again.
        </p>
      )}
    </div>
  );
};
