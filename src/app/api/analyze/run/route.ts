import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { getRecipe, probeAllClis } from "@/lib/cli-registry";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const maxDuration = 60;

const TMP_DIR = join(tmpdir(), "molcraft-analysis");
const PDB_CACHE_DIR = join(TMP_DIR, "pdb");

interface RunBody {
  /** PDB ID to fetch + analyze (e.g. "9ehs"). Required unless `fileContent` is given. */
  pdbId?: string;
  /** Raw structure file content (PDB or mmCIF). */
  fileContent?: string;
  /** Format of fileContent: "pdb" or "cif". Defaults to "pdb". */
  fileFormat?: "pdb" | "cif";
  /** Second structure file content (for cross-structure recipes like per_residue_rmsd_two). */
  fileContent2?: string;
  /** Format of fileContent2. */
  fileFormat2?: "pdb" | "cif";
  /** Recipe id from ANALYSIS_RECIPES. */
  recipe: string;
  /** Recipe parameters. */
  params?: Record<string, unknown>;
}

async function ensureDirs() {
  await mkdir(PDB_CACHE_DIR, { recursive: true });
}

/**
 * Download a structure file from RCSB. Tries PDB format first, falls back to
 * mmCIF (most EM / large structures are mmCIF-only). Returns the local path
 * and the actual format downloaded.
 */
async function getStructureFilePath(
  pdbId: string
): Promise<{ path: string; format: "pdb" | "cif" }> {
  const id = pdbId.toLowerCase();
  const upper = id.toUpperCase();
  const pdbPath = join(PDB_CACHE_DIR, `${id}.pdb`);
  const cifPath = join(PDB_CACHE_DIR, `${id}.cif`);

  if (existsSync(pdbPath)) return { path: pdbPath, format: "pdb" };
  if (existsSync(cifPath)) return { path: cifPath, format: "cif" };

  // Try PDB format first (small molecules, X-ray)
  const pdbRes = await fetch(
    `https://files.rcsb.org/download/${upper}.pdb`
  );
  if (pdbRes.ok) {
    const text = await pdbRes.text();
    if (text && !text.includes("404 Not Found") && text.length > 100) {
      await writeFile(pdbPath, text, "utf8");
      return { path: pdbPath, format: "pdb" };
    }
  }

  // Fall back to mmCIF (covers EM and large structures)
  const cifRes = await fetch(
    `https://files.rcsb.org/download/${upper}.cif`
  );
  if (cifRes.ok) {
    const text = await cifRes.text();
    if (text && text.length > 100) {
      await writeFile(cifPath, text, "utf8");
      return { path: cifPath, format: "cif" };
    }
  }

  throw new Error(
    `Failed to download structure ${upper}: neither PDB nor mmCIF available`
  );
}

/**
 * POST /api/analyze/run
 *
 * Runs a named analysis recipe (Python script using biopython / freesasa /
 * pdb-tools) on a structure file. The structure is either downloaded from
 * RCSB by PDB ID or provided directly as `fileContent`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RunBody;
    if (!body.recipe) {
      return NextResponse.json(
        { error: "`recipe` is required" },
        { status: 400 }
      );
    }

    const recipe = getRecipe(body.recipe);
    if (!recipe) {
      return NextResponse.json(
        { error: `Unknown recipe: ${body.recipe}` },
        { status: 400 }
      );
    }

    // Check recipe dependencies are installed.
    const clis = await probeAllClis();
    const available = new Set(
      clis.filter((c) => c.available).map((c) => c.id)
    );
    const missing = recipe.requires.filter((r) => !available.has(r));
    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Recipe requires ${missing.join(", ")} but not available`,
          missing,
          availableClis: Array.from(available),
        },
        { status: 400 }
      );
    }

    await ensureDirs();

    // Resolve the input file path.
    // Recipes that don't need a single input structure file — they download
    // their own structures internally (e.g. cross_pdb_rmsd).
    const NO_INPUT_RECIPES = new Set(["cross_pdb_rmsd", "cross_pdb_rmsd_aligned", "align_and_superpose", "align_save_transformed"]);

    let inputPath: string;
    let inputFormat: "pdb" | "cif" = body.fileFormat ?? "pdb";
    if (NO_INPUT_RECIPES.has(body.recipe)) {
      // Use a placeholder path; the recipe script handles its own downloads.
      inputPath = "/dev/null";
    } else if (body.fileContent) {
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      inputPath = join(PDB_CACHE_DIR, `upload-${uploadId}.${inputFormat}`);
      await writeFile(inputPath, body.fileContent, "utf8");
    } else if (body.pdbId) {
      if (!/^[a-zA-Z0-9]{4}$/.test(body.pdbId)) {
        return NextResponse.json(
          { error: "`pdbId` must be a 4-character PDB ID" },
          { status: 400 }
        );
      }
      const result = await getStructureFilePath(body.pdbId);
      inputPath = result.path;
      inputFormat = result.format;
    } else {
      return NextResponse.json(
        { error: "Either `pdbId` or `fileContent` is required" },
        { status: 400 }
      );
    }

    // If the recipe needs a second structure (e.g. per_residue_rmsd_two),
    // write it to a sibling file.
    let secondPath: string | null = null;
    if (body.fileContent2) {
      const uploadId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const secondFormat = body.fileFormat2 ?? "pdb";
      secondPath = join(PDB_CACHE_DIR, `upload2-${uploadId}.${secondFormat}`);
      await writeFile(secondPath, body.fileContent2, "utf8");
    }

    // Build the script, passing format info so the recipe can pick the right parser.
    const script = recipe.buildScript(inputPath, {
      ...(body.params ?? {}),
      __format__: inputFormat,
      __secondPath__: secondPath ?? "",
    });
    // Use a unique suffix (timestamp + random) to avoid collisions when
    // multiple parallel requests run the same millisecond (e.g. the
    // structure-overview-dashboard fires 8 recipes concurrently via Promise.all).
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const scriptPath = join(TMP_DIR, `recipe-${uniqueId}.py`);
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(scriptPath, script, "utf8");

    // Run it.
    try {
      const { stdout, stderr } = await execFileAsync(
        "python3",
        [scriptPath],
        { timeout: 45_000, maxBuffer: 10 * 1024 * 1024 }
      );

      // Try to parse stdout as JSON; recipes print pretty-printed JSON.
      let parsed: unknown = null;
      try {
        // Find the first '{' at column 0 and take everything from there to the
        // matching '}' (the last '}' in the output for our recipes).
        const trimmed = stdout.trim();
        const startIdx = trimmed.indexOf("\n{");
        const jsonStart = startIdx >= 0 ? startIdx + 1 : (trimmed.startsWith("{") ? 0 : -1);
        if (jsonStart >= 0) {
          const jsonStr = trimmed.slice(jsonStart);
          parsed = JSON.parse(jsonStr);
        }
      } catch {
        parsed = null;
      }

      return NextResponse.json({
        recipe: recipe.id,
        ok: true,
        pdbId: body.pdbId,
        format: inputFormat,
        data: parsed,
        stdout: stdout.slice(0, 8000),
        stderr: stderr.slice(0, 2000) || undefined,
      });
    } finally {
      // Cleanup script file (keep PDB cache).
      try {
        await unlink(scriptPath);
      } catch {
        // ignore
      }
      if (body.fileContent) {
        try {
          await unlink(inputPath);
        } catch {
          // ignore
        }
      }
      if (secondPath) {
        try {
          await unlink(secondPath);
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/analyze/run] error:", msg);
    return NextResponse.json(
      { error: "Analysis run failed", detail: msg },
      { status: 500 }
    );
  }
}
