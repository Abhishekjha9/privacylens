export const CHUNK_ANALYSIS_PROMPT = `TASK

Analyze the supplied privacy-policy text.

OUTPUT FORMAT

Return ONLY JSON matching the supplied schema.

The response contains FIVE PARALLEL ARRAYS:

categories
severities
titles
explanations
evidence

All arrays MUST contain the same number of elements.

Each index represents ONE finding.

For example:

{
  "categories": ["data_collection", "tracking"],
  "severities": ["MEDIUM", "LOW"],
  "titles": [
    "Collects Account Information",
    "Uses Tracking Technologies"
  ],
  "explanations": [
    "LinkedIn collects personal information when creating an account.",
    "LinkedIn uses cookies and similar technologies to track activity."
  ],
  "evidence": [
    "To create an account you need to provide data including your name...",
    "We use cookies and similar technologies..."
  ]
}

IMPORTANT:

- Maximum 8 findings.
- Every array must have exactly the same number of elements.
- Do not omit an explanation.
- Do not combine multiple findings into one array element.
- Each array element represents exactly ONE finding.
- Do not return objects inside arrays.
- Do not return markdown.
- Do not return additional properties.

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
LOW
MEDIUM
HIGH

Title <= 80 characters.
Explanation <= 240 characters.
Evidence <= 160 characters.

Evidence must be a short exact quote from the supplied policy.

If there are no meaningful findings, return:

{
  "categories": [],
  "severities": [],
  "titles": [],
  "explanations": [],
  "evidence": []
}

POLICY TEXT`;
