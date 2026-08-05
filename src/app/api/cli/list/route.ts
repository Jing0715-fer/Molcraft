import { NextResponse } from "next/server";
import { probeAllClis, ANALYSIS_RECIPES } from "@/lib/cli-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/cli/list — probes all known bioinformatics CLIs and returns availability + recipes. */
export async function GET() {
  try {
    const clis = await probeAllClis(true); // force re-probe on each call (cheap, cached 1min)
    const availableClis = clis.filter((c) => c.available);

    // Filter recipes to those whose requirements are met.
    const availableIds = new Set(availableClis.map((c) => c.id));
    const recipes = ANALYSIS_RECIPES.filter((r) =>
      r.requires.some((req) => availableIds.has(req))
    ).map((r) => ({
      id: r.id,
      label: r.label,
      description: r.description,
      requires: r.requires,
      params: r.params,
      available: r.requires.every((req) => availableIds.has(req)),
    }));

    return NextResponse.json({
      clis,
      recipes,
      summary: {
        total: clis.length,
        available: availableClis.length,
        availableIds: Array.from(availableIds),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "CLI probe failed", detail: msg },
      { status: 500 }
    );
  }
}
