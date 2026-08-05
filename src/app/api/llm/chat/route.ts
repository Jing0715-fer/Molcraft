import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { buildMessages } from "@/lib/llm/system-prompt";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ChatRequestBody {
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  context?: {
    loadedStructures?: Array<{ id: string; label?: string }>;
    currentSelection?: string;
  };
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

    const zai = await ZAI.create();
    const messages = buildMessages(body.messages, body.context);

    const completion = await zai.chat.completions.create({
      messages,
      // Slightly higher temperature for natural explanations,
      // but low enough that JSON structure stays valid.
      temperature: 0.4,
      max_tokens: 4096,
      thinking: { type: "disabled" },
    });

    const content = completion.choices[0]?.message?.content ?? "";

    return NextResponse.json({
      content,
      usage: completion.usage,
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
