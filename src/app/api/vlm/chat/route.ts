import { NextRequest, NextResponse } from "next/server";
import { vlmChat, type LlmMessage } from "@/lib/llm/dispatch";

export const runtime = "nodejs";
export const maxDuration = 60;

interface VlmChatBody {
  prompt: string;
  image: string; // data URL (base64) or http URL
  /** Optional LLM provider override. Only "glm"/"zai" supports vision today. */
  provider?: string;
  projectId?: string;
  userId?: string;
}

/**
 * POST /api/vlm/chat
 * Sends an image + text prompt to the VLM (Vision Language Model) and
 * returns the model's text response. Used for screenshot quality
 * verification — e.g. "Does this screenshot clearly show the binding pocket?"
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as VlmChatBody;
    if (!body.prompt) {
      return NextResponse.json(
        { error: "`prompt` is required" },
        { status: 400 }
      );
    }
    if (!body.image) {
      return NextResponse.json(
        { error: "`image` is required (data URL or http URL)" },
        { status: 400 }
      );
    }

    const messages: LlmMessage[] = [{ role: "user", content: body.prompt }];

    const result = await vlmChat(body.userId || "default", messages, {
      provider: body.provider || "glm",
      image: body.image,
      projectId: body.projectId,
      persistHistory: false, // vision calls are ephemeral verifications
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: "VLM 调用失败",
          detail: result.error,
          provider: result.provider,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      content: result.content,
      provider: result.provider,
      model: result.model,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/vlm/chat] error:", msg);
    return NextResponse.json(
      { error: "VLM 调用失败", detail: msg },
      { status: 500 }
    );
  }
}
