import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SelectBody {
  /** "chat" | "report" | "vlm" */
  scope: string;
  /** Provider id — "glm" | "cli:hermes" | "cli:codex" | ... */
  provider: string;
  /** Optional explicit model override. */
  model?: string;
  /** Anonymous userId. Defaults to "default" when no auth is wired. */
  userId?: string;
}

const VALID_SCOPES = new Set(["chat", "report", "vlm"]);

/**
 * POST /api/llm/select
 * Persists the user's current LLM provider choice for a given scope.
 * Read by chat/report/vlm routes when the request body does not specify
 * a `provider` explicitly (frontend lets users pick once and forget).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as SelectBody;
    if (!body.scope || !VALID_SCOPES.has(body.scope)) {
      return NextResponse.json(
        { error: "scope must be one of: chat, report, vlm" },
        { status: 400 }
      );
    }
    if (!body.provider) {
      return NextResponse.json(
        { error: "`provider` is required" },
        { status: 400 }
      );
    }

    const userId = body.userId || "default";

    const row = await db.lLMConfig.upsert({
      where: { userId_scope: { userId, scope: body.scope } },
      create: {
        userId,
        scope: body.scope,
        provider: body.provider,
        model: body.model,
      },
      update: {
        provider: body.provider,
        model: body.model,
      },
    });

    return NextResponse.json({ ok: true, config: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/llm/select] error:", msg);
    return NextResponse.json(
      { error: "Failed to persist LLM selection", detail: msg },
      { status: 500 }
    );
  }
}

/**
 * GET /api/llm/select?scope=chat[&userId=default]
 * Reads the persisted choice for one scope. Returns the LLMConfig row
 * (provider, model) or null when nothing is set yet.
 */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope") || "chat";
    const userId = url.searchParams.get("userId") || "default";

    if (!VALID_SCOPES.has(scope)) {
      return NextResponse.json(
        { error: "scope must be one of: chat, report, vlm" },
        { status: 400 }
      );
    }

    const row = await db.lLMConfig.findUnique({
      where: { userId_scope: { userId, scope } },
    });

    return NextResponse.json({ config: row });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Failed to read LLM selection", detail: msg },
      { status: 500 }
    );
  }
}
