import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";
export const maxDuration = 60;

interface VlmChatBody {
  prompt: string;
  image: string; // data URL (base64) or http URL
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

    const zai = await ZAI.create();

    const completion = await zai.chat.completions.createVision({
      model: "glm-5v-turbo",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: body.prompt },
            { type: "image_url", image_url: { url: body.image } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });

    const content =
      completion.choices?.[0]?.message?.content ?? "";

    return NextResponse.json({ content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/vlm/chat] error:", msg);
    return NextResponse.json(
      { error: "VLM 调用失败", detail: msg },
      { status: 500 }
    );
  }
}
