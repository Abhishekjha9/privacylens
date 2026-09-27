import { describe, it, expect } from "vitest";
import { validatePolicyRequest } from "./validation";

describe("Validation", () => {
  it("should accept a valid PolicyDocument payload", () => {
    const payload = {
      policy: {
        title: "Privacy Policy",
        url: "https://example.com/privacy",
        domain: "example.com",
        type: "privacy-policy",
        confidence: 90,
        wordCount: 1000,
        characterCount: 6000,
        estimatedReadingMinutes: 5,
        extractedText: "This is a valid privacy policy with enough text to pass validation."
      }
    };
    const result = validatePolicyRequest(payload);
    expect(result.success).toBe(true);
  });

  it("should reject a payload missing extractedText", () => {
    const payload = {
      policy: {
        title: "Privacy Policy",
        type: "privacy-policy",
        confidence: 90,
        wordCount: 1000,
        characterCount: 6000,
        estimatedReadingMinutes: 5
      }
    };
    const result = validatePolicyRequest(payload);
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("should reject excessively large payloads", () => {
    const payload = {
      policy: {
        type: "privacy-policy",
        confidence: 90,
        wordCount: 100000,
        characterCount: 600000,
        estimatedReadingMinutes: 50,
        extractedText: "A".repeat(200001) // Exceeds max length
      }
    };
    const result = validatePolicyRequest(payload);
    expect(result.success).toBe(false);
    expect(result.error).toContain("exceeds maximum allowed length");
  });
});
