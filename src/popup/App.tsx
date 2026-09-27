import { useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { PolicyStatus } from '../components/PolicyStatus';
import { ExtractionPreview } from '../components/ExtractionPreview';
import { AnalyzeButton } from '../components/AnalyzeButton';
import type { PolicyDetection, PolicyDocument, ExtractionState } from '../types/policy';

export default function App() {
  const [state, setState] = useState<ExtractionState>('initial');
  const [detection, setDetection] = useState<PolicyDetection | null>(null);
  const [document, setDocument] = useState<PolicyDocument | null>(null);

  useEffect(() => {
    // Inject script and detect policy on mount
    const init = async () => {
      try {
        setState('detecting');
        
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
          throw new Error("No active tab found");
        }

        // Avoid injecting into restricted pages
        if (tab.url?.startsWith('chrome://') || tab.url?.startsWith('edge://') || tab.url?.startsWith('about:')) {
          setDetection({ isPolicy: false, type: 'unknown', confidence: 0, signals: [] });
          setState('not-found');
          return;
        }

        // Inject content script
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['assets/content.js']
        }).catch(() => {
          // It might already be injected, ignore error
        });

        // Send detect message
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

  const handleExtract = async () => {
    try {
      setState('extracting');
      
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error("No active tab");

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_POLICY' });
      
      if (response && response.extractedText) {
        setDocument(response);
        setState('success');
      } else {
        setState('error');
      }
    } catch (err) {
      console.error("Extraction error:", err);
      setState('error');
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      
      <main className="flex-1 flex flex-col">
        <PolicyStatus detection={detection} document={document} />
        
        {state === 'success' && document && (
          <ExtractionPreview extractedText={document.extractedText} />
        )}
        
        <div className="mt-auto">
          <AnalyzeButton state={state} onExtract={handleExtract} />
        </div>
      </main>
    </div>
  );
}
