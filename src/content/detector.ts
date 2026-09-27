import type { PolicyDetection, PolicyType } from '../types/policy';

export function detectPolicy(): PolicyDetection {
  const url = window.location.href.toLowerCase();
  const title = document.title.toLowerCase();
  const headings = Array.from(document.querySelectorAll('h1, h2')).map(h => (h.textContent || '').toLowerCase());
  
  const signals: string[] = [];
  let confidence = 0;
  let type: PolicyType = "unknown";

  const isPrivacy = /privacy\s*(policy|notice|statement)/i;
  const isTerms = /terms\s*(of\s*service|and\s*conditions|&\s*conditions)/i;
  const isCookie = /cookie\s*policy/i;
  const isUserAgreement = /user\s*agreement/i;

  const checkMatch = (text: string, weight: number) => {
    if (isPrivacy.test(text)) {
      confidence += weight;
      type = "privacy-policy";
      signals.push(`Privacy keyword found in: "${text}"`);
    } else if (isTerms.test(text)) {
      confidence += weight;
      type = "terms-of-service";
      signals.push(`Terms keyword found in: "${text}"`);
    } else if (isCookie.test(text)) {
      confidence += weight;
      type = "cookie-policy";
      signals.push(`Cookie keyword found in: "${text}"`);
    } else if (isUserAgreement.test(text)) {
      confidence += weight;
      type = "user-agreement";
      signals.push(`User Agreement keyword found in: "${text}"`);
    }
  };

  checkMatch(url, 40);
  checkMatch(title, 30);
  
  for (const h of headings.slice(0, 5)) {
    const prevConf = confidence;
    checkMatch(h, 20);
    if (confidence > prevConf) break; // found a heading
  }

  // If still low, check the first 1000 characters of the body
  if (confidence < 30) {
    const bodyText = (document.body.textContent || '').substring(0, 1000).toLowerCase();
    checkMatch(bodyText, 10);
  }

  return {
    isPolicy: confidence > 30,
    type: confidence > 30 ? type : "unknown",
    confidence: Math.min(confidence, 100),
    signals
  };
}
