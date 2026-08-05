import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** LLM agent CLI definitions — inspired by the reference repo's CLI_ADAPTERS pattern. */
const AGENT_ADAPTERS = [
  {
    id: "glm",
    label: "GLM (Z.ai)",
    description: "Z.ai GLM 大语言模型 — 默认后端，通过 z-ai-web-dev-sdk 调用",
    bin: "python3", // always available — uses SDK not CLI
    alwaysAvailable: true,
  },
  {
    id: "claude",
    label: "Claude CLI",
    description: "Anthropic Claude 命令行工具 — 需安装 claude CLI 并配置 API key",
    bin: "claude",
  },
  {
    id: "codex",
    label: "Codex CLI",
    description: "OpenAI Codex 命令行工具 — 需安装 codex CLI 并配置 API key",
    bin: "codex",
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    description: "Google Gemini 命令行工具 — 需安装 gemini CLI 并配置 API key",
    bin: "gemini",
  },
  {
    id: "aider",
    label: "Aider",
    description: "Aider AI pair programmer — 开源 AI 编程助手，支持多种 LLM 后端",
    bin: "aider",
  },
  {
    id: "hermes",
    label: "Hermes CLI",
    description: "Hermes AI agent — 多模型路由 CLI，支持工具调用与代码执行",
    bin: "hermes",
  },
  {
    id: "codebuddy",
    label: "CodeBuddy",
    description: "CodeBuddy CLI — 腾讯云 AI 代码助手，支持代码生成与分析",
    bin: "codebuddy",
  },
  {
    id: "cursor",
    label: "Cursor",
    description: "Cursor AI — AI 代码编辑器（如已安装）",
    bin: "cursor",
  },
];

async function checkBin(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/** GET /api/llm/agents — detects available LLM agent CLIs. */
export async function GET() {
  try {
    const agents = await Promise.all(
      AGENT_ADAPTERS.map(async (a) => {
        const available = a.alwaysAvailable
          ? true
          : await checkBin(a.bin);
        return {
          id: a.id,
          label: a.label,
          description: a.description,
          available,
          bin: a.bin,
        };
      })
    );

    return NextResponse.json({
      agents,
      default: "glm",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "Agent detection failed", detail: msg },
      { status: 500 }
    );
  }
}
