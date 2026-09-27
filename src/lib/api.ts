import type { PolicyDocument } from '../types/policy';
import type { PolicyAnalysis } from '../types/analysis';

// Use a configurable URL or fallback to localhost for development
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export async function analyzePolicy(policy: PolicyDocument): Promise<PolicyAnalysis> {
  const response = await fetch(`${API_URL}/api/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ policy }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Analysis failed with status: ${response.status}`);
  }

  const data = await response.json();
  return data as PolicyAnalysis;
}
