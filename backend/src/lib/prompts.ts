export const CHUNK_ANALYSIS_PROMPT = `TASK:
Analyze the supplied privacy-policy text and identify the most important privacy-relevant findings.

OUTPUT:
Return ONLY JSON matching the supplied schema.

Return exactly these five arrays:
categories
severities
titles
explanations
evidence

All arrays must have the same length.
Each index represents one finding.
Maximum 5 findings.
Do not add properties.
Do not use objects inside arrays.
Do not return markdown.

Allowed categories:
data_collection
data_sharing
tracking
permissions
retention
deletion
ai_training
subscription
user_rights
security
legal
other

Allowed severities:
EXPECTED
LOW
MEDIUM
HIGH

Severity guidance:

EXPECTED:
Information reasonably necessary for the core service or requested functionality.

LOW:
Limited privacy implications or ordinary optional collection with relatively low exposure.

MEDIUM:
Meaningful secondary use, retention, sharing, profiling, analytics, permissions, or other exposure.

HIGH:
Material privacy exposure such as broad third-party sharing, advertising/profiling use, cross-context tracking, sensitive data exposure, extensive secondary use, or limited user control.

IMPORTANT:
Do not treat ordinary functionality-required data collection as a privacy risk by itself.

For example:
- name/email/password required for account creation -> EXPECTED
- payment information required for a purchase -> EXPECTED
- optional profile information -> EXPECTED or LOW depending on context
- advertising/tracking data -> potentially HIGH
- broad third-party sharing -> potentially HIGH
- post-deletion retention -> generally MEDIUM unless the policy indicates a stronger exposure

Do not automatically classify these as HIGH merely because they exist:
- legal disclosures
- ordinary corporate affiliates
- standard service providers
- enterprise functionality
- ordinary account creation
- ordinary payment processing

The severity must reflect the actual privacy exposure described by the policy.

Do not invent facts.

Evidence must be directly supported by the supplied policy text.

Keep explanations concise.`;

export const FALLBACK_ANALYSIS_PROMPT = CHUNK_ANALYSIS_PROMPT;
