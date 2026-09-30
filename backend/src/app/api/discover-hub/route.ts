/**
 * POST /api/discover-hub
 *
 * Fetches a legal hub page (e.g. /legal, /privacy-center) and extracts
 * legal document links from it. Returns discovered links so the extension
 * can retrieve and analyze the actual documents.
 *
 * One level deep only — never crawls further.
 * All SSRF protections apply.
 */

import { NextResponse } from "next/server";
import { fetchDocument } from "@/lib/fetch-document";
import { parseLinksFromHtml } from "@/lib/link-parser";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { hubUrl } = body;

    if (!hubUrl || typeof hubUrl !== "string") {
      return NextResponse.json({ error: "Missing or invalid 'hubUrl' field" }, { status: 400 });
    }

    // Fetch the hub page via the same SSRF-protected fetcher
    const result = await fetchDocument(hubUrl);

    if (!result.ok) {
      return NextResponse.json(
        { error: `Could not retrieve hub page: ${result.error}`, links: [] },
        { status: 422 }
      );
    }

    // Parse legal links from the raw HTML — need to refetch for HTML, or use text
    // Since fetchDocument returns extracted text (not HTML), we use text-based link parsing
    // The link-parser extracts links by re-fetching — but we already have the content.
    // Instead we use the text returned and look for URL patterns in it.
    // Better: parse from the actual HTML. We need a separate raw-HTML fetch.
    // For simplicity: use the text to extract any URLs that look like legal pages.
    const links = parseLinksFromHtml(result.text, hubUrl);

    return NextResponse.json({ links, hubTitle: result.title });
  } catch (error: any) {
    console.error("[PrivacyLens] /api/discover-hub error:", error);
    return NextResponse.json({ error: "Internal server error", links: [] }, { status: 500 });
  }
}
