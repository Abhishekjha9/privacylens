/**
 * Tests for link-discoverer.ts
 * Covers: scoring, deduplication, URL normalization, type priority,
 *         same-origin preference, hub candidates, surrounding text bonus.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { discoverLegalLinks, normalizeUrlForDedup } from './link-discoverer';

// ---------------------------------------------------------------------------
// URL normalisation
// ---------------------------------------------------------------------------

describe('normalizeUrlForDedup', () => {
  it('strips fragments', () => {
    const a = normalizeUrlForDedup('https://example.com/privacy#section1');
    const b = normalizeUrlForDedup('https://example.com/privacy');
    expect(a).toBe(b);
  });

  it('normalizes trailing slash', () => {
    const a = normalizeUrlForDedup('https://example.com/privacy/');
    const b = normalizeUrlForDedup('https://example.com/privacy');
    expect(a).toBe(b);
  });

  it('normalizes default https port', () => {
    const a = normalizeUrlForDedup('https://example.com:443/privacy');
    const b = normalizeUrlForDedup('https://example.com/privacy');
    expect(a).toBe(b);
  });

  it('normalizes default http port', () => {
    const a = normalizeUrlForDedup('http://example.com:80/terms');
    const b = normalizeUrlForDedup('http://example.com/terms');
    expect(a).toBe(b);
  });

  it('lowercases the URL', () => {
    const result = normalizeUrlForDedup('HTTPS://EXAMPLE.COM/Privacy');
    expect(result).toBe(result.toLowerCase());
  });
});

// ---------------------------------------------------------------------------
// DOM-based discovery
// ---------------------------------------------------------------------------

describe('discoverLegalLinks (DOM)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    Object.defineProperty(window, 'location', {
      value: { href: 'https://app.example.com/login', origin: 'https://app.example.com' },
      writable: true,
    });
  });

  // Test 1: Direct Privacy + Terms
  it('detects direct Privacy Policy and Terms of Service links', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
        <a href="https://app.example.com/terms-of-service">Terms of Service</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    const types = links.map(l => l.type);
    expect(types).toContain('privacy');
    expect(types).toContain('terms');
  });

  // Test 2: Privacy detected via aria-label
  it('detects privacy link via aria-label', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/legal/pp" aria-label="Privacy Policy">Legal</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    expect(links.some(l => l.type === 'privacy')).toBe(true);
  });

  // Test 3: Privacy detected via title attribute
  it('detects privacy link via title attribute', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/pp" title="Privacy Policy">Read more</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    expect(links.some(l => l.type === 'privacy')).toBe(true);
  });

  // Test 4: Privacy detected purely from URL
  it('detects privacy link from URL pattern alone', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/privacy-policy">Click here</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    // URL match only gets a lower score, but should still be detected
    expect(links.some(l => l.type === 'privacy')).toBe(true);
  });

  // Test 5: Terms detected from URL
  it('detects terms link from URL pattern alone', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/terms-of-service">Click here</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    expect(links.some(l => l.type === 'terms')).toBe(true);
  });

  // Test 6: Cookie Policy
  it('detects Cookie Policy link', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/cookie-policy">Cookie Policy</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    expect(links.some(l => l.type === 'cookie')).toBe(true);
  });

  // Test 7: Legal hub when no direct docs
  it('returns hub candidates when no direct docs are found', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/legal">Legal Center</a>
      </footer>`;
    const { links, hubCandidates } = discoverLegalLinks();
    expect(links.length).toBe(0);
    expect(hubCandidates.some(l => l.type === 'other')).toBe(true);
  });

  // Test 8: Legal hub with multiple documents — all direct docs returned, hub as candidate
  it('returns direct docs and hub candidate separately', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
        <a href="https://app.example.com/legal">Legal Center</a>
      </footer>`;
    const { links, hubCandidates } = discoverLegalLinks();
    expect(links.some(l => l.type === 'privacy')).toBe(true);
    expect(hubCandidates.some(l => l.type === 'other')).toBe(true);
    // Hub not in main links
    expect(links.every(l => l.type !== 'other')).toBe(true);
  });

  // Test 9: Duplicate links are removed
  it('deduplicates links with same normalized URL', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
        <a href="https://app.example.com/privacy-policy/">Privacy Policy again</a>
        <a href="https://app.example.com/privacy-policy#top">Privacy with hash</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    const privacyLinks = links.filter(l => l.type === 'privacy');
    expect(privacyLinks.length).toBe(1);
  });

  // Test 10: Same-origin preference
  it('prefers same-origin links over cross-origin', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://external-legal.com/privacy">Privacy Policy</a>
        <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    const privacy = links.find(l => l.type === 'privacy');
    expect(privacy?.url).toContain('app.example.com');
  });

  // Test 11: Untrusted external domain — still discoverable but lower priority
  it('does not exclude external links but ranks them lower', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://external-legal.com/privacy-policy">Privacy Policy</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    // External links without same-origin bonus should have lower confidence
    const privacy = links.find(l => l.type === 'privacy');
    expect(privacy).toBeDefined();
    // It shouldn't necessarily be lower confidence if text+URL match perfectly,
    // but the previous test ensures it sorts lower.
  });

  // Test 12: Max 3 documents enforced
  it('enforces maximum 3 direct documents', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
        <a href="https://app.example.com/terms-of-service">Terms of Service</a>
        <a href="https://app.example.com/cookie-policy">Cookie Policy</a>
        <a href="https://app.example.com/user-agreement">User Agreement</a>
      </footer>`;
    const { links, additionalCount } = discoverLegalLinks();
    expect(links.length).toBeLessThanOrEqual(3);
    // additionalCount captures what was not selected
    expect(additionalCount).toBeGreaterThanOrEqual(0);
  });

  // Test 13: Ignores navigation noise
  it('ignores careers, about, blog, help, press links', () => {
    document.body.innerHTML = `
      <nav>
        <a href="/careers">Careers</a>
        <a href="/about">About Us</a>
        <a href="/blog">Blog</a>
        <a href="/help">Help</a>
      </nav>`;
    const { links } = discoverLegalLinks();
    expect(links.length).toBe(0);
  });

  // Test 14: High confidence for text+URL match
  it('assigns high confidence when both text and URL match', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
      </footer>`;
    const { links } = discoverLegalLinks();
    const privacy = links.find(l => l.type === 'privacy');
    expect(privacy?.confidence).toBe('high');
  });

  // Test 15: Returns additionalCount when more than 3 docs found
  it('reports additionalCount for documents beyond the 3-doc limit', () => {
    document.body.innerHTML = `
      <footer>
        <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
        <a href="https://app.example.com/terms-of-service">Terms of Service</a>
        <a href="https://app.example.com/cookie-policy">Cookie Policy</a>
        <a href="https://app.example.com/user-agreement">User Agreement</a>
      </footer>`;
    const { additionalCount } = discoverLegalLinks();
    expect(additionalCount).toBeGreaterThan(0);
  });
});
