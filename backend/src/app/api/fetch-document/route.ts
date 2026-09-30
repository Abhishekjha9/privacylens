import { NextResponse } from "next/server";
import { fetchDocument } from "@/lib/fetch-document";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { url } = body;

    if (!url || typeof url !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'url' field" }, { status: 400 });
    }

    const result = await fetchDocument(url);

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, category: result.category, retryable: result.retryable },
        { status: result.category === "ssrf_blocked" ? 403 : result.category === "http_error_4xx" ? 404 : 422 }
      );
    }

    return NextResponse.json({
      text: result.text,
      title: result.title,
      finalUrl: result.finalUrl,
      contentFingerprint: result.contentFingerprint,
    });
  } catch (error: any) {
    console.error("[PrivacyLens] /api/fetch-document error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
