import { NextRequest, NextResponse } from "next/server";
import { inspectProviders } from "@/lib/llm/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/llm/agents — detects available LLM agent CLIs and SDKs.
 *
 * Query params:
 *   ?all=1           — include unavailable entries (UI shows them dimmed)
 *   ?whitelist=a,b   — restrict to that subset of provider ids
 *
 * Returns the union of:
 *   - Z.ai SDK (provider="glm") — always listed, available if SDK installed
 *   - CLI candidates: cli:hermes, cli:codex, cli:claude, cli:codebuddy,
 *                     cli:gemini, cli:aider
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const showUnavailable = url.searchParams.get("all") === "1";
    const whitelist = url.searchParams
      .get("whitelist")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const result = await inspectProviders({ showUnavailable, whitelist });

    // Map each provider record to also expose `id` (the CLI short name,
    // e.g. "hermes", "codex", "glm") for backwards compat with the
    // existing chat-panel UI that reads `a.id`. `provider` keeps the
    // canonical form ("cli:hermes" / "glm" / "zai") for new callers.
    const agents = result.available.map((p) => {
      const shortId = p.provider.startsWith("cli:")
        ? p.provider.slice("cli:".length)
        : p.provider; // "glm" stays "glm"
      return {
        ...p,
        id: shortId,
      };
    });

    return NextResponse.json({
      agents,
      default: result.chosen,
      totalClisScanned: result.totalClisScanned,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Agent detection failed", detail: msg },
      { status: 500 }
    );
  }
}

/**
 * POST /api/llm/agents — clear the probe cache so the next GET re-scans PATH.
 * Used by the settings UI "redetect" button.
 */
export async function POST() {
  const { clearLlmProbeCache } = await import("@/lib/llm/dispatch");
  clearLlmProbeCache();
  return NextResponse.json({ ok: true, message: "probe cache cleared" });
}
