import { NextResponse } from "next/server";
import { analyzeMultipleDocuments, DiscoveredDocument } from "@/lib/multi-analyzer";

const MAX_DOCUMENTS = 3;
const MAX_TEXT_LENGTH = 200_000;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { documents } = body;

    if (!Array.isArray(documents) || documents.length === 0) {
      return NextResponse.json({ error: "Missing or empty 'documents' array" }, { status: 400 });
    }

    if (documents.length > MAX_DOCUMENTS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_DOCUMENTS} documents allowed per request` },
        { status: 400 }
      );
    }

    // Validate each document
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      if (!doc || typeof doc !== "object") {
        return NextResponse.json({ error: `Document ${i} is invalid` }, { status: 400 });
      }
      if (typeof doc.extractedText !== "string" || doc.extractedText.length < 10) {
        return NextResponse.json({ error: `Document ${i} has insufficient text` }, { status: 400 });
      }
      if (doc.extractedText.length > MAX_TEXT_LENGTH) {
        return NextResponse.json({ error: `Document ${i} exceeds maximum text length` }, { status: 400 });
      }
      if (!["privacy", "terms", "cookie", "other"].includes(doc.type)) {
        return NextResponse.json({ error: `Document ${i} has invalid type` }, { status: 400 });
      }
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let streamClosed = false;

        const emit = (event: any) => {
          if (streamClosed || request.signal.aborted) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
          } catch (e) {
            console.error("Stream enqueue error", e);
            streamClosed = true;
          }
        };

        try {
          const signal = request.signal;
          const analysis = await analyzeMultipleDocuments(documents as DiscoveredDocument[], emit, signal);
          if (!streamClosed && !signal.aborted) {
            emit({ type: "complete", analysis });
          }
        } catch (error: any) {
          console.error("[PrivacyLens] Streaming error:", error);
          if (!streamClosed && !request.signal.aborted) {
            emit({ type: "error", error: error.message || "Unknown error" });
          }
        } finally {
          if (!streamClosed) {
            streamClosed = true;
            try {
              controller.close();
            } catch (e) {}
          }
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      }
    });
  } catch (error: any) {
    console.error("[PrivacyLens] /api/analyze-multi error:", error);
    return NextResponse.json(
      { error: error?.message ?? "An unexpected error occurred during analysis." },
      { status: 500 }
    );
  }
}
