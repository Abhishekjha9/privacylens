import React, { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';

interface ExtractionPreviewProps {
  extractedText: string;
}

export const ExtractionPreview: React.FC<ExtractionPreviewProps> = ({ extractedText }) => {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(extractedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  const previewText = extractedText.length > 1000 
    ? extractedText.substring(0, 1000) + '...'
    : extractedText;

  return (
    <div className="mx-4 mb-4 border border-green-200 bg-green-50 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between p-3 bg-green-100/50 border-b border-green-200">
        <div className="flex items-center gap-2 text-green-700">
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-semibold text-sm">Policy extracted successfully</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-200 rounded-md transition-colors"
          title="Copy extracted text"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <div className="p-0">
        <button 
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center justify-between p-3 text-sm font-medium text-gray-700 hover:bg-green-100/30 transition-colors"
        >
          <span>Preview Content</span>
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        
        {expanded && (
          <div className="p-3 pt-0 text-xs text-gray-600 font-mono whitespace-pre-wrap max-h-60 overflow-y-auto border-t border-green-100 bg-white">
            {previewText}
          </div>
        )}
      </div>
    </div>
  );
};
