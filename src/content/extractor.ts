import type { PolicyDocument, PolicyDetection } from '../types/policy';

export function extractPolicyContent(detection: PolicyDetection): PolicyDocument {
  // Clone the body to avoid modifying the actual page
  const root = document.body.cloneNode(true) as HTMLElement;

  // Elements to remove
  const badSelectors = [
    'nav', 'header', 'footer', 'aside', 'script', 'style', 'noscript', 'iframe',
    'svg', 'form', 'button', '.cookie-banner', '#cookie-banner', '.menu', '#menu',
    '.sidebar', '#sidebar', '.ads', '#ads', '.social', '.share', 'video', 'audio',
    'img'
  ];

  badSelectors.forEach(selector => {
    const els = root.querySelectorAll(selector);
    els.forEach(el => el.remove());
  });

  // Try to find the best content container
  let container = root;
  const article = root.querySelector('article');
  const main = root.querySelector('main');
  
  if (article && article.textContent && article.textContent.length > 500) {
    container = article as HTMLElement;
  } else if (main && main.textContent && main.textContent.length > 500) {
    container = main as HTMLElement;
  } else {
    // Look for a div with a lot of text
    const divs = Array.from(root.querySelectorAll('div'));
    let maxTextLen = 0;
    let bestDiv = root;
    for (const div of divs) {
      // Exclude divs that have too many nested divs (often layout containers)
      const childDivs = div.querySelectorAll('div').length;
      if (childDivs > 5) continue;
      
      const textLen = (div.textContent || '').trim().length;
      if (textLen > maxTextLen) {
        maxTextLen = textLen;
        bestDiv = div;
      }
    }
    if (maxTextLen > 500) {
      container = bestDiv;
    }
  }

  // Extract clean text
  let extractedText = extractCleanText(container);
  
  // Clean up excessive newlines
  extractedText = extractedText.replace(/\n{3,}/g, '\n\n').trim();

  const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;
  const characterCount = extractedText.length;
  // Use a configurable word-per-minute constant (e.g. 250)
  const estimatedReadingMinutes = Math.ceil(wordCount / 250) || 1;

  return {
    title: document.title,
    url: window.location.href,
    domain: window.location.hostname,
    type: detection.type,
    confidence: detection.confidence,
    wordCount,
    characterCount,
    estimatedReadingMinutes,
    extractedText
  };
}

function extractCleanText(element: HTMLElement): string {
  let text = '';
  
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent;
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      
      if (/^h[1-6]$/.test(tag)) {
        text += `\n\n${(el.textContent || '').trim()}\n\n`;
      } else if (tag === 'p') {
        text += `\n\n${(el.textContent || '').trim()}`;
      } else if (tag === 'li') {
        text += `\n• ${(el.textContent || '').trim()}`;
      } else if (tag === 'br') {
        text += '\n';
      } else if (tag === 'div' || tag === 'section') {
        text += `\n${extractCleanText(el)}\n`;
      } else {
        // inline elements or others
        text += extractCleanText(el);
      }
    }
  }
  
  return text;
}
