import { describe, it, expect } from 'vitest';
import { validateUrl, extractTextFromHtml, contentFingerprint } from './fetch-document';

// ---------------------------------------------------------------------------
// validateUrl — SSRF protection (Tests 14-24)
// ---------------------------------------------------------------------------

describe('validateUrl — SSRF protection', () => {
  // Test 17: localhost
  it('blocks localhost variants', () => {
    expect(validateUrl('http://localhost/test').ok).toBe(false);
    expect(validateUrl('http://localhost:3000/admin').ok).toBe(false);
    expect(validateUrl('http://localhost:8080/secret').ok).toBe(false);
  });

  // Test 18: private IPv4
  it('blocks private IPv4 ranges', () => {
    expect(validateUrl('http://192.168.1.1/').ok).toBe(false);
    expect(validateUrl('http://10.0.0.1/secret').ok).toBe(false);
    expect(validateUrl('http://172.16.0.1/').ok).toBe(false);
    expect(validateUrl('http://127.0.0.1/').ok).toBe(false);
    expect(validateUrl('http://169.254.169.254/').ok).toBe(false); // link-local (AWS metadata)
    expect(validateUrl('http://100.64.0.1/').ok).toBe(false);      // shared address space
  });

  // Test 19: IPv6 loopback
  it('blocks IPv6 loopback and link-local addresses', () => {
    expect(validateUrl('http://[::1]/').ok).toBe(false);
    expect(validateUrl('http://::1/').ok).toBe(false);
  });

  // Test 23: invalid protocol
  it('blocks non-http/https schemes', () => {
    expect(validateUrl('ftp://example.com').ok).toBe(false);
    expect(validateUrl('file:///etc/passwd').ok).toBe(false);
    expect(validateUrl('javascript:alert(1)').ok).toBe(false);
    expect(validateUrl('data:text/html,<h1>xss</h1>').ok).toBe(false);
  });

  // Test 20: internal hostnames
  it('blocks internal hostname patterns', () => {
    expect(validateUrl('http://internal.corp/').ok).toBe(false);
    expect(validateUrl('http://server.local/').ok).toBe(false);
    expect(validateUrl('http://db.internal/').ok).toBe(false);
    expect(validateUrl('http://host.lan/').ok).toBe(false);
    expect(validateUrl('http://mail.home/').ok).toBe(false);
    expect(validateUrl('http://server.localdomain/').ok).toBe(false);
  });

  // Raw IP addresses
  it('blocks raw IP address literals', () => {
    expect(validateUrl('http://1.2.3.4/').ok).toBe(false);
    expect(validateUrl('https://8.8.8.8/').ok).toBe(false);
  });

  // Invalid format
  it('rejects invalid URL format', () => {
    expect(validateUrl('not-a-url').ok).toBe(false);
    expect(validateUrl('').ok).toBe(false);
    expect(validateUrl('  ').ok).toBe(false);
  });

  // Valid public URLs — allow
  it('allows legitimate public URLs', () => {
    expect(validateUrl('https://example.com/privacy').ok).toBe(true);
    expect(validateUrl('https://linkedin.com/legal/user-agreement').ok).toBe(true);
    expect(validateUrl('http://google.com/terms').ok).toBe(true);
    expect(validateUrl('https://apple.com/legal/privacy/').ok).toBe(true);
  });

  // Error category classification
  it('sets the correct error category', () => {
    const ssrfResult = validateUrl('http://localhost/admin');
    expect(ssrfResult.ok).toBe(false);
    if (!ssrfResult.ok) expect(ssrfResult.category).toBe('ssrf_blocked');

    const schemeResult = validateUrl('ftp://example.com');
    expect(schemeResult.ok).toBe(false);
    if (!schemeResult.ok) expect(schemeResult.category).toBe('ssrf_blocked');

    const invalidResult = validateUrl('not-a-url');
    expect(invalidResult.ok).toBe(false);
    if (!invalidResult.ok) expect(invalidResult.category).toBe('invalid_url');
  });
});

// ---------------------------------------------------------------------------
// extractTextFromHtml
// ---------------------------------------------------------------------------

describe('extractTextFromHtml', () => {
  // Test 14: Valid HTML extraction
  it('extracts meaningful text from valid HTML', () => {
    const html = '<html><body><h1>Privacy Policy</h1><p>We collect your data.</p></body></html>';
    const text = extractTextFromHtml(html);
    expect(text).toContain('Privacy Policy');
    expect(text).toContain('We collect your data.');
  });

  it('strips script tags', () => {
    const html = '<html><head><script>alert("xss")</script></head><body><p>Privacy Policy text</p></body></html>';
    const text = extractTextFromHtml(html);
    expect(text).not.toContain('alert');
    expect(text).toContain('Privacy Policy text');
  });

  it('strips style tags', () => {
    const html = '<html><head><style>body { color: red }</style></head><body><p>Terms</p></body></html>';
    const text = extractTextFromHtml(html);
    expect(text).not.toContain('color: red');
    expect(text).toContain('Terms');
  });

  it('decodes HTML entities', () => {
    const html = '<p>Terms &amp; Conditions &lt;legal&gt; &quot;quoted&quot;</p>';
    const text = extractTextFromHtml(html);
    expect(text).toContain('Terms & Conditions');
    expect(text).toContain('<legal>');
    expect(text).toContain('"quoted"');
  });

  // Test 21: oversized response — text is truncated before this function
  it('handles large inputs without crashing', () => {
    const bigHtml = '<p>' + 'a'.repeat(500_000) + '</p>';
    const text = extractTextFromHtml(bigHtml);
    expect(text.length).toBeGreaterThan(0);
  });

  it('collapses excessive whitespace and newlines', () => {
    const html = '<p>Hello   world</p>\n\n\n\n<p>Second paragraph</p>';
    const text = extractTextFromHtml(html);
    expect(text.match(/\n{3,}/)).toBeNull();
    expect(text).not.toMatch(/  +/);
  });

  it('converts block-level tags to newlines', () => {
    const html = '<div>Section 1</div><div>Section 2</div>';
    const text = extractTextFromHtml(html);
    expect(text).toContain('Section 1');
    expect(text).toContain('Section 2');
  });
});

// ---------------------------------------------------------------------------
// contentFingerprint — deterministic duplicate detection
// ---------------------------------------------------------------------------

describe('contentFingerprint', () => {
  it('returns the same fingerprint for identical text', () => {
    const fp1 = contentFingerprint('Privacy Policy. We collect your name and email.');
    const fp2 = contentFingerprint('Privacy Policy. We collect your name and email.');
    expect(fp1).toBe(fp2);
  });

  it('returns different fingerprints for different text', () => {
    const fp1 = contentFingerprint('Privacy Policy. We collect your name.');
    const fp2 = contentFingerprint('Terms of Service. By using this service you agree.');
    expect(fp1).not.toBe(fp2);
  });

  it('normalizes whitespace before fingerprinting', () => {
    const fp1 = contentFingerprint('Privacy  Policy.\n\nWe collect.');
    const fp2 = contentFingerprint('Privacy Policy. We collect.');
    expect(fp1).toBe(fp2);
  });

  it('handles empty string without error', () => {
    const fp = contentFingerprint('');
    expect(typeof fp).toBe('string');
  });

  it('returns a hex string', () => {
    const fp = contentFingerprint('Some policy text');
    expect(fp).toMatch(/^[0-9a-f]+$/);
  });
});
