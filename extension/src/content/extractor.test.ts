import { describe, it, expect, beforeEach } from 'vitest';
import { chunkText } from './chunker';
import { detectPolicy } from './detector';
import { extractPolicyContent } from './extractor';

describe('PrivacyLens Content Utilities', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.title = '';
    Object.defineProperty(window, 'location', {
      value: { href: 'http://localhost' },
      writable: true
    });
  });

  describe('Detector', () => {
    it('should detect a privacy policy based on title and text', () => {
      document.title = 'Privacy Policy';
      document.body.innerHTML = '<h1>Privacy Policy</h1><p>We collect your data.</p>';
      window.location.href = 'https://example.com/privacy';

      const result = detectPolicy();
      expect(result.isPolicy).toBe(true);
      expect(result.type).toBe('privacy-policy');
      expect(result.confidence).toBe(50);
    });

    it('should not detect a normal page as policy', () => {
      document.title = 'About Our Company';
      document.body.innerHTML = '<h1>About Us</h1><p>We are a cool company.</p>';
      window.location.href = 'https://example.com/about';

      const result = detectPolicy();
      expect(result.isPolicy).toBe(false);
      expect(result.type).toBe('unknown');
      expect(result.confidence).toBeLessThan(31);
    });
  });

  describe('Extractor', () => {
    it('should extract main policy content and ignore nav/footer', () => {
      document.body.innerHTML = `
        <nav>Menu Items</nav>
        <header>Header Content</header>
        <div class="sidebar">Ads and stuff</div>
        <article>
          <h1>Terms of Service</h1>
          <p>By using this service, you agree to our terms.</p>
        </article>
        <footer>Copyright 2026</footer>
      `;

      // Need to pad article text to be >500 chars to pass the threshold heuristic
      const longText = Array(60).fill('This is a sentence to pad out the length of the text.').join(' ');
      document.querySelector('article')!.innerHTML += `<p>${longText}</p>`;

      const detection = { isPolicy: true, type: 'terms-of-service' as const, confidence: 90, signals: [] };
      const result = extractPolicyContent(detection);

      expect(result.extractedText).toContain('Terms of Service');
      expect(result.extractedText).toContain('By using this service, you agree to our terms.');
      expect(result.extractedText).not.toContain('Menu Items');
      expect(result.extractedText).not.toContain('Header Content');
      expect(result.extractedText).not.toContain('Copyright 2026');
    });
  });

  describe('Chunker', () => {
    it('should chunk text without exceeding max limit', () => {
      const p1 = Array(10).fill('Sentence one.').join(' ');
      const p2 = Array(10).fill('Sentence two.').join(' ');
      const text = `${p1}\n\n${p2}`;
      
      const chunks = chunkText(text, 150); // Small limit
      
      expect(chunks.length).toBeGreaterThan(1);
      chunks.forEach(chunk => {
        expect(chunk.length).toBeLessThanOrEqual(150);
      });
      // Should preserve sentences roughly
      expect(chunks.join(' ')).toContain('Sentence');
    });
  });
});
