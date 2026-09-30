/**
 * link-discoverer.ts
 *
 * Discovers legal/privacy document links on the current page.
 * Uses a deterministic scoring system to classify and rank links.
 * Does NOT navigate the tab — only inspects the existing DOM.
 *
 * Scoring model:
 *   text+url match  → base confidence score
 *   same-origin     → +15 pts
 *   in footer/legal → +10 pts
 *   surrounding ctx → +5 pts
 *   Low score (<15) → discarded
 */

import type { DiscoveredLink, DiscoveredDocType, DiscoveredConfidence } from '../types/policy';

// ---------------------------------------------------------------------------
// Score → Confidence mapping
// ---------------------------------------------------------------------------

function scoreToConfidence(score: number): DiscoveredConfidence | null {
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  if (score >= 15) return 'low';
  return null; // discard
}

// ---------------------------------------------------------------------------
// URL normalisation for deduplication
// ---------------------------------------------------------------------------

export function normalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    // remove fragment
    u.hash = '';
    // remove default ports
    if ((u.protocol === 'http:' && u.port === '80') ||
        (u.protocol === 'https:' && u.port === '443')) {
      u.port = '';
    }
    // normalise trailing slash: treat /privacy and /privacy/ as same
    let path = u.pathname.replace(/\/+$/, '') || '/';
    u.pathname = path;
    return u.href.toLowerCase();
  } catch {
    return url.replace(/\/$/, '').toLowerCase().split('#')[0];
  }
}

// ---------------------------------------------------------------------------
// Registrable domain helper (simple eTLD+1 for same-site preference)
// ---------------------------------------------------------------------------

function getRegistrableDomain(hostname: string): string {
  const parts = hostname.toLowerCase().split('.');
  if (parts.length <= 2) return hostname.toLowerCase();
  return parts.slice(-2).join('.');
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function getAnchorSurroundingText(anchor: Element): string {
  const parent = anchor.parentElement;
  if (!parent) return '';
  return (parent.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 200);
}

function isInFooterOrLegalSection(anchor: Element): boolean {
  let el: Element | null = anchor;
  const limit = 8;
  let depth = 0;
  while (el && depth < limit) {
    const tag = el.tagName?.toLowerCase();
    const id = (el.id || '').toLowerCase();
    const cls = (el.className?.toString() || '').toLowerCase();
    const ariaLabel = (el.getAttribute?.('aria-label') || '').toLowerCase();

    if (tag === 'footer') return true;
    if (/(footer|legal|compliance|policy[-_]links)/i.test(id + ' ' + cls + ' ' + ariaLabel)) return true;

    el = el.parentElement;
    depth++;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Ignore patterns (navigation noise)
// ---------------------------------------------------------------------------

const IGNORE_TEXT_EXACT = [
  /^\s*(careers?|about(\s+us)?|security|accessibility|contact(\s+us)?|press|blog|status|help|support|site\s*map|investor|advertis|partner|media|news|jobs?|faq|download|app)\s*$/i,
  /^\s*\d+\s*$/,
];

const IGNORE_URL_FRAGMENTS = [
  /\/careers?(\/|$)/i, /\/about(\/|$)/i, /\/blog(\/|$)/i, /\/press(\/|$)/i,
  /\/investors?(\/|$)/i, /\/advertis/i, /\/news(\/|$)/i, /\/jobs(\/|$)/i,
  /\/download(\/|$)/i, /\/app(\/|$)/i, /\/faq(\/|$)/i,
  /^mailto:/i, /^javascript:/i,
];

// ---------------------------------------------------------------------------
// Scoring rules per document type
// ---------------------------------------------------------------------------

interface ScoringRule {
  type: DiscoveredDocType;
  textPatterns: { pattern: RegExp; score: number }[];
  urlPatterns: { pattern: RegExp; score: number }[];
}

const SCORING_RULES: ScoringRule[] = [
  // ── Privacy Policy ──────────────────────────────────────────────────
  {
    type: 'privacy',
    textPatterns: [
      { pattern: /\bprivacy\s+policy\b/i, score: 50 },
      { pattern: /\bprivacy\s+notice\b/i, score: 50 },
      { pattern: /\bprivacy\s+statement\b/i, score: 50 },
      { pattern: /\bdata\s+privacy\b/i, score: 45 },
      { pattern: /\bprivacy\s+practices\b/i, score: 40 },
      { pattern: /^\s*privacy\s*$/i, score: 30 },
    ],
    urlPatterns: [
      { pattern: /\/privacy[-_]?policy\b/i, score: 35 },
      { pattern: /\/privacy[-_]?notice\b/i, score: 35 },
      { pattern: /\/privacy[-_]?statement\b/i, score: 35 },
      { pattern: /\/data[-_]?privacy\b/i, score: 35 },
      { pattern: /\/privacy\/?$/i, score: 25 },
      { pattern: /\/privacypolicy/i, score: 30 },
    ],
  },
  // ── Terms of Service ────────────────────────────────────────────────
  {
    type: 'terms',
    textPatterns: [
      { pattern: /\bterms\s+of\s+service\b/i, score: 50 },
      { pattern: /\bterms\s+of\s+use\b/i, score: 50 },
      { pattern: /\bterms\s+(and|&)\s+conditions\b/i, score: 50 },
      { pattern: /\buser\s+agreement\b/i, score: 50 },
      { pattern: /\bservice\s+agreement\b/i, score: 45 },
      { pattern: /\beula\b/i, score: 45 },
      { pattern: /\bend\s+user\s+licen[sc]e/i, score: 45 },
      { pattern: /^\s*terms\s*$/i, score: 30 },
      { pattern: /\bconditions\b/i, score: 20 },
    ],
    urlPatterns: [
      { pattern: /\/terms[-_]?of[-_]?service\b/i, score: 35 },
      { pattern: /\/terms[-_]?of[-_]?use\b/i, score: 35 },
      { pattern: /\/user[-_]?agreement\b/i, score: 35 },
      { pattern: /\/service[-_]?agreement\b/i, score: 35 },
      { pattern: /\/tos\b/i, score: 35 },
      { pattern: /\/eula\b/i, score: 35 },
      { pattern: /\/terms\/?$/i, score: 25 },
      { pattern: /\/conditions\b/i, score: 20 },
    ],
  },
  // ── Cookie Policy ───────────────────────────────────────────────────
  {
    type: 'cookie',
    textPatterns: [
      { pattern: /\bcookie\s+policy\b/i, score: 50 },
      { pattern: /\bcookie\s+notice\b/i, score: 50 },
      { pattern: /\bcookies?\s+settings?\b/i, score: 40 },
      { pattern: /\bcookies?\s+policy\b/i, score: 50 },
    ],
    urlPatterns: [
      { pattern: /\/cookie[-_]?policy\b/i, score: 35 },
      { pattern: /\/cookie[-_]?notice\b/i, score: 35 },
      { pattern: /\/cookies?\/?$/i, score: 25 },
    ],
  },
  // ── Legal Hub ───────────────────────────────────────────────────────
  {
    type: 'other',
    textPatterns: [
      { pattern: /\blegal\s*(center|hub|info|notices?)?\b/i, score: 35 },
      { pattern: /\bprivacy\s+center\b/i, score: 35 },
      { pattern: /\btrust\s+(center|hub)\b/i, score: 35 },
      { pattern: /\bcompliance\s+center\b/i, score: 30 },
    ],
    urlPatterns: [
      { pattern: /\/legal\/?$/i, score: 25 },
      { pattern: /\/legal[-_]?(center|hub|notices?)\b/i, score: 30 },
      { pattern: /\/privacy[-_]?center\b/i, score: 30 },
      { pattern: /\/trust[-_]?(center|hub)\b/i, score: 30 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Internal scored result
// ---------------------------------------------------------------------------

interface ScoredLink {
  url: string;
  normalizedUrl: string;
  text: string;
  type: DiscoveredDocType;
  score: number;
  confidence: DiscoveredConfidence;
  isSameOrigin: boolean;
  isSameDomain: boolean;
  inFooter: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveUrl(href: string, baseUrl: string): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h === '#' || h.startsWith('javascript:') || h.startsWith('mailto:') || h.startsWith('tel:')) return null;
  try {
    return new URL(h, baseUrl).href;
  } catch {
    return null;
  }
}

function scoreLink(
  absUrl: string,
  text: string,
  ariaLabel: string,
  title: string,
  surroundingText: string,
): { type: DiscoveredDocType; score: number } | null {
  const url = absUrl.toLowerCase();
  // Combine text signals
  const combinedText = [text, ariaLabel, title].filter(Boolean).join(' ').trim();

  // Check ignore patterns
  for (const p of IGNORE_TEXT_EXACT) {
    if (p.test(combinedText)) return null;
  }
  for (const p of IGNORE_URL_FRAGMENTS) {
    if (p.test(absUrl)) return null;
  }

  let bestType: DiscoveredDocType | null = null;
  let bestScore = 0;

  for (const rule of SCORING_RULES) {
    let score = 0;

    // Text score
    for (const { pattern, score: pts } of rule.textPatterns) {
      if (pattern.test(combinedText)) {
        score += pts;
        break; // take best match per rule group
      }
    }

    // URL score
    for (const { pattern, score: pts } of rule.urlPatterns) {
      if (pattern.test(url)) {
        score += pts;
        break;
      }
    }

    // Surrounding text bonus (+5)
    if (score > 0 && /privacy|terms|legal|cookie/i.test(surroundingText)) {
      score += 5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestType = rule.type;
    }
  }

  if (!bestType || bestScore === 0) return null;
  return { type: bestType, score: bestScore };
}

// ---------------------------------------------------------------------------
// Main discovery function
// ---------------------------------------------------------------------------

/**
 * Discovers relevant legal document links on the current page.
 * Returns deduplicated, classified, scored links.
 *
 * Returns up to 3 direct documents (Privacy, Terms, Cookie).
 * If none found, returns hub candidates for the legal-hub discovery flow.
 * Also returns additionalCount for any extra documents beyond the limit.
 */
export interface DiscoveryResult {
  links: DiscoveredLink[];
  hubCandidates: DiscoveredLink[];
  additionalCount: number;
}

export function discoverLegalLinks(): DiscoveryResult {
  const baseUrl = window.location.href;
  const currentOrigin = window.location.origin;

  let currentHostname = '';
  try { currentHostname = new URL(baseUrl).hostname; } catch {}
  const currentDomain = getRegistrableDomain(currentHostname);

  const allAnchors = Array.from(document.querySelectorAll('a[href]'));
  const scored: ScoredLink[] = [];
  const seenNormalized = new Set<string>();

  for (const anchor of allAnchors) {
    const rawHref = anchor.getAttribute('href') || '';
    const absUrl = resolveUrl(rawHref, baseUrl);
    if (!absUrl) continue;

    const normUrl = normalizeUrlForDedup(absUrl);
    if (seenNormalized.has(normUrl)) continue;

    const text = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    const ariaLabel = anchor.getAttribute('aria-label') || '';
    const titleAttr = anchor.getAttribute('title') || '';
    const surrounding = getAnchorSurroundingText(anchor);
    const inFooter = isInFooterOrLegalSection(anchor);

    const result = scoreLink(absUrl, text, ariaLabel, titleAttr, surrounding);
    if (!result) continue;

    // Origin/domain membership
    let linkOrigin = '';
    let linkHostname = '';
    try {
      const u = new URL(absUrl);
      linkOrigin = u.origin;
      linkHostname = u.hostname;
    } catch {}

    const isSameOrigin = linkOrigin === currentOrigin;
    const isSameDomain = getRegistrableDomain(linkHostname) === currentDomain;

    // Apply bonuses deterministically
    let finalScore = result.score;
    if (isSameOrigin) finalScore += 15;
    else if (isSameDomain) finalScore += 10;
    if (inFooter) finalScore += 10;
    // Surrounding text bonus already applied in scoreLink

    const confidence = scoreToConfidence(finalScore);
    if (!confidence) continue;

    seenNormalized.add(normUrl);

    scored.push({
      url: absUrl,
      normalizedUrl: normUrl,
      text: text || ariaLabel || titleAttr || absUrl,
      type: result.type,
      score: finalScore,
      confidence,
      isSameOrigin,
      isSameDomain,
      inFooter,
    });
  }

  // Sort: same-origin first, then by score descending, then by type priority
  const TYPE_ORDER: Record<DiscoveredDocType, number> = { privacy: 0, terms: 1, cookie: 2, other: 3 };

  scored.sort((a, b) => {
    // Same-origin preference
    if (a.isSameOrigin !== b.isSameOrigin) return a.isSameOrigin ? -1 : 1;
    if (a.isSameDomain !== b.isSameDomain) return a.isSameDomain ? -1 : 1;
    // Score descending
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    // Type order ascending
    return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  });

  // Separate hub candidates from direct docs
  const hubCandidates: DiscoveredLink[] = scored
    .filter(l => l.type === 'other')
    .map(l => ({ url: l.url, text: l.text, type: l.type, confidence: l.confidence }));

  const directDocs = scored.filter(l => l.type !== 'other');

  // Select best per type (max 3 types: privacy, terms, cookie)
  const selected: ScoredLink[] = [];
  const typeSeen = new Set<DiscoveredDocType>();

  for (const link of directDocs) {
    if (typeSeen.has(link.type)) continue;
    typeSeen.add(link.type);
    selected.push(link);
    if (selected.length >= 3) break;
  }

  // Count additional documents not selected
  const additionalCount = directDocs.filter(l => !selected.includes(l) && l.confidence !== 'low').length;

  const links: DiscoveredLink[] = selected.map(l => ({
    url: l.url,
    text: l.text,
    type: l.type,
    confidence: l.confidence,
  }));

  return { links, hubCandidates, additionalCount };
}

// ---------------------------------------------------------------------------
// Parse links from retrieved hub HTML (used by the hub discovery flow)
// ---------------------------------------------------------------------------

/**
 * Parse legal document links from an already-retrieved hub page HTML string.
 * Used by the backend hub fetcher. Returns classified DiscoveredLink[].
 */
export function parseLinksFromHtml(
  html: string,
  hubUrl: string,
): DiscoveredLink[] {
  // Extract href + text pairs using a simple regex (no DOM available on backend)
  const anchorRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const found: DiscoveredLink[] = [];
  const seenNorm = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = anchorRegex.exec(html)) !== null) {
    const rawHref = match[1];
    const innerHtml = match[2];
    const text = innerHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    const absUrl = resolveUrl(rawHref, hubUrl);
    if (!absUrl) continue;

    const normUrl = normalizeUrlForDedup(absUrl);
    if (seenNorm.has(normUrl)) continue;

    const result = scoreLink(absUrl, text, '', '', '');
    if (!result || result.type === 'other') continue;

    const confidence = scoreToConfidence(result.score);
    if (!confidence || confidence === 'low') continue;

    seenNorm.add(normUrl);
    found.push({ url: absUrl, text: text || absUrl, type: result.type, confidence });
  }

  return found;
}
