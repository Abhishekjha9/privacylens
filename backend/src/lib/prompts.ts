export const CHUNK_ANALYSIS_PROMPT = `Analyze policy text. Output ONLY JSON. Return 5 parallel arrays (max length 5): categories, severities, titles, explanations, evidence.

Categories: data_collection, data_sharing, tracking, permissions, retention, deletion, ai_training, subscription, user_rights, security, legal, other
Severities: EXPECTED (core service data), LOW (minor exposure), MEDIUM (secondary use/analytics), HIGH (ad tracking, selling data, sensitive data)

Rules:
- Don't invent facts. Evidence must exactly match text.
- Short title, explanation, and evidence.`;

export const FALLBACK_ANALYSIS_PROMPT = CHUNK_ANALYSIS_PROMPT;
