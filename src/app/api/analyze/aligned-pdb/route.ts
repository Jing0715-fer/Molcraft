import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile } from "node:fs/promises";

export const runtime = "nodejs";

const CACHE_DIR = join(tmpdir(), "molcraft-analysis", "pdb");

/**
 * GET /api/analyze/aligned-pdb?filename=1cbr_aligned_to_1cbs.pdb
 *
 * Serves a transformed (aligned) PDB file produced by the
 * `align_save_transformed` recipe. The recipe writes to
 * /tmp/molcraft-analysis/pdb/{mobile}_aligned_to_{ref}.pdb and returns the
 * filename; the frontend then loads it into Molstar via loadStructureFromUrl.
 *
 * Security: we only serve files whose basename matches the safe pattern
 * `[a-z0-9]_aligned_to_[a-z0-9].pdb` and that live inside CACHE_DIR.
 */
export async function GET(req: NextRequest) {
  const filename = req.nextUrl.searchParams.get("filename")?.trim();
  if (!filename) {
    return NextResponse.json(
      { error: "`filename` query parameter is required" },
      { status: 400 }
    );
  }

  // Strict validation: only allow safe filenames like "1cbr_aligned_to_1cbs.pdb"
  // or "uploaded_aligned_to_1cbs.pdb". No path separators, no dots except the .pdb suffix.
  if (!/^[a-zA-Z0-9_]+_aligned_to_[a-zA-Z0-9_]+\.pdb$/.test(filename)) {
    return NextResponse.json(
      { error: "Invalid filename format" },
      { status: 400 }
    );
  }

  const fullPath = join(CACHE_DIR, filename);

  // Resolve and verify the path is still inside CACHE_DIR (defend against ../).
  if (!fullPath.startsWith(CACHE_DIR)) {
    return NextResponse.json(
      { error: "Path traversal rejected" },
      { status: 400 }
    );
  }

  if (!existsSync(fullPath)) {
    return NextResponse.json(
      { error: `Aligned PDB file not found: ${filename}` },
      { status: 404 }
    );
  }

  try {
    const data = await readFile(fullPath, "utf8");
    return new NextResponse(data, {
      headers: {
        "Content-Type": "chemical/x-pdb; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to read aligned PDB file", detail: msg },
      { status: 500 }
    );
  }
}
