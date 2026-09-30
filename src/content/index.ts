import { detectPolicy } from './detector';
import { detectLoginPage } from './login-detector';
import { discoverLegalLinks } from './link-discoverer';
import { extractPolicyContent } from './extractor';
import type { MessageType, PageDetection } from '../types/policy';

chrome.runtime.onMessage.addListener((message: MessageType, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {
  if (message.type === 'PING') {
    sendResponse({ ok: true });
    return;
  }

  if (message.type === 'DETECT_POLICY') {
    try {
      const detection = detectPolicy();
      sendResponse(detection);
    } catch (error) {
      console.error('Detection failed', error);
      sendResponse({ error: 'Detection failed' });
    }
    return true;
  }

  /**
   * DETECT_PAGE: Unified detection.
   * Returns { mode: 'policy' | 'login' | 'unknown', policyDetection?, loginDetection? }
   */
  if (message.type === 'DETECT_PAGE') {
    try {
      const policyDetection = detectPolicy();
      if (policyDetection.isPolicy) {
        const result: PageDetection = { mode: 'policy', policyDetection };
        sendResponse(result);
        return;
      }

      const loginDetection = detectLoginPage();
      if (loginDetection.isLoginPage) {
        const result: PageDetection = { mode: 'login', loginDetection };
        sendResponse(result);
        return;
      }

      const result: PageDetection = { mode: 'unknown', policyDetection, loginDetection };
      sendResponse(result);
    } catch (error) {
      console.error('Page detection failed', error);
      sendResponse({ error: 'Page detection failed' });
    }
    return true;
  }

  if (message.type === 'EXTRACT_POLICY') {
    try {
      const detection = detectPolicy();
      if (!detection.isPolicy) {
        sendResponse({ error: 'No policy detected to extract' });
        return;
      }
      const document = extractPolicyContent(detection);
      sendResponse(document);
    } catch (error) {
      console.error('Extraction failed', error);
      sendResponse({ error: 'Extraction failed' });
    }
    return true;
  }

  /**
   * DISCOVER_LEGAL_LINKS: Returns DiscoveryResponse.
   *
   * Phase 1: immediate DOM scan
   * Phase 2: if results are sparse, wait 750ms and scan again (SPA support)
   */
  if (message.type === 'DISCOVER_LEGAL_LINKS') {
    (async () => {
      try {
        // First pass: immediate scan
        const firstPass = discoverLegalLinks();

        // If we have high-confidence direct docs, return immediately
        const hasGoodDirectDocs = firstPass.links.filter(l => l.confidence === 'high').length >= 1;

        if (hasGoodDirectDocs) {
          sendResponse({
            links: firstPass.links,
            hubCandidates: firstPass.hubCandidates,
            additionalCount: firstPass.additionalCount,
          });
          return;
        }

        // Second pass: wait for SPA renders (bounded, no MutationObserver leak)
        await new Promise<void>((resolve) => {
          // Use a one-shot MutationObserver that self-terminates after 750ms
          let observer: MutationObserver | null = null;
          let resolved = false;

          const finish = () => {
            if (resolved) return;
            resolved = true;
            observer?.disconnect();
            resolve();
          };

          observer = new MutationObserver(() => {
            // Only finish early if links are now present
            const secondCheck = discoverLegalLinks();
            if (secondCheck.links.length > 0) finish();
          });

          observer.observe(document.body, { childList: true, subtree: true });
          // Always terminate after 750ms regardless
          setTimeout(finish, 750);
        });

        // Second-pass scan after DOM may have settled
        const secondPass = discoverLegalLinks();
        sendResponse({
          links: secondPass.links,
          hubCandidates: secondPass.hubCandidates,
          additionalCount: secondPass.additionalCount,
        });
      } catch (error) {
        console.error('Link discovery failed', error);
        sendResponse({ links: [], hubCandidates: [], additionalCount: 0 });
      }
    })();
    return true; // async response
  }
});
