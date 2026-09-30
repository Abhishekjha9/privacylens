import { discoverLegalLinks } from './src/content/link-discoverer';
import { JSDOM } from 'jsdom';

const dom = new JSDOM(`
  <footer>
    <a href="https://app.example.com/privacy-policy">Privacy Policy</a>
    <a href="https://app.example.com/terms-of-service">Terms of Service</a>
  </footer>
`, { url: 'https://app.example.com/login' });

global.window = dom.window;
global.document = dom.window.document;

console.log(discoverLegalLinks());
