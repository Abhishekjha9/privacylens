/**
 * login-detector.ts
 *
 * Detects whether the current page is a login / signup / consent page
 * using heuristic signals from the DOM.
 */

import type { LoginPageDetection } from '../types/policy';

// ---------------------------------------------------------------------------
// Signal patterns
// ---------------------------------------------------------------------------

const AUTH_URL_PATTERNS = [
  /\/(login|signin|sign[_-]in|signup|sign[_-]up|register|registration|create[_-]account|join|enroll|auth|oauth|sso|consent|onboard|new[_-]account)/i,
  /[?&](redirect_to|return_url|next|continue)=/i,
];

const AUTH_TEXT_PATTERNS = [
  /\b(sign\s*in|log\s*in|log\s*on|create\s*account|create\s*your\s*account|sign\s*up|register|join\s+now|get\s+started|welcome\s+back)\b/i,
  /\b(continue\s+with\s+(google|microsoft|apple|facebook|github|twitter|linkedin|sso))\b/i,
  /\b(agree\s+and\s+continue|by\s+continuing\s+you\s+agree|i\s+agree\s+to|accept\s+and\s+continue)\b/i,
  /\b(already\s+have\s+an\s+account|don'?t\s+have\s+an\s+account|new\s+to|forgot\s+password)\b/i,
];

// OAuth provider button text / aria labels
const OAUTH_PATTERNS = [
  /continue\s+with\s+(google|microsoft|apple|facebook|github|twitter|linkedin|yahoo|sso)/i,
  /sign\s+in\s+with\s+(google|microsoft|apple|facebook|github|twitter|linkedin)/i,
];

const IGNORED_URLS_FOR_POLICY_PAGE = [
  /\/(privacy|terms|legal|cookie|agreement|user-agreement|tos|eula)/i,
];

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectLoginPage(): LoginPageDetection {
  const url = window.location.href;
  const signals: string[] = [];
  let confidence = 0;

  // Skip if this already looks like a policy page
  for (const p of IGNORED_URLS_FOR_POLICY_PAGE) {
    if (p.test(url)) {
      return { isLoginPage: false, confidence: 0, signals: ['Page URL matches policy pattern — not a login page'] };
    }
  }

  // 1. URL signals (weight 30)
  for (const pattern of AUTH_URL_PATTERNS) {
    if (pattern.test(url)) {
      confidence += 30;
      signals.push(`Auth URL pattern: ${url}`);
      break;
    }
  }

  // 2. Password input (weight 40 — very strong signal)
  const passwordInputs = document.querySelectorAll('input[type="password"]');
  if (passwordInputs.length > 0) {
    confidence += 40;
    signals.push(`Password input field detected (${passwordInputs.length})`);
  }

  // 3. Email input (weight 15)
  const emailInputs = document.querySelectorAll('input[type="email"]');
  if (emailInputs.length > 0) {
    confidence += 15;
    signals.push(`Email input field detected (${emailInputs.length})`);
  }

  // 4. Page title / h1 heading text signals (weight 20 each, max 1)
  const title = document.title.toLowerCase();
  const h1s = Array.from(document.querySelectorAll('h1')).map(el => (el.textContent || '').trim());
  const h2s = Array.from(document.querySelectorAll('h2')).map(el => (el.textContent || '').trim());

  const headingTexts = [title, ...h1s.slice(0, 2), ...h2s.slice(0, 3)];
  let headingMatched = false;
  for (const text of headingTexts) {
    for (const pattern of AUTH_TEXT_PATTERNS) {
      if (pattern.test(text)) {
        if (!headingMatched) {
          confidence += 20;
          headingMatched = true;
        }
        signals.push(`Auth heading text: "${text.substring(0, 60)}"`);
        break;
      }
    }
  }

  // 5. Button text (weight 15)
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'));
  let buttonMatched = false;
  for (const btn of buttons.slice(0, 20)) {
    const btnText = (btn.textContent || (btn as HTMLInputElement).value || btn.getAttribute('aria-label') || '').trim();
    for (const pattern of AUTH_TEXT_PATTERNS) {
      if (pattern.test(btnText)) {
        if (!buttonMatched) {
          confidence += 15;
          buttonMatched = true;
        }
        signals.push(`Auth button: "${btnText.substring(0, 60)}"`);
        break;
      }
    }
    for (const oauthPattern of OAUTH_PATTERNS) {
      if (oauthPattern.test(btnText)) {
        if (!buttonMatched) {
          confidence += 20;
          buttonMatched = true;
        }
        signals.push(`OAuth button: "${btnText.substring(0, 60)}"`);
        break;
      }
    }
  }

  // 6. "By continuing you agree" consent text in body (weight 15)
  const bodyText = (document.body.textContent || '').substring(0, 3000);
  if (/by\s+(signing|continuing|creating|clicking|registering|using)/i.test(bodyText)) {
    confidence += 15;
    signals.push('Consent phrase found in page body');
  }

  // 7. Username input named "username" or "email" (weight 10)
  const usernameInputs = document.querySelectorAll('input[name="username"], input[name="email"], input[name="login"], input[autocomplete="username"], input[autocomplete="email"]');
  if (usernameInputs.length > 0) {
    confidence += 10;
    signals.push(`Username/email input: ${usernameInputs.length}`);
  }

  const clampedConfidence = Math.min(confidence, 100);

  return {
    isLoginPage: clampedConfidence >= 40,
    confidence: clampedConfidence,
    signals,
  };
}
