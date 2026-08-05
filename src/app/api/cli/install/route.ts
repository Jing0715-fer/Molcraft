import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const maxDuration = 120;

interface InstallBody {
  toolId: string;
  pipPackage: string;
}

/**
 * POST /api/cli/install
 *
 * Installs a bioinformatics tool via pip. Used by the Settings dialog's
 * "一键安装" button.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as InstallBody;
    if (!body.pipPackage) {
      return NextResponse.json(
        { error: "`pipPackage` is required" },
        { status: 400 }
      );
    }

    // Whitelist allowed packages
    const ALLOWED = new Set([
      "pymol-open-source",
      "dssp",
      "pdb-tools",
      "freesasa",
      "biopython",
      "numpy",
    ]);
    if (!ALLOWED.has(body.pipPackage)) {
      return NextResponse.json(
        { error: `Package "${body.pipPackage}" is not in the install whitelist` },
        { status: 400 }
      );
    }

    // Run pip install
    try {
      const { stdout, stderr } = await execFileAsync(
        "pip3",
        ["install", "--quiet", body.pipPackage],
        { timeout: 90_000, maxBuffer: 10 * 1024 * 1024 }
      );

      return NextResponse.json({
        ok: true,
        detail: `Successfully installed ${body.pipPackage}`,
        stdout: stdout.slice(0, 2000),
        stderr: stderr.slice(0, 1000) || undefined,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({
        ok: false,
        detail: `Installation failed: ${msg.slice(0, 500)}`,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/cli/install] error:", msg);
    return NextResponse.json(
      { error: "Install failed", detail: msg },
      { status: 500 }
    );
  }
}
