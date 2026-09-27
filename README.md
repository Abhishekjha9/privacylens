# PrivacyLens (Phase 1 & 2)

PrivacyLens is an AI-powered browser extension that helps users understand Privacy Policies and Terms & Conditions. It detects policies, extracts content, and analyzes it using an AI backend to highlight risks, data collection, and tracking practices.

## Features
- Automatically detects Privacy Policy and Terms of Service pages
- Extracts the main text while ignoring ads, footers, navigation, etc.
- Sends extracted text to a local Next.js backend for chunking and AI processing
- Analyzes policy chunks using Groq API (e.g. LLaMA 3)
- Renders a clean Risk Report highlighting high-risk and medium-risk clauses directly in the extension.

## Setup & Installation

### Requirements
- Node.js (v18+ recommended)
- npm
- Groq API Key

### Backend Setup (Next.js + AI)
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables:
   Copy `.env.example` to `.env` and add your Groq API key:
   ```bash
   cp .env.example .env
   ```
   Add your keys in `.env`:
   ```
   GROQ_API_KEY=your_real_key_here
   GROQ_MODEL=llama-3.1-8b-instant
   ```
4. Run the development server:
   ```bash
   npm run dev
   ```
   The backend will run on `http://localhost:3000`.

### Extension Setup (Chrome UI)
1. Open a new terminal tab and stay in the root repository.
2. Install dependencies (if you haven't already):
   ```bash
   npm install
   ```
3. Build the production extension:
   ```bash
   npm run build
   ```
   *Note: For local development UI testing, you can use `npm run dev`, but to test the full Chrome Extension lifecycle, you must build it.*
4. Open Google Chrome and navigate to `chrome://extensions`.
5. Enable **Developer mode** using the toggle in the top right corner.
6. Click **Load unpacked**.
7. Select the `dist` folder located inside `privacylens/dist`.
8. Pin the extension to your toolbar.

## How to Test
1. Make sure your `backend` server is running on port 3000.
2. Ensure you have loaded the `dist` folder in Chrome.
3. Visit a Privacy Policy page (e.g., https://example.com/privacy).
4. Click the PrivacyLens icon in your toolbar.
5. Click **Extract Policy** (this will extract and immediately begin AI analysis).
6. Wait a moment while the backend chunks the text, analyzes it with Groq, and merges the findings.
7. Review the **Privacy Risk Indicators**, categories, and important clauses.
8. Click **Show original wording** to verify the AI's evidence against the actual policy.

## Known Limitations
- The extension currently hardcodes the API URL to `http://localhost:3000` for the hackathon MVP. In production, this needs to point to a deployed backend.
- Highly dynamic single-page applications might require a page reload if the policy content doesn't trigger the detection threshold immediately.
- Groq API has rate limits which might be exceeded on extremely large policies (e.g., >50,000 words) without backoff logic.

## Recommended Next Steps for Phase 3
- **In-page Highlighting**: Use the `evidence` strings to highlight the exact clauses on the live webpage.
- **Production Deployment**: Deploy the Next.js app to Vercel and configure CORS strictly for the published extension ID.
- **Vector DB / RAG**: Instead of purely chunk-based parsing, implement a lightweight RAG system for deeper, cross-contextual questions about the policy.
