import { NextRequest, NextResponse } from "next/server";
import { buildMessages } from "@/lib/llm/system-prompt";
import { chatWithSession, type LlmMessage } from "@/lib/llm/dispatch";

export const runtime = "nodejs";
export const maxDuration = 300;  // 5 min — CLI providers (hermes/codex/claude) can take 1-3 min for tool-calling analysis

interface ChatRequestBody {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  context?: {
    loadedStructures?: Array<{ id: string; label?: string }>;
    currentSelection?: string;
  };
  /** Optional LLM provider override — "glm" (default) | "cli:hermes" | "cli:codex" | ... */
  provider?: string;
  /** Optional project/structure id to scope session reuse and history. */
  projectId?: string;
  /** Anonymous userId when no auth is wired — defaults to "default" so sessions persist. */
  userId?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequestBody;
    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json(
        { error: "`messages` array is required" },
        { status: 400 }
      );
    }

    const messages = buildMessages(body.messages, body.context);

    const result = await chatWithSession(
      body.userId || "default",
      "chat",
      messages as LlmMessage[],
      {
        // Only pass provider when the caller actually sent one. Falling
        // back to "glm" here would mark the call as explicit and disable
        // the fallback chain in dispatch.ts (so a missing .z-ai-config
        // would short-circuit the whole request instead of falling through
        // to cli:hermes / cli:codex).
        provider: body.provider || undefined,
        projectId: body.projectId,
        persistHistory: true,
      }
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          error: "LLM 调用失败",
          detail: result.error,
          provider: result.provider,
          fallback: result.fallback,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      content: result.content,
      usage: result.usage,
      provider: result.provider,
      model: result.model,
      fallback: result.fallback,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/llm/chat] error:", msg);
    return NextResponse.json(
      { error: "LLM 调用失败", detail: msg },
      { status: 500 }
    );
  }
}
