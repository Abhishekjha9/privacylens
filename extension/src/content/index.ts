import { detectPolicy } from './detector';
import { extractPolicyContent } from './extractor';
import type { MessageType } from '../types/policy';

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
    return true; // Keep message channel open for async if needed
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
});
