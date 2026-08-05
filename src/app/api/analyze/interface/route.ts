import { NextRequest, NextResponse } from "next/server";
import {
  fetchAssembly,
  fetchInterface,
  fetchEntry,
} from "@/lib/rcsb-client";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/analyze/interface?id=9ehs&assembly=1
 *
 * Returns the assembly-level interface info: total BSA, total interface
 * residues, and per-interface breakdowns (interface area, residue counts,
 * and the top contributing residues by BSA).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id")?.trim();
  const assemblyId = sp.get("assembly") ?? "1";

  if (!id) {
    return NextResponse.json(
      { error: "`id` query parameter is required" },
      { status: 400 }
    );
  }
  if (!/^[a-zA-Z0-9]{4}$/.test(id)) {
    return NextResponse.json(
      { error: "`id` must be a 4-character PDB ID" },
      { status: 400 }
    );
  }

  try {
    const entry = await fetchEntry(id);
    const assemblies = await Promise.all(
      entry.assemblyIds.map((aid) => fetchAssembly(id, aid))
    );

    // For the requested assembly, fetch per-interface details.
    const targetAssembly = assemblies.find((a) => a.assemblyId === assemblyId);
    if (!targetAssembly) {
      return NextResponse.json(
        { error: `Assembly ${assemblyId} not found for ${id}` },
        { status: 404 }
      );
    }

    const interfaces = await Promise.all(
      targetAssembly.interfaceIds.map((iid) =>
        fetchInterface(id, assemblyId, iid)
      )
    );

    return NextResponse.json({
      pdbId: id.toUpperCase(),
      assemblyId,
      totalBuriedSurfaceArea: targetAssembly.totalBuriedSurfaceArea,
      totalInterfaceResidues: targetAssembly.totalInterfaceResidues,
      numInterfaces: targetAssembly.numInterfaces,
      interfaces: interfaces.map((it) => ({
        interfaceId: it.interfaceId,
        interfaceArea: it.interfaceArea,
        numInterfaceResidues: it.numInterfaceResidues,
        numCoreInterfaceResidues: it.numCoreInterfaceResidues,
        polymerComposition: it.polymerComposition,
        interfaceCharacter: it.interfaceCharacter,
        partner1: it.partner1
          ? {
              chainId: it.partner1.chainId,
              authChainId: it.partner1.authChainId,
              entityId: it.partner1.entityId,
              topResidues: it.partner1.residueSeqIds
                .map((seq, i) => ({
                  seq,
                  name: it.partner1!.residueNames[i] ?? "?",
                  bsa: it.partner1!.bsaValues[i] ?? 0,
                }))
                .sort((a, b) => b.bsa - a.bsa)
                .slice(0, 15),
            }
          : null,
        partner2: it.partner2
          ? {
              chainId: it.partner2.chainId,
              authChainId: it.partner2.authChainId,
              entityId: it.partner2.entityId,
              topResidues: it.partner2.residueSeqIds
                .map((seq, i) => ({
                  seq,
                  name: it.partner2!.residueNames[i] ?? "?",
                  bsa: it.partner2!.bsaValues[i] ?? 0,
                }))
                .sort((a, b) => b.bsa - a.bsa)
                .slice(0, 15),
            }
          : null,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to fetch interface data", detail: msg },
      { status: 502 }
    );
  }
}
