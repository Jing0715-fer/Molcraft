import { NextRequest, NextResponse } from "next/server";
import { fetchFullMetadata } from "@/lib/rcsb-client";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/analyze/metadata?id=9ehs&interfaces=1
 *
 * Returns the full RCSB metadata for a PDB entry: entry info, all polymer
 * entities (chains + sequences + organisms), nonpolymer entities (ligands),
 * assemblies, and optionally per-interface buried-surface-area + residues.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id")?.trim();
  const withInterfaces = sp.get("interfaces") === "1";
  const format = sp.get("format") ?? "json";

  if (!id) {
    return NextResponse.json(
      { error: "`id` query parameter is required" },
      { status: 400 }
    );
  }
  // Validate PDB ID format (4 chars alphanumeric)
  if (!/^[a-zA-Z0-9]{4}$/.test(id)) {
    return NextResponse.json(
      { error: "`id` must be a 4-character PDB ID" },
      { status: 400 }
    );
  }

  try {
    const data = await fetchFullMetadata(id, withInterfaces);
    if (format === "markdown") {
      // Lazy import to avoid circular at module load
      const { metadataToMarkdown } = await import("@/lib/rcsb-client");
      const md = metadataToMarkdown(data);
      return new NextResponse(md, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }
    return NextResponse.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to fetch RCSB metadata", detail: msg },
      { status: 502 }
    );
  }
}
