import { discoverLegalLinks } from './src/content/link-discoverer';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`
  <footer>
    <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
  </footer>
`, { url: 'https://app.example.com/login' });

global.window = dom.window;
global.document = dom.window.document;

// Mock URL resolution explicitly since JSDOM might be doing it weirdly
const origResolve = document.createElement('a');

const allAnchors = Array.from(document.querySelectorAll('a[href]'));
console.log('Anchors found:', allAnchors.length);
for (const a of allAnchors) {
  console.log('Href:', a.getAttribute('href'), 'Text:', a.textContent);
}

