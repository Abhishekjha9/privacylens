import { NextResponse } from "next/server";
import { validatePolicyRequest } from "@/lib/validation";
import { analyzePolicyText } from "@/lib/analyzer";
import { PolicyDocument } from "@/types/analysis";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // 1. Validate request
    const validation = validatePolicyRequest(body);
    if (!validation.success) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const policy = validation.data!.policy as PolicyDocument;

    // 2. Analyze policy
    const analysis = await analyzePolicyText(policy);

    // 3. Return results
    return NextResponse.json(analysis);

  } catch (error: any) {
    console.error("API /analyze error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred during analysis." }, 
      { status: 500 }
    );
  }
}
