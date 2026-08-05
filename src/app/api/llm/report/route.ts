import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { fetchFullMetadata, metadataToMarkdown } from "@/lib/rcsb-client";

export const runtime = "nodejs";
export const maxDuration = 90;

interface ReportRequestBody {
  /** Existing analysis notes the user/assistant already produced. */
  notes: string;
  /** The structure(s) being analyzed. */
  structures: Array<{ id: string; label?: string }>;
  /** Optional base64 PNG snapshot of the current viewport. */
  snapshot?: string;
  /** Free-text extra instructions from the user. */
  extraInstructions?: string;
  /** If true, auto-fetch RCSB metadata for the first structure (real data). */
  fetchRealData?: boolean;
}

const REPORT_SYSTEM_PROMPT = `你是一名专业的结构生物学报告撰写助手。给定真实的结构分析数据（来自 RCSB Data API：分辨率、链组成、序列、配体、组装体埋藏表面积 BSA、界面残基及每个残基的 BSA 贡献）、分析笔记，以及（可选）一张视口截图，请撰写一份结构化的中文 Markdown 深度分析报告。

# 报告结构（必须包含）
1. **标题** — 简洁、突出研究对象。
2. **结构概览** — 来源 PDB ID、实验方法、分辨率、分子量、链/亚基组成（每条链的描述、长度、来源生物）、配体/辅因子。
3. **表示与着色方案** — 当前画面采用的表示方式与着色策略，以及为什么。
4. **界面分析** — 总 BSA、每个 interface 的面积与 partner 链、按 BSA 排序的关键界面残基（≥50 Å² 视为热点）、界面氢键数（如笔记中提供）。
5. **关键观察** — 二级结构、保守残基、活性位点、相互作用网络、表面特征等。
6. **测量结果** — 距离/角度/二面角数值（若笔记中提供）与生物学解读。
7. **图注** — 描述截图展示了什么（如果提供了 snapshot）。
8. **结论与建议** — 关键发现 1-3 条；后续可进行的分析方向。

# 写作要求
- 中文，专业但清晰。
- 数值给出单位（Å, Å², °），并标注来源（如 "(RCSB Assembly 1)"）。
- 关键残基用三字母+序号（如 W111, Y94）+ BSA 值。
- 真实数据用 **加粗** 突出。
- 不要编造数据；如果笔记中没有的内容用"暂未分析"或建议用户验证。
- 报告长度控制在 800-1500 字。
- 用 Markdown 标题、列表、表格组织。
`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ReportRequestBody;

    // Auto-fetch real RCSB metadata if requested and we have a PDB-like ID.
    let realDataMarkdown = "";
    if (body.fetchRealData && body.structures.length > 0) {
      const first = body.structures[0];
      const id = first.id;
      // Only fetch if it looks like a 4-char PDB ID
      if (/^[a-zA-Z0-9]{4}$/.test(id)) {
        try {
          const data = await fetchFullMetadata(id, true);
          realDataMarkdown = metadataToMarkdown(data);
        } catch (err) {
          realDataMarkdown = `(RCSB 元数据获取失败: ${
            err instanceof Error ? err.message : String(err)
          })`;
        }
      }
    }

    const userContent = `
# 当前结构
${JSON.stringify(body.structures, null, 2)}

${
  realDataMarkdown
    ? `# ★ RCSB 真实结构数据（由后端自动获取，请基于此撰写报告，不要编造）\n${realDataMarkdown}`
    : ""
}

# 分析笔记
${body.notes || "（暂无笔记，请基于 RCSB 数据撰写）"}

${body.snapshot ? "# 视口截图\n（已附 PNG 图像）" : ""}

${body.extraInstructions ? `# 额外要求\n${body.extraInstructions}` : ""}
`.trim();

    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: REPORT_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
      temperature: 0.4,
      max_tokens: 3000,
      thinking: { type: "disabled" },
    });

    const markdown = completion.choices[0]?.message?.content ?? "";

    return NextResponse.json({
      markdown,
      realDataFetched: Boolean(realDataMarkdown),
      usage: completion.usage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[/api/llm/report] error:", msg);
    return NextResponse.json(
      { error: "报告生成失败", detail: msg },
      { status: 500 }
    );
  }
}
