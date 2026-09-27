# PrivacyLens (Phase 1)

PrivacyLens is an AI-powered browser extension that helps users understand Privacy Policies and Terms & Conditions. This repository contains the Phase 1 implementation which focuses on detecting and extracting the policy content locally within the browser.

## Features
- Automatically detects Privacy Policy and Terms of Service pages
- Extracts the main text while ignoring ads, footers, navigation, etc.
- Calculates word count and estimated reading time
- Provides a simple UI to copy the extracted text
- Fully local execution (no backend for Phase 1)

## Setup & Installation

### Requirements
- Node.js (v18+ recommended)
- npm

### Development
1. Install dependencies:
   ```bash
   npm install
   ```
2. Run development server (for UI development):
   ```bash
   npm run dev
   ```
3. Run tests:
   ```bash
   npx vitest run
   ```

### Building & Loading into Chrome

1. Build the production extension:
   ```bash
   npm run build
   ```
2. Open Google Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** using the toggle in the top right corner.
4. Click **Load unpacked**.
5. Select the `dist` folder located inside `privacylens/extension/dist`.
6. Pin the extension to your toolbar.

## How to Test
1. Visit a Privacy Policy page (e.g., https://example.com/privacy).
2. Click the PrivacyLens icon in your toolbar.
3. The popup will indicate that a policy was detected.
4. Click **Extract Policy**.
5. You should see the extraction results (word count, reading time) and a preview of the text.
6. Test on a non-policy page to see the "No policy detected" state.

## Known Limitations
- Phase 1 does not analyze the text with AI.
- Detection relies on common URL patterns, headers, and text signals. Unconventional policy pages might not be automatically detected.
- Highly dynamic single-page applications might require a page reload if the policy content doesn't trigger the detection threshold immediately.

## Recommended Next Steps for Phase 2
- **Backend Setup**: Create a Next.js server to handle API requests safely.
- **AI Integration**: Hook up the Groq API to analyze the extracted `PolicyDocument` for key risks.
- **Chunking Integration**: The `chunker.ts` utility is ready to be used if the policy text exceeds LLM context windows.
- **UI Enhancements**: Replace the extraction preview with a detailed analysis report showing structured risk information and scores.
