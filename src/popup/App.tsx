import { useEffect, useState, useCallback } from 'react';
import { Header } from '../components/Header';
import { PolicyStatus } from '../components/PolicyStatus';
import { ExtractionPreview } from '../components/ExtractionPreview';
import { AnalyzeButton } from '../components/AnalyzeButton';
import { ReportUI } from '../components/ReportUI';
import { DiscoveryStatus } from '../components/DiscoveryStatus';
import {
  analyzePolicy,
  analyzeMultipleDocuments,
  fetchDocumentViaBackend,
  discoverHubLinks,
} from '../lib/api';
import type { MultiDocumentInput } from '../lib/api';
import type {
  PolicyDetection, PolicyDocument, ExtractionState,
  PageDetection, DiscoveredLink, DiscoveredDocState, DiscoveryResponse,
} from '../types/policy';
import type { PolicyAnalysis } from '../types/analysis';
import { AlertCircle, FileSearch, Info } from 'lucide-react';

export default function App() {
  const [state, setState] = useState<ExtractionState>('initial');
  const [pageDetection, setPageDetection] = useState<PageDetection | null>(null);
  const [detection, setDetection] = useState<PolicyDetection | null>(null);
  const [document_, setDocument] = useState<PolicyDocument | null>(null);
  const [analysis, setAnalysis] = useState<PolicyAnalysis | null>(null);
  const [discoveredDocs, setDiscoveredDocs] = useState<DiscoveredDocState[]>([]);
  const [progressLabel, setProgressLabel] = useState<string>('');
  const [noDocsMessage, setNoDocsMessage] = useState<string>('');
  const [additionalCount, setAdditionalCount] = useState<number>(0);

  // ---------------------------------------------------------------------------
  // Helper: inject content script
  // ---------------------------------------------------------------------------

  const ensureContentScript = useCallback(async (tabId: number) => {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['assets/content.js'],
    }).catch(() => {});
  }, []);

  // ---------------------------------------------------------------------------
  // Initial page detection
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const init = async () => {
      try {
        setState('detecting');

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) throw new Error('No active tab found');

        if (
          tab.url?.startsWith('chrome://') ||
          tab.url?.startsWith('edge://') ||
          tab.url?.startsWith('about:') ||
          tab.url?.startsWith('chrome-extension://')
        ) {
          setDetection({ isPolicy: false, type: 'unknown', confidence: 0, signals: [] });
          setState('not-found');
          return;
        }

        await ensureContentScript(tab.id);

        const response = await chrome.tabs.sendMessage(tab.id, { type: 'DETECT_PAGE' });

        if (response && response.mode) {
          const pd = response as PageDetection;
          setPageDetection(pd);

          if (pd.mode === 'policy' && pd.policyDetection) {
            setDetection(pd.policyDetection);
            setState('detected');
          } else if (pd.mode === 'login') {
            setState('discovering');
            await handleDiscoveryFlow(tab.id);
          } else {
            setDetection({ isPolicy: false, type: 'unknown', confidence: 0, signals: [] });
            setState('not-found');
          }
        } else {
          // Fallback: old DETECT_POLICY
          const oldResponse = await chrome.tabs.sendMessage(tab.id, { type: 'DETECT_POLICY' });
          if (oldResponse && oldResponse.isPolicy) {
            setDetection(oldResponse);
            setState('detected');
          } else {
            setDetection({ isPolicy: false, type: 'unknown', confidence: 0, signals: [] });
            setState('not-found');
          }
        }
      } catch (err) {
        console.error('Initialization error:', err);
        setDetection({ isPolicy: false, type: 'unknown', confidence: 0, signals: [] });
        setState('not-found');
      }
    };

    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Discovery flow (login/signup mode)
  // ---------------------------------------------------------------------------

  const handleDiscoveryFlow = async (tabId: number) => {
    try {
      setState('discovering');
      setDiscoveredDocs([]);
      setProgressLabel('');
      setAdditionalCount(0);

      // 1. Discover legal links from the page DOM (no tab navigation)
      const rawResponse = await chrome.tabs.sendMessage(tabId, { type: 'DISCOVER_LEGAL_LINKS' });
      const discoveryResponse = rawResponse as DiscoveryResponse;
      let links: DiscoveredLink[] = discoveryResponse?.links ?? [];
      const hubCandidates: DiscoveredLink[] = discoveryResponse?.hubCandidates ?? [];
      const extra = discoveryResponse?.additionalCount ?? 0;
      setAdditionalCount(extra);

      // 2. If no direct docs found, try legal hub discovery (one level deep)
      if (links.length === 0 && hubCandidates.length > 0) {
        const hub = hubCandidates[0];
        console.log(`[PrivacyLens] No direct docs — checking hub: ${hub.url}`);
        try {
          const hubResult = await discoverHubLinks(hub.url);
          if (hubResult.links.length > 0) {
            links = hubResult.links.map(l => ({
              url: l.url,
              text: l.text,
              type: l.type,
              confidence: l.confidence as 'high' | 'medium' | 'low',
            }));
            console.log(`[PrivacyLens] Hub found ${links.length} links`);
          }
        } catch (hubErr) {
          console.warn('[PrivacyLens] Hub discovery failed:', hubErr);
        }
      }

      if (links.length === 0) {
        setState('no-docs-found');
        setNoDocsMessage("I couldn't find a Privacy Policy or Terms document on this page.");
        return;
      }

      // Initialize document states
      const initialStates: DiscoveredDocState[] = links.map((link) => ({
        link,
        status: 'waiting',
      }));
      setDiscoveredDocs(initialStates);

      // 3. Fetch each document via backend (SSRF-protected — never navigates the tab)
      setState('fetching');
      const fetchedDocs: MultiDocumentInput[] = [];
      const seenFingerprints = new Set<string>();

      for (let i = 0; i < links.length; i++) {
        const link = links[i];

        setDiscoveredDocs((prev) =>
          prev.map((d, idx) => (idx === i ? { ...d, status: 'fetching' } : d))
        );

        try {
          const fetched = await fetchDocumentViaBackend(link.url);

          // Content-level deduplication (same fingerprint = skip)
          if (seenFingerprints.has(fetched.contentFingerprint)) {
            console.log(`[PrivacyLens] Skipping duplicate content for ${link.url}`);
            setDiscoveredDocs((prev) =>
              prev.map((d, idx) =>
                idx === i ? { ...d, status: 'complete', title: fetched.title, sourceUrl: fetched.finalUrl } : d
              )
            );
            continue;
          }
          seenFingerprints.add(fetched.contentFingerprint);

          setDiscoveredDocs((prev) =>
            prev.map((d, idx) =>
              idx === i
                ? { ...d, status: 'analyzing', extractedText: fetched.text, title: fetched.title, sourceUrl: fetched.finalUrl }
                : d
            )
          );

          const sourceLabel = link.text ||
            (link.type === 'privacy' ? 'Privacy Policy' :
             link.type === 'terms' ? 'Terms of Service' :
             link.type === 'cookie' ? 'Cookie Policy' : 'Legal Document');

          fetchedDocs.push({
            type: link.type,
            url: link.url,
            title: fetched.title || sourceLabel,
            source: sourceLabel,
            extractedText: fetched.text,
            confidence: link.confidence,
          });
        } catch (fetchErr: any) {
          console.error(`Failed to fetch ${link.url}:`, fetchErr?.message);
          setDiscoveredDocs((prev) =>
            prev.map((d, idx) =>
              idx === i
                ? { ...d, status: 'failed', error: fetchErr?.message ?? 'Could not retrieve document' }
                : d
            )
          );
        }
      }

      if (fetchedDocs.length === 0) {
        setState('no-docs-found');
        setNoDocsMessage("Found legal document links but couldn't retrieve any of them. Try opening a policy page directly.");
        return;
      }

      // 4. Analyze all fetched docs through existing Groq pipeline
      setState('analyzing');
      setProgressLabel(`Starting analysis...`);
      
      const abortController = new AbortController();
      // Store globally for cancellation if needed (e.g. on window)
      (window as any).currentAnalysisController = abortController;

      try {
        const analysisData = await analyzeMultipleDocuments(fetchedDocs, (event) => {
          if (event.type === 'doc-start') {
            setDiscoveredDocs(prev => prev.map(d => d.title === event.title || d.link.url === event.url ? { ...d, status: 'analyzing', progress: 0 } : d));
            setProgressLabel(`Analyzing ${event.title}...`);
          } else if (event.type === 'doc-progress') {
            const percent = Math.round((event.chunkNum / event.totalChunks) * 100);
            setDiscoveredDocs(prev => prev.map(d => d.title === event.title || d.link.url === event.url ? { ...d, status: 'analyzing', progress: percent } : d));
          } else if (event.type === 'doc-complete') {
            setDiscoveredDocs(prev => prev.map(d => d.title === event.title || d.link.url === event.url ? { 
              ...d, 
              status: (event as any).status || (event.success ? 'complete' : (event.timedOut ? 'timed_out' : 'failed')), 
              error: event.error || (event.timedOut ? 'Analysis timed out' : undefined),
              chunksTotal: (event as any).chunksTotal,
              chunksSucceeded: (event as any).chunksSucceeded,
              chunksFailed: (event as any).chunksFailed,
            } : d));
          } else if (event.type === 'overall-timeout') {
            setProgressLabel('Finishing partial analysis (Timeout)...');
          }
        }, abortController.signal);

        // Mark any remaining analyzing docs as complete (in case events missed)
        setDiscoveredDocs((prev) =>
          prev.map((d) => (d.status === 'analyzing' ? { ...d, status: 'complete' } : d))
        );

        setAnalysis(analysisData);
        setState('success');
      } catch (apiErr: any) {
        console.error('Multi-document analysis error:', apiErr);
        if (apiErr.message === 'Analysis cancelled by user.') {
          setState('initial');
        } else {
          setState('analysis-error');
        }
      } finally {
        (window as any).currentAnalysisController = null;
      }
    } catch (err) {
      console.error('Discovery flow error:', err);
      setState('error');
    }
  };

  const handleCancelAnalysis = () => {
    if ((window as any).currentAnalysisController) {
      (window as any).currentAnalysisController.abort();
    }
  };

  // ---------------------------------------------------------------------------
  // Direct policy page flow (existing behavior — unchanged)
  // ---------------------------------------------------------------------------

  const handleExtractAndAnalyze = async () => {
    try {
      setState('extracting');

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('No active tab');

      await ensureContentScript(tab.id);

      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_POLICY' });

      if (response && response.extractedText) {
        setDocument(response);
        setState('analyzing' as ExtractionState);

        try {
          const analysisData = await analyzePolicy(response);
          setAnalysis(analysisData);
          setState('success');
        } catch (apiErr) {
          console.error('API error:', apiErr);
          setState('analysis-error');
        }
      } else {
        setState('error');
      }
    } catch (err) {
      console.error('Extraction error:', err);
      setState('error');
    }
  };

  // ---------------------------------------------------------------------------
  // Retry
  // ---------------------------------------------------------------------------

  const handleRetryDiscovery = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    await ensureContentScript(tab.id);
    setAnalysis(null);
    await handleDiscoveryFlow(tab.id);
  };

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------

  const mode = pageDetection?.mode ?? 'unknown';
  const isAnalyzing = state === 'analyzing';
  const isDiscovering = state === 'discovering' || state === 'fetching';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col min-h-screen">
      <Header />

      <main className="flex-1 flex flex-col pb-4">

        {/* ================================================================
            LOGIN/SIGNUP MODE — discovery flow
        ================================================================ */}
        {mode === 'login' && !analysis && (
          <>
            {(isDiscovering || isAnalyzing) && (
              <DiscoveryStatus
                state={state}
                discoveredDocs={discoveredDocs}
                progressLabel={progressLabel}
              />
            )}

            {isAnalyzing && (
              <div className="flex flex-col items-center justify-center p-6 text-center text-gray-500">
                <div className="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mb-3" />
                <p className="font-medium text-gray-800">{progressLabel || 'Analyzing...'}</p>
                <p className="text-xs text-gray-500 mt-1 mb-4">Building PrivacyLens report</p>
                <button 
                  onClick={handleCancelAnalysis}
                  className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-red-600 transition-colors shadow-sm"
                >
                  Cancel Analysis
                </button>
              </div>
            )}

            {state === 'no-docs-found' && (
              <div className="m-4 flex flex-col items-center justify-center p-6 text-center bg-amber-50 rounded-xl border border-amber-200">
                <AlertCircle className="w-10 h-10 text-amber-400 mb-3" />
                <p className="font-medium text-gray-800 mb-2">
                  {noDocsMessage || "Couldn't find privacy documents."}
                </p>
                <p className="text-sm text-gray-500 mb-4">
                  This doesn't mean the service has no privacy policy — it may just be harder to find.
                </p>
                <button
                  onClick={handleRetryDiscovery}
                  className="text-sm text-indigo-600 font-medium hover:text-indigo-800 flex items-center gap-1"
                >
                  <FileSearch className="w-4 h-4" />
                  Search again
                </button>
              </div>
            )}

            {state === 'analysis-error' && (
              <div className="m-4 flex flex-col items-center p-6 text-center bg-red-50 rounded-xl border border-red-200">
                <AlertCircle className="w-10 h-10 text-red-400 mb-3" />
                <p className="font-semibold text-red-800 mb-1">Analysis failed</p>
                <p className="text-sm text-gray-600">PrivacyLens couldn't complete the analysis.</p>
                <button
                  onClick={handleRetryDiscovery}
                  className="mt-4 text-sm text-indigo-600 font-medium hover:text-indigo-800"
                >
                  Try again
                </button>
              </div>
            )}
          </>
        )}

        {/* ================================================================
            POLICY PAGE MODE — direct extraction (existing flow, unchanged)
        ================================================================ */}
        {mode !== 'login' && !analysis && (
          <>
            <PolicyStatus detection={detection} document={document_} />

            {state === 'success' && document_ && (
              <ExtractionPreview extractedText={document_.extractedText} />
            )}

            {isAnalyzing && (
              <div className="flex flex-col items-center justify-center p-8 text-center text-gray-500">
                <div className="animate-spin w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mb-4" />
                <p className="font-medium text-gray-800">Analyzing policy...</p>
                <p className="text-xs text-gray-500 mt-2">Building PrivacyLens report</p>
              </div>
            )}
          </>
        )}

        {/* ================================================================
            REPORT (shared for both modes)
        ================================================================ */}
        {analysis && state === 'success' && (
          <>
            {mode === 'login' && discoveredDocs.length > 0 && (
              <DiscoveryStatus
                state="success"
                discoveredDocs={discoveredDocs}
                progressLabel=""
              />
            )}

            {/* Additional documents found but not analyzed */}
            {additionalCount > 0 && (
              <div className="mx-4 mb-2 flex items-start gap-2 p-3 bg-indigo-50 rounded-lg border border-indigo-100 text-sm text-indigo-700">
                <Info className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  {additionalCount} additional legal document{additionalCount !== 1 ? 's' : ''} found but not analyzed (3 document limit).
                </span>
              </div>
            )}

            <ReportUI analysis={analysis} />
          </>
        )}

        {/* Analyze button (policy page mode only) */}
        {mode !== 'login' && !analysis && !isAnalyzing && (
          <div className="mt-auto pt-4">
            <AnalyzeButton state={state} onExtract={handleExtractAndAnalyze} />
          </div>
        )}
      </main>
    </div>
  );
}
