import { getRelevanceFilteredText, chunkText } from "../src/lib/analyzer";

// Simulate realistic privacy policy text (clean extracted text, not raw HTML)
const REALISTIC_PRIVACY = `
Privacy Policy — LinkedIn

Effective November 3, 2025

Your Privacy Matters

LinkedIn's mission is to connect the world's professionals. Central to this mission is our commitment to be transparent about the data we collect about you, how it is used and with whom it is shared.

1. Data We Collect

1.1 Data You Provide
We collect personal data you provide when you:
- Create or update your account (name, email, phone, password)
- Fill in your profile (employment, education, skills, photo)
- Post, send or receive messages
- Sign up for our premium services

1.2 Data From Other Sources
We receive data about you from third parties such as:
- Partners who help us deliver advertising
- Public databases and data brokers
- Social media platforms (when you sign in with another service)

1.3 Service Use Data
We collect data when you use our services:
- Device identifiers (IP address, browser type, OS)
- Cookies and similar tracking technologies
- Location data (if you permit)
- Search history and content interactions

2. How We Use Your Data

We use your personal data to:
- Provide, improve and develop our Services
- Personalize your experience, including advertising
- Connect you with job opportunities and recruiters
- Train machine learning and AI models to improve recommendations
- Prevent fraud and ensure security
- Comply with legal obligations

3. How We Share Information

3.1 Our Services
Your profile is visible to other LinkedIn members. You control who can see what.

3.2 Third Parties
We share personal data with:
- Advertisers and ad networks for targeted advertising
- Service providers acting on our behalf (cloud, analytics, support)
- Partners for co-branded products

3.3 Legal Disclosures
We may disclose your data to law enforcement, regulators, or courts when required by law.

3.4 International Transfers
We transfer data internationally, including to the United States, with appropriate safeguards.

4. Data Retention

We retain your personal data while your account is active. After deletion we may retain data for up to 30 days in backups, and longer if required by law.

5. Your Choices and Rights

5.1 Access and Correction
You can access and correct your personal data in your account settings.

5.2 Deletion
You can close your account and request deletion of your personal data.

5.3 Opt-Out of Advertising
You can opt out of interest-based advertising in your privacy settings.

5.4 AI Training Opt-Out
You can opt out of the use of your data for generative AI training in settings.

5.5 GDPR / CCPA Rights
If you are in the EU/EEA or California, you have additional rights including the right to object to processing, data portability, and the right to lodge a complaint.

6. Security

We implement technical and organizational safeguards to protect your personal data including encryption at rest and in transit. We notify affected users in case of a data breach.

7. Children

Our services are not directed to individuals under 16. We do not knowingly collect personal data from children.
`.trim();

const REALISTIC_TERMS = `
User Agreement — LinkedIn

1. Introduction
By using LinkedIn, you agree to these terms.

2. Account and Membership
You must be at least 16 years old to use our Services. You are responsible for your account and password.

3. Your Content
You own what you share on LinkedIn. By posting, you grant LinkedIn a license to use, distribute and display your content.

4. Payment Terms
Premium subscriptions are billed monthly or annually. You authorize us to charge your payment method. All fees are non-refundable unless required by law. We may change subscription prices with 30 days notice.

5. Restrictions
You agree not to:
- Scrape or copy data without permission
- Use the service to spam, harass, or deceive
- Reverse engineer our software

6. Termination
LinkedIn may terminate or restrict your account if you violate these terms. You may close your account at any time.

7. Liability
LinkedIn is not liable for indirect, incidental, or consequential damages. Our total liability is limited to the fees you paid in the last 12 months.

8. Dispute Resolution
Disputes are governed by California law. You agree to binding arbitration for individual claims.
`.trim();

const REALISTIC_COOKIE = `
Cookie Policy — LinkedIn

We use cookies and similar technologies to provide, protect, and improve LinkedIn's services.

What are cookies?
Cookies are small text files stored on your device when you visit a website.

Types of cookies we use:

Essential cookies: Required for basic site functionality — login, security, preferences.

Analytics cookies: We use cookies to understand how you use LinkedIn, measure page performance, and improve features. This includes Google Analytics.

Advertising cookies: We and our advertising partners use cookies to show you relevant ads on LinkedIn and third-party sites based on your interests and browsing behavior.

Third-party cookies: Our partners may place cookies on your device. We do not control these cookies. See our partners list for details.

Cookie duration:
- Session cookies expire when you close your browser
- Persistent cookies remain for up to 2 years

Opt-out:
You can manage cookie preferences in your account settings or via your browser settings. Opting out of advertising cookies does not remove ads but makes them less relevant.
`.trim();

function measure(label: string, text: string, docType: string) {
  const filtered = getRelevanceFilteredText(text, docType);
  const chunks = chunkText(filtered);
  const origChunks = chunkText(text);
  const estTokens = Math.ceil(filtered.length / 4);
  const origTokens = Math.ceil(text.length / 4);
  const reduction = ((text.length - filtered.length) / text.length * 100).toFixed(1);
  
  console.log(`\n${label}`);
  console.log(`  Original: ${text.length} chars (${origTokens} est tokens, ${origChunks.length} chunks)`);
  console.log(`  Filtered: ${filtered.length} chars (${estTokens} est tokens, ${chunks.length} chunks)`);
  console.log(`  Reduction: ${reduction}%`);
  console.log(`  Total chunks for this doc: ${chunks.length}`);
  
  return { filteredLength: filtered.length, chunkCount: chunks.length, estTokens };
}

const pp = measure("Privacy Policy", REALISTIC_PRIVACY, "privacy");
const ua = measure("User Agreement", REALISTIC_TERMS, "terms");
const cp = measure("Cookie Policy", REALISTIC_COOKIE, "cookie");

const total = pp.chunkCount + ua.chunkCount + cp.chunkCount;
const totalTokens = pp.estTokens + ua.estTokens + cp.estTokens;
console.log(`\nTOTAL: ${total} Groq requests, ~${totalTokens} input tokens`);
console.log(`TPM budget used (est): ${totalTokens} / 8000 (${(totalTokens/8000*100).toFixed(0)}%)`);
