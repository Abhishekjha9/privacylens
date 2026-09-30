/**
 * link-parser.ts
 *
 * Server-side link parser for the legal hub discovery flow.
 * Parses legal document links from text/HTML without DOM access.
 * Used exclusively by the /api/discover-hub endpoint.
 *
 * This is a simplified scoring pass — the full scoring happens in the extension.
 * Recognized patterns must be conservative to avoid false positives.
 */

// ---------------------------------------------------------------------------
// Pattern matching — must match exactly what link-discoverer.ts classifies
// ---------------------------------------------------------------------------

const PRIVACY_TEXT = [
  /\bprivacy\s+policy\b/i,
  /\bprivacy\s+notice\b/i,
  /\bprivacy\s+statement\b/i,
  /\bdata\s+privacy\b/i,
  /^\s*privacy\s*$/i,
];

const PRIVACY_URL = [
  /\/privacy[-_]?policy\b/i,
  /\/privacy[-_]?notice\b/i,
  /\/privacy\/?$/i,
  /\/privacypolicy/i,
];

const TERMS_TEXT = [
  /\bterms\s+of\s+service\b/i,
  /\bterms\s+of\s+use\b/i,
  /\bterms\s+(and|&)\s+conditions\b/i,
  /\buser\s+agreement\b/i,
  /\beula\b/i,
  /^\s*terms\s*$/i,
];

const TERMS_URL = [
  /\/terms[-_]?of[-_]?service\b/i,
  /\/terms[-_]?of[-_]?use\b/i,
  /\/user[-_]?agreement\b/i,
  /\/tos\b/i,
  /\/eula\b/i,
  /\/terms\/?$/i,
];

const COOKIE_TEXT = [
  /\bcookie\s+policy\b/i,
  /\bcookie\s+notice\b/i,
];

const COOKIE_URL = [
  /\/cookie[-_]?policy\b/i,
  /\/cookies?\/?$/i,
];

const IGNORE_URL = [
  /\/careers?\b/i, /\/about\b/i, /\/blog\b/i, /\/press\b/i,
  /\/investors?\b/i, /\/advertis/i, /mailto:/i, /javascript:/i,
];

type DocType = "privacy" | "terms" | "cookie";

function classifyUrl(url: string, text: string): DocType | null {
  const u = url.toLowerCase();
  const t = text.trim();

  for (const p of IGNORE_URL) if (p.test(u)) return null;

  const checks: [DocType, RegExp[], RegExp[]][] = [
    ["privacy", PRIVACY_TEXT, PRIVACY_URL],
    ["terms", TERMS_TEXT, TERMS_URL],
    ["cookie", COOKIE_TEXT, COOKIE_URL],
  ];

  for (const [type, textPats, urlPats] of checks) {
    const textMatch = textPats.some(p => p.test(t));
    const urlMatch = urlPats.some(p => p.test(u));
    if (textMatch || urlMatch) return type;
  }
  return null;
}

function resolveUrl(href: string, base: string): string | null {
  if (!href || href.startsWith("javascript:") || href.startsWith("mailto:") || href.trim() === "#") return null;
  try {
    return new URL(href.trim(), base).href;
  } catch {
    return null;
  }
}

function normalizeForDedup(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.href.toLowerCase();
  } catch {
    return url.replace(/\/$/, "").toLowerCase().split("#")[0];
  }
}

export interface ParsedLink {
  url: string;
  text: string;
  type: "privacy" | "terms" | "cookie";
  confidence: "high" | "medium";
}

/**
 * Parses legal document links from text content.
 * Works with the plain text returned by fetchDocument.
 * Returns classified links, deduped.
 */
export function parseLinksFromHtml(text: string, baseUrl: string): ParsedLink[] {
  // Attempt to extract URLs from text using patterns like:
  // https://example.com/privacy — common in plain-text policy pages
  const urlRegex = /https?:\/\/[^\s"'<>()[\]{}|\\^~`]+/gi;
  const found: ParsedLink[] = [];
  const seenNorm = new Set<string>();

  const matches = text.match(urlRegex) || [];
  for (const rawUrl of matches) {
    const url = resolveUrl(rawUrl, baseUrl);
    if (!url) continue;

    const normUrl = normalizeForDedup(url);
    if (seenNorm.has(normUrl)) continue;

    // Use just URL for classification (no anchor text in plain text)
    const docType = classifyUrl(url, "");
    if (!docType) continue;

    seenNorm.add(normUrl);
    found.push({
      url,
      text: docType === "privacy" ? "Privacy Policy" : docType === "terms" ? "Terms of Service" : "Cookie Policy",
      type: docType,
      confidence: "medium",
    });
  }

  return found.slice(0, 5); // hard cap — hub should not return dozens
}
