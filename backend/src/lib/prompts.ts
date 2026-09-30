export const CHUNK_ANALYSIS_PROMPT = `Extract max 5 privacy findings.
Categories: data_collection, data_sharing, tracking, permissions, retention, deletion, ai_training, subscription, user_rights, security, legal, other
Severities: EXPECTED (standard), LOW (minor), MEDIUM (profiling), HIGH (selling/ads/sensitive)
Rules:
- Meaningful concerns only. Skip boilerplate.
- Evidence: short quote (max 20 words).
- Title: max 5 words. Explanation: 1 sentence.`;
