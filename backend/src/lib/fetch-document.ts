/**
 * fetch-document.ts
 *
 * SSRF-protected background document retriever for PrivacyLens.
 * Validates URL, blocks private/internal destinations, fetches with
 * strict timeout and size cap, extracts clean text from HTML.
 *
 * Security is the highest priority — do not relax SSRF checks for convenience.
 */

import { URL } from "url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2_000_000; // 2 MB
const MAX_REDIRECTS = 5; // Node fetch follows up to this many (via native)

// Private IPv4 ranges (CIDR-aware prefix checks)
const PRIVATE_IPV4_PREFIXES = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^127\./,          // loopback
  /^0\./,            // "this" network
  /^169\.254\./,     // link-local
  /^100\.(6[4-9]|[7-9]\d|1([01]\d|2[0-7]))\./,  // shared address space RFC 6598
  /^198\.18\./,      // benchmark
  /^198\.19\./,
  /^240\./,          // reserved
];

// ---------------------------------------------------------------------------
// Error categories for clear reporting
// ---------------------------------------------------------------------------

export type FetchErrorCategory =
  | "invalid_url"
  | "ssrf_blocked"
  | "http_error_4xx"
  | "http_error_5xx"
  | "content_type"
  | "timeout"
  | "size_limit"
  | "no_content"
  | "network_error";

// ---------------------------------------------------------------------------
// SSRF URL Validation — called on both original and redirect-resolved URLs
// ---------------------------------------------------------------------------

export function validateUrl(rawUrl: string): { ok: true; parsed: URL } | { ok: false; error: string; category: FetchErrorCategory } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL format", category: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs are allowed", category: "ssrf_blocked" };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Reject internal/reserved hostnames
  if (
    hostname === "localhost" ||
    hostname === "local" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".corp") ||
    hostname.endsWith(".lan") ||
    hostname.endsWith(".home") ||
    hostname.endsWith(".localdomain")
  ) {
    return { ok: false, error: "Internal hostnames are not allowed", category: "ssrf_blocked" };
  }

  // Reject IPv6 loopback/link-local
  if (
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.startsWith("fe80:") ||
    hostname.startsWith("[fe80:")
  ) {
    return { ok: false, error: "IPv6 loopback/link-local not allowed", category: "ssrf_blocked" };
  }

  // Reject private IPv4 ranges
  for (const pattern of PRIVATE_IPV4_PREFIXES) {
    if (pattern.test(hostname)) {
      return { ok: false, error: "Private/loopback IP addresses are not allowed", category: "ssrf_blocked" };
    }
  }

  // Reject raw IPv4 addresses entirely (prevents numeric encoding attacks)
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
    return { ok: false, error: "Raw IP addresses are not allowed", category: "ssrf_blocked" };
  }

  return { ok: true, parsed };
}

// ---------------------------------------------------------------------------
// HTML → plain-text extraction
// ---------------------------------------------------------------------------

export function extractTextFromHtml(html: string): string {
  // Remove script, style, noscript, comments
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  // Convert block tags to newlines
  text = text
    .replace(/<\/?(p|div|section|article|main|li|tr|br|h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<\/?(ul|ol|table|thead|tbody|tfoot)\b[^>]*>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/gi, (_, code) => String.fromCharCode(parseInt(code, 10)));

  // Collapse whitespace
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

// ---------------------------------------------------------------------------
// Content hash for duplicate detection
// ---------------------------------------------------------------------------

/**
 * Returns a lightweight fingerprint of extracted text for duplicate detection.
 * Normalizes whitespace and takes the first 2000 characters.
 * Deterministic — no AI.
 */
export function contentFingerprint(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().substring(0, 2000).toLowerCase();
  // Simple djb2-style hash
  let hash = 5381;
  for (let i = 0; i < normalized.length; i++) {
    hash = ((hash << 5) + hash) ^ normalized.charCodeAt(i);
    hash = hash >>> 0; // unsigned 32-bit
  }
  return hash.toString(16);
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface FetchDocumentResult {
  ok: true;
  text: string;
  title: string;
  finalUrl: string;
  contentFingerprint: string;
}

export interface FetchDocumentError {
  ok: false;
  error: string;
  category: FetchErrorCategory;
  retryable: boolean;
}

// ---------------------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------------------

async function attemptFetch(rawUrl: string): Promise<FetchDocumentResult | FetchDocumentError> {
  const validation = validateUrl(rawUrl);
  if (!validation.ok) {
    return { ok: false, error: validation.error, category: validation.category, retryable: false };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(rawUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "PrivacyLens/1.0 (privacy policy reader; +https://privacylens.app)",
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Cache-Control": "no-cache",
      },
      redirect: "follow",
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === "AbortError") {
      return { ok: false, error: "Request timed out after 15 seconds", category: "timeout", retryable: false };
    }
    return { ok: false, error: err?.message ?? "Network error", category: "network_error", retryable: true };
  } finally {
    clearTimeout(timeoutId);
  }

  // Validate redirect target is also safe
  const finalUrl = response.url || rawUrl;
  if (finalUrl !== rawUrl) {
    const redirectValidation = validateUrl(finalUrl);
    if (!redirectValidation.ok) {
      return { ok: false, error: `Redirect target blocked: ${redirectValidation.error}`, category: "ssrf_blocked", retryable: false };
    }
  }

  // HTTP status validation
  if (response.status >= 400 && response.status < 500) {
    return { ok: false, error: `HTTP ${response.status} — document not available`, category: "http_error_4xx", retryable: false };
  }
  if (response.status >= 500) {
    return { ok: false, error: `HTTP ${response.status} — server error`, category: "http_error_5xx", retryable: true };
  }
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status}`, category: "http_error_4xx", retryable: false };
  }

  // Content-type validation — broader than before to support legitimate variations
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  const isAcceptable =
    contentType.includes("text/html") ||
    contentType.includes("text/plain") ||
    contentType.includes("application/xhtml") ||
    contentType.includes("text/xml") ||
    contentType.includes("application/xml");

  if (!isAcceptable) {
    return { ok: false, error: `Unsupported content type: ${contentType || "(empty)"}`, category: "content_type", retryable: false };
  }

  // Stream with size limit
  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, error: "No response body", category: "no_content", retryable: false };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          truncated = true;
          // Include what we have so far (still useful for most policies)
          chunks.push(value.slice(0, value.length - (totalBytes - MAX_RESPONSE_BYTES)));
          break;
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  const decoder = new TextDecoder("utf-8", { fatal: false });
  let html = "";
  for (const chunk of chunks) {
    html += decoder.decode(chunk, { stream: true });
  }
  html += decoder.decode();

  if (truncated) {
    console.warn(`[PrivacyLens] Response truncated at ${MAX_RESPONSE_BYTES} bytes for: ${finalUrl}`);
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]{0,300})<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1] : "";
  const title = rawTitle
    .replace(/&[a-zA-Z]+;/gi, " ")
    .replace(/&#\d+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim() || new URL(finalUrl).hostname;

  const text = extractTextFromHtml(html);

  if (text.length < 100) {
    return { ok: false, error: "Page appears to contain no meaningful text", category: "no_content", retryable: false };
  }

  const fingerprint = contentFingerprint(text);

  return { ok: true, text, title, finalUrl, contentFingerprint: fingerprint };
}

// ---------------------------------------------------------------------------
// Public API: fetchDocument with 5xx retry
// ---------------------------------------------------------------------------

export async function fetchDocument(rawUrl: string): Promise<FetchDocumentResult | FetchDocumentError> {
  const first = await attemptFetch(rawUrl);

  // Retry once on transient server errors (5xx only)
  if (!first.ok && first.retryable && first.category === "http_error_5xx") {
    console.warn(`[PrivacyLens] Retrying fetch for ${rawUrl} after 5xx...`);
    await new Promise(r => setTimeout(r, 800));
    return attemptFetch(rawUrl);
  }

  return first;
}
