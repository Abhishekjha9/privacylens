import { z } from "zod";

export const policyRequestSchema = z.object({
  policy: z.object({
    title: z.string().optional(),
    url: z.string().url().optional().or(z.string()),
    domain: z.string().optional(),
    type: z.string(),
    confidence: z.number().min(0).max(100),
    wordCount: z.number().min(0),
    characterCount: z.number().min(0),
    estimatedReadingMinutes: z.number().min(0),
    extractedText: z.string().min(10, "Extracted text is too short")
  })
});

// We want to limit payload size to avoid abuse or OOM
// E.g., limit text to 200,000 characters
const MAX_TEXT_LENGTH = 200000;

export function validatePolicyRequest(data: unknown) {
  const result = policyRequestSchema.safeParse(data);
  if (!result.success) {
    return { success: false, error: result.error.toString() };
  }
  
  if (result.data.policy.extractedText.length > MAX_TEXT_LENGTH) {
    return { success: false, error: "Policy text exceeds maximum allowed length" };
  }

  return { success: true, data: result.data };
}
