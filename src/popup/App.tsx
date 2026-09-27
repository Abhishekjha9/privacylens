import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { PolicyStatus } from '../components/PolicyStatus';
import { ExtractionPreview } from '../components/ExtractionPreview';
import { AnalyzeButton } from '../components/AnalyzeButton';
import { ReportUI } from '../components/ReportUI';
import { ImportantClauses } from '../components/ImportantClauses';
import { analyzePolicy } from '../lib/api';
import type { PolicyDetection, PolicyDocument, ExtractionState } from '../types/policy';
import type { PolicyAnalysis } from '../types/analysis';

export default function App() {
  const [state, setState] = useState<ExtractionState>('initial');
  const [detection, setDetection] = useState<PolicyDetection | null>(null);
  const [document, setDocument] = useState<PolicyDocument | null>(null);
  const [analysis, setAnalysis] = useState<PolicyAnalysis | null>(null);

  useEffect(() => {
    // Inject script and detect policy on mount
    const init = async () => {
      try {
        setState('detecting');
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          throw new Error("No active tab found");
        }

        if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
          setDetection({ isPolicy: false, type: 'unknown', confidence: 0, signals: [] });
          setState('not-found');
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['assets/content.js']
        }).catch(() => {});

        const response = await chrome.tabs.sendMessage(tab.id, { type: 'DETECT_POLICY' });
        
        if (response && response.isPolicy !== undefined) {
          setDetection(response);
          setState(response.isPolicy ? 'detected' : 'not-found');
        } else {
          setDetection({ isPolicy: false, type: 'unknown', confidence: 0, signals: [] });
          setState('not-found');
        }
      } catch (err) {
        console.error("Initialization error:", err);
        setDetection({ isPolicy: false, type: 'unknown', confidence: 0, signals: [] });
        setState('not-found');
      }
    };

    init();
  }, []);

  const handleExtractAndAnalyze = async () => {
    try {
      setState('extracting');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error("No active tab");

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_POLICY' });
      
      if (response && response.extractedText) {
        setDocument(response);
        
        // Phase 2: Call backend to analyze
        // We temporarily set state to 'analyzing'
        setState('analyzing' as ExtractionState); // extending ExtractionState locally or implicitly
        
        try {
          const analysisData = await analyzePolicy(response);
          setAnalysis(analysisData);
          setState('success');
        } catch (apiErr) {
          console.error("API error:", apiErr);
          setState('analysis-error' as any);
        }

      } else {
        setState('error');
      }
    } catch (err) {
      console.error("Extraction error:", err);
      setState('error');
    }
  };

  const isAnalyzing = state === ('analyzing' as any);

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-1 flex flex-col pb-4">
        {!analysis && (
          <PolicyStatus detection={detection} document={document} />
        )}
        
        {!analysis && state === 'success' && document && (
          <ExtractionPreview extractedText={document.extractedText} />
        )}

        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center p-8 text-center text-gray-500">
            <div className="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mb-4"></div>
            <p className="font-medium text-gray-800">Analyzing policy...</p>
            <p className="text-xs text-gray-500 mt-2">Building PrivacyLens report</p>
          </div>
        )}

        {analysis && state === 'success' && (
          <>
            <ReportUI analysis={analysis} />
            <ImportantClauses clauses={analysis.importantClauses} />
          </>
        )}
        
        {!analysis && !isAnalyzing && (
          <div className="mt-auto pt-4">
            <AnalyzeButton 
              state={state} 
              onExtract={handleExtractAndAnalyze} 
              // We override the button text visually inside the component if needed, but it takes state.
            />
          </div>
        )}
      </main>
    </div>
  );
}
