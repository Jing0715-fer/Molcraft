"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Send,
  Loader2,
  Trash2,
  Sparkles,
  AlertCircle,
  Wand2,
  ImagePlus,
  User,
  Terminal,
  Check,
  ChevronDown,
  RefreshCw,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useAppStore, type ChatMessage } from "@/lib/store";
import { parseLlmPayload } from "@/lib/llm/command-schema";
import { executeCommand, type CommandResult } from "@/lib/molstar/commands";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const SUGGESTIONS = [
  {
    icon: "🔬",
    title: "全面分析复合物",
    prompt:
      "加载 9ehs，全面分析这个纳米抗体-Fab-受体复合物：获取元数据、寡聚状态、所有界面互作（氢键、盐桥、疏水接触、芳香堆积）、结构质量验证，最后生成完整的图文报告。",
  },
  {
    icon: "🧪",
    title: "酶活性位点深度分析",
    prompt:
      "加载 6LU7 (SARS-CoV-2 Mpro)，分析配体结合口袋残基组成、催化残基与抑制剂的原子级接触、水桥和金属配位，生成酶-抑制剂互作报告。",
  },
  {
    icon: "🧬",
    title: "血红蛋白寡聚体分析",
    prompt:
      "加载 4HHB，分析其寡聚状态、所有链间界面、表面 vs buried 残基分布、静电势、二级结构组成和结构质量，生成多聚体蛋白分析报告。",
  },
  {
    icon: "⚖️",
    title: "同源结构比较",
    prompt:
      "加载 1CBS 和 1CBR，对两个视黄酸结合蛋白进行序列比对和结构叠合 RMSD 比较，分析两者的结构差异和保守残基。",
  },
];

interface LlmAgent {
  id: string;
  label: string;
  available: boolean;
  description: string;
  bin?: string;
}

export function ChatPanel() {
  const [input, setInput] = useState("");
  const messages = useAppStore((s) => s.messages);
  const addMessage = useAppStore((s) => s.addMessage);
  const updateMessage = useAppStore((s) => s.updateMessage);
  const clearChat = useAppStore((s) => s.clearChat);
  const viewer = useAppStore((s) => s.viewer);
  const structures = useAppStore((s) => s.structures);
  const toast = useAppStore((s) => s.toast);
  const setLastSnapshot = useAppStore((s) => s.setLastSnapshot);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const addReport = useAppStore((s) => s.addReport);
  const logCommand = useAppStore((s) => s.logCommand);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sendingRef = useRef(false);

  // LLM agent CLI state
  const [agents, setAgents] = useState<LlmAgent[]>([]);
  const [cliLoading, setCliLoading] = useState(false);
  const [cliOpen, setCliOpen] = useState(false);
  const [activeCli, setActiveCli] = useState<string>("glm");

  // Detect available LLM agent CLIs
  const refreshClis = useCallback(async () => {
    setCliLoading(true);
    try {
      const res = await fetch("/api/llm/agents");
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents ?? []);
        const availCount = (data.agents ?? []).filter((a: any) => a.available).length;
        toast(`检测到 ${availCount} 个可用的 LLM agent`, "info");
      }
    } catch {
      toast("Agent 检测失败", "error");
    } finally {
      setCliLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refreshClis();
  }, [refreshClis]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  /**
   * Core send function. Implements an autonomous agent loop:
   * 1. Send user message + history to LLM
   * 2. Parse JSON response → { reply, commands, captureSnapshot, continueAfterAnalysis }
   * 3. Execute commands sequentially; collect analysis results
   * 4. If continueAfterAnalysis, feed results back to LLM and loop (up to 60 rounds)
   * 5. Agent decides when it has enough data and stops requesting continuation
   */
  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || sendingRef.current) return;
      sendingRef.current = true;

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: "user",
        content: trimmed,
        ts: Date.now(),
      };
      const pendingId = `a-${Date.now()}`;
      const pendingMsg: ChatMessage = {
        id: pendingId,
        role: "assistant",
        content: "",
        ts: Date.now(),
        pending: true,
      };
      addMessage(userMsg);
      addMessage(pendingMsg);
      setInput("");

      try {
        // Build the conversation history that grows as the agent loops.
        const history: Array<{ role: "user" | "assistant"; content: string }> = [
          ...messages.map((m) => ({ role: m.role, content: m.content })),
          { role: "user" as const, content: trimmed },
        ];

        const MAX_ROUNDS = 60;
        let allAnalysisResults: unknown[] = [];
        let allCommands: unknown[] = [];
        let finalSnapshot: string | undefined;
        let finalSnapshotLabel: string | undefined;
        const allSnapshots: Array<{ label: string; dataUrl: string }> = [];
        let vlmNotes: string[] = [];
        let roundNum = 0;
        let totalTokensUsed = 0;

        for (roundNum = 0; roundNum < MAX_ROUNDS; roundNum++) {
          // Update the pending message to show progress.
          if (roundNum > 0) {
            updateMessage(pendingId, {
              content: `🔍 深度分析中… (第 ${roundNum + 1} 轮，已执行 ${allCommands.length} 条指令，获取 ${allAnalysisResults.length} 项结果)`,
              commands: allCommands,
              pending: true,
            });
          }

          // Fetch with retry — the LLM API can timeout (500/502) or fail
          // temporarily. Retry up to 2 times with exponential backoff.
          let res: Response | null = null;
          let lastErr: string | null = null;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              res = await fetch("/api/llm/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  messages: history,
                  provider: activeCli === "glm" ? "glm" : `cli:${activeCli}`,
                  projectId: structures[0]?.id,
                  userId: "default",
                  context: {
                    loadedStructures: structures.map((s) => ({
                      id: s.id,
                      label: s.label,
                    })),
                  },
                }),
              });
              if (res.ok) break;
              const err = await res.json().catch(() => ({}));
              lastErr = err.detail || err.error || `HTTP ${res.status}`;
              if (res.status === 400 || res.status === 404) break;
            } catch (e: any) {
              lastErr = e?.message || String(e);
            }
            if (attempt < 2) {
              updateMessage(pendingId, {
                content: `⚠️ LLM 调用失败 (${lastErr}), 重试中… (${attempt + 2}/3)`,
                commands: allCommands,
                pending: true,
              });
              await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            }
          }
          if (!res || !res.ok) {
            throw new Error(lastErr || "LLM 调用失败");
          }
          const data = (await res.json()) as { content: string; usage?: { total_tokens?: number } };
          const payload = parseLlmPayload(data.content);

          // Track token usage
          if (data.usage?.total_tokens) {
            totalTokensUsed += data.usage.total_tokens;
          }

          // Track commands
          if (payload.commands) {
            allCommands.push(...payload.commands);
          }

          // Execute commands.
          // Collect errors to feed back to the LLM.
          const cmdErrors: string[] = [];
          if (payload.commands && payload.commands.length > 0 && viewer) {
            for (const cmd of payload.commands) {
              const r: CommandResult = await executeCommand(viewer, cmd);
              logCommand({
                type: (cmd as { type: string }).type,
                ok: r.ok,
                detail: r.detail,
              });
              if (r.analysisResult) {
                allAnalysisResults.push(r.analysisResult);
              }
              // Collect errors for LLM feedback.
              if (!r.ok) {
                cmdErrors.push(
                  `指令 ${(cmd as { type: string }).type} 失败: ${r.detail}`
                );
              }
              // Capture snapshot results from `capture_snapshot` command
              if (
                (cmd as { type: string }).type === "capture_snapshot" &&
                r.ok &&
                r.data?.dataUri
              ) {
                finalSnapshot = r.data.dataUri as string;
                finalSnapshotLabel =
                  (r.data.label as string | undefined) ?? "";
                setLastSnapshot(finalSnapshot);
                // Also collect into allSnapshots for multi-screenshot gallery
                allSnapshots.push({
                  label: finalSnapshotLabel || `截图 ${allSnapshots.length + 1}`,
                  dataUrl: finalSnapshot,
                });

                // VLM screenshot verification: check if the screenshot
                // clearly shows the expected content. If not, try adjusting
                // the camera angle and re-capturing once.
                try {
                  const vlmRes = await fetch("/api/vlm/chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      prompt: `这是一张蛋白质结构截图，标签是"${finalSnapshotLabel}"。请简短回答：这张截图是否清晰地展示了关键结构信息？角度是否合适？回答"好"或"不好"并说明原因，不超过30字。`,
                      image: finalSnapshot,
                    }),
                  });
                  if (vlmRes.ok) {
                    const vlmData = await vlmRes.json();
                    const vlmText = vlmData.content || "";
                    const isGood = /好|清晰|合适|good|clear|fine/i.test(vlmText);
                    if (!isGood) {
                      vlmNotes.push(`截图 "${finalSnapshotLabel}" VLM反馈: ${vlmText.slice(0, 80)}`);
                      // Auto-adjust: reset camera and re-capture
                      if (viewer) {
                        try {
                          viewer.plugin.managers.camera.reset();
                          await new Promise((r) => setTimeout(r, 800));
                          const reDataUri =
                            await viewer.plugin.helpers?.viewportScreenshot?.getImageDataUri({
                              width: 1600, height: 900, transparency: false, axes: true,
                            });
                          if (reDataUri) {
                            // Replace the snapshot with the re-captured one
                            finalSnapshot = reDataUri;
                            setLastSnapshot(reDataUri);
                            const lastSnap = allSnapshots[allSnapshots.length - 1];
                            if (lastSnap) lastSnap.dataUrl = reDataUri;
                          }
                        } catch {
                          // Camera reset failed — keep original screenshot
                        }
                      }
                    }
                  }
                } catch {
                  // VLM check is optional — don't break the flow if it fails
                }
              }
            }
          }

          // Capture snapshot if requested (legacy captureSnapshot flag).
          if (payload.captureSnapshot && viewer && !finalSnapshot) {
            try {
              const dataUri =
                await viewer.plugin.helpers?.viewportScreenshot?.getImageDataUri({
                  width: 1600,
                  height: 900,
                  transparency: false,
                  axes: true,
                });
              if (dataUri) {
                finalSnapshot = dataUri;
                setLastSnapshot(dataUri);
              }
            } catch {
              // ignore
            }
          }

          // Add the assistant's reply to history.
          // For intermediate rounds, save the raw JSON (for context).
          // For the final round, save the clean reply text.
          history.push({
            role: "assistant",
            content: data.content,
          });

          // Track the latest clean reply for the final message.
          let latestReply = payload.reply || "";

          // Force-continue check: if the LLM said continueAfterAnalysis=false
          // but the reply is short/intermediate (e.g., "正在加载..." or "正在分析..."),
          // AND we have analysis results OR command errors, force another round
          // so the LLM can write the final report based on the data it collected.
          const isIntermediateReply =
            latestReply.length < 100 &&
            (/正在|加载|获取|分析中|请稍/i.test(latestReply));
          const hasData = allAnalysisResults.length > 0 || cmdErrors.length > 0;
          // Also force-continue if we executed commands but got a short reply
          // (e.g., LLM loaded structure but didn't analyze it yet)
          const hasCommands = allCommands.length > 0;
          const shouldForceContinue = isIntermediateReply && (hasData || roundNum < 2) && roundNum < MAX_ROUNDS - 1;

          if (shouldForceContinue) {
            // Override: force continue so LLM can issue commands and write report
            payload.continueAfterAnalysis = true;
          }

          // Check if the agent wants to continue analysis.
          // Terminate ONLY if: continueAfterAnalysis is false AND
          // (we have analysis data OR no commands were executed AND no errors).
          // This prevents premature termination when LLM returns true but
          // with no analysis results yet.
          if (
            !payload.continueAfterAnalysis &&
            (hasData || (!hasCommands && cmdErrors.length === 0))
          ) {
            // Agent is done — finalize with the LATEST reply (not the first round's).
            const finalContent = latestReply || (allCommands.length > 0 ? "已完成。" : "(空回复)");

            updateMessage(pendingId, {
              content: finalContent,
              commands: allCommands,
              snapshot: finalSnapshot,
              snapshots: allSnapshots.length > 0 ? allSnapshots : undefined,
              snapshotLabel: finalSnapshotLabel,
              cmdErrors: vlmNotes.length > 0 ? vlmNotes : undefined,
              pending: false,
              error: undefined,
            });

            // Also update the history's last assistant message to the clean reply
            // (so the conversation history shows the clean text, not the raw JSON).
            if (history.length > 0 && history[history.length - 1].role === "assistant") {
              history[history.length - 1].content = finalContent;
            }

            // Save as report if it looks like one.
            // Always save when reply starts with # heading and has any data/snapshots/commands.
            const isReport =
              finalContent.length > 100 && /^#{1,3}\s/m.test(finalContent);
            if (isReport) {
              addReport({
                id: pendingId,
                title: extractTitle(finalContent) ?? "分析报告",
                markdown: finalContent,
                snapshot: finalSnapshot,
                snapshots: allSnapshots.length > 0 ? allSnapshots : undefined,
                createdAt: Date.now(),
              });
              toast("已生成深度分析报告", "success");
              setRightPanelTab("reports");
            } else if (allCommands.length > 0) {
              toast(`完成 ${roundNum + 1} 轮分析，执行 ${allCommands.length} 条指令`, "info");
            }
            break;
          }

          // Agent wants to continue — feed analysis results back.
          // Truncate to avoid token overflow.
          const resultsJson = allAnalysisResults.length > 0
            ? JSON.stringify(allAnalysisResults.slice(-10), null, 2).slice(0, 12000)
            : "(暂无分析结果 — 请发出 analyze_metadata 或 analyze_run 指令获取结构数据)";
          let feedbackMsg =
            `[系统自动注入 - 第 ${roundNum + 1} 轮分析结果]\n` +
            `已执行 ${allCommands.length} 条指令，获取 ${allAnalysisResults.length} 项结果。\n`;
          if (cmdErrors.length > 0) {
            feedbackMsg += `\n⚠️ 以下指令执行失败，请根据错误调整策略：\n${cmdErrors.join("\n")}\n`;
          }
          if (shouldForceContinue) {
            feedbackMsg += `\n★ 你上一轮的回复太短（"${latestReply.slice(0, 50)}"）。请现在发出 analyze_metadata 或 analyze_run 指令获取真实数据，然后在下一轮写出完整报告。\n`;
          }
          feedbackMsg += `\n最新结果:\n${resultsJson}\n\n请继续：如果数据已足够完成任务，请设置 continueAfterAnalysis=false 并给出最终报告；如果需要更多分析，继续发出指令。`;
          history.push({
            role: "user",
            content: feedbackMsg,
          });

          // Update interim message.
          updateMessage(pendingId, {
            content: payload.reply || `🔍 第 ${roundNum + 1} 轮分析完成，继续…`,
            commands: allCommands,
            pending: true,
          });
        }

        // If we hit the max rounds, finalize with a note.
        if (roundNum >= MAX_ROUNDS) {
          updateMessage(pendingId, {
            content: `⚠️ 已达到最大分析轮数 (${MAX_ROUNDS})。已执行 ${allCommands.length} 条指令，获取 ${allAnalysisResults.length} 项结果。请基于以上结果继续提问。`,
            commands: allCommands,
            snapshot: finalSnapshot,
            snapshotLabel: finalSnapshotLabel,
            cmdErrors: vlmNotes.length > 0 ? vlmNotes : undefined,
            pending: false,
          });
          toast(`达到最大分析轮数 ${MAX_ROUNDS}`, "info");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        updateMessage(pendingId, {
          content: "",
          pending: false,
          error: msg,
        });
        toast(`助手出错: ${msg}`, "error");
      } finally {
        sendingRef.current = false;
      }
    },
    [
      messages,
      addMessage,
      updateMessage,
      viewer,
      structures,
      toast,
      setLastSnapshot,
      setRightPanelTab,
      addReport,
      logCommand,
    ]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const availableCount = agents.filter((a) => a.available).length;

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="uni-panel-header justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">AI 结构助手</span>
          {availableCount > 0 && (
            <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px]">
              <Terminal className="h-2.5 w-2.5" />
              {availableCount} agent
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={clearChat}
          title="清空对话"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 scrollbar-thin" ref={scrollRef as never}>
        <div className="space-y-3 p-3">
          {messages.length === 0 && (
            <div className="space-y-3 py-4">
              <div className="rounded-lg border border-dashed bg-accent/20 p-3 text-center">
                <Wand2 className="mx-auto mb-2 h-6 w-6 text-primary" />
                <p className="text-sm font-medium">深度结构分析 · 真实数据驱动</p>
                <p className="mt-1 break-words text-[11px] leading-relaxed text-muted-foreground">
                  AI 调用 RCSB API + 本地工具获取真实数据
                </p>
              </div>
              <div className="space-y-1.5">
                <div className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  快速开始
                </div>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.title}
                    onClick={() => send(s.prompt)}
                    className="group flex w-full items-start gap-2 rounded-lg border bg-background p-2 text-left transition hover:border-primary/50 hover:bg-accent/30"
                  >
                    <span className="text-sm leading-tight">{s.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-medium">{s.title}</div>
                      <div className="mt-0.5 line-clamp-2 break-words text-[10px] leading-snug text-muted-foreground group-hover:text-foreground/80">
                        {s.prompt}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="shrink-0 border-t p-3">
        <div className="relative">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想做的分析… AI 会调用 RCSB API 和本地 CLI 获取真实数据。 (Enter 发送)"
            className="min-h-[60px] max-h-[160px] resize-none pr-24 text-sm"
            disabled={!viewer}
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            {/* CLI selector button */}
            <Popover open={cliOpen} onOpenChange={setCliOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1 px-2 text-[11px]"
                  title="选择 LLM agent"
                >
                  <Terminal className="h-3 w-3" />
                  {activeCli === "glm" ? "GLM" : activeCli}
                  <ChevronDown className="h-2.5 w-2.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-72 p-0"
                sideOffset={4}
              >
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold">
                    <Terminal className="h-3.5 w-3.5" />
                    LLM Agent
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={refreshClis}
                    disabled={cliLoading}
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${cliLoading ? "animate-spin" : ""}`}
                    />
                  </Button>
                </div>
                <div className="max-h-72 overflow-y-auto scrollbar-thin">
                  {agents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => {
                        if (a.available) {
                          setActiveCli(a.id);
                          setCliOpen(false);
                        }
                      }}
                      disabled={!a.available}
                      className={`flex w-full items-start justify-between border-b px-3 py-2 text-left transition last:border-b-0 hover:bg-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${
                        activeCli === a.id ? "bg-accent/40" : ""
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              a.available ? "bg-emerald-500" : "bg-muted-foreground/30"
                            }`}
                          />
                          <span className="text-xs font-medium">{a.label}</span>
                          {a.available ? (
                            <span className="rounded bg-emerald-500/15 px-1 text-[9px] text-emerald-700">
                              可用
                            </span>
                          ) : (
                            <span className="rounded bg-muted px-1 text-[9px] text-muted-foreground">
                              未安装
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          {a.description}
                        </div>
                      </div>
                      {activeCli === a.id && (
                        <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
                <div className="border-t bg-muted/30 px-3 py-1.5 text-[10px] text-muted-foreground">
                  {availableCount} 个可用 agent · 在设置页面管理分析工具
                </div>
              </PopoverContent>
            </Popover>

            <Button
              size="icon"
              className="h-8 w-8"
              onClick={() => send(input)}
              disabled={!input.trim() || !viewer}
            >
              <Send className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            {viewer ? (
              <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                查看器就绪
              </Badge>
            ) : (
              <Badge
                variant="outline"
                className="px-1.5 py-0 text-[10px] text-amber-600"
              >
                查看器加载中…
              </Badge>
            )}
          </span>
          <span>
            {activeCli !== "glm" ? `Agent: ${activeCli}` : "基于 Z.ai GLM"}
          </span>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex animate-fade-in-up items-start justify-end gap-2">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        </div>
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <User className="h-3.5 w-3.5" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex animate-fade-in-up items-start gap-2">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
        <Sparkles className="h-3.5 w-3.5" />
      </div>
      <div className="max-w-[85%] space-y-2">
        <div className="rounded-2xl rounded-bl-sm border bg-background px-3 py-2">
          {message.pending && !message.content ? (
            <ThinkingIndicator />
          ) : message.error ? (
            <div className="flex items-start gap-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-medium">出错了</div>
                <div className="text-[12px] opacity-90">{message.error}</div>
              </div>
            </div>
          ) : (
            <div className="prose-chat">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content || ""}
              </ReactMarkdown>
            </div>
          )}

          {message.commands && message.commands.length > 0 && (
            <div className="mt-2 border-t pt-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                执行的指令 ({message.commands.length})
              </div>
              <div className="flex flex-wrap gap-1">
                {(message.commands as Array<{ type: string }>).map((c, i) => (
                  <Badge
                    key={i}
                    variant="secondary"
                    className="px-1.5 py-0 font-mono text-[10px]"
                  >
                    {c.type}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {message.cmdErrors && message.cmdErrors.length > 0 && (
            <div className="mt-2 rounded-md border border-amber-300/60 bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
              {message.cmdErrors.map((e, i) => (
                <div key={i} className="flex items-start gap-1">
                  <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>{e}</span>
                </div>
              ))}
            </div>
          )}

          {/* Multi-screenshot gallery */}
          {message.snapshots && message.snapshots.length > 0 && (
            <div className="mt-2 border-t pt-2 space-y-2">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <ImagePlus className="h-3 w-3" />
                结构截图 ({message.snapshots.length})
              </div>
              {message.snapshots.map((snap, i) => (
                <div key={i} className="space-y-0.5">
                  <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="font-medium">{i + 1}. {snap.label}</span>
                    <button
                      type="button"
                      className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] hover:bg-accent hover:text-foreground"
                      title="下载高清 PNG"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = snap.dataUrl;
                        a.download = `${snap.label.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.png`;
                        a.click();
                      }}
                    >
                      <Download className="h-3 w-3" />
                      <span>PNG</span>
                    </button>
                  </div>
                  <img
                    src={snap.dataUrl}
                    alt={snap.label}
                    className="w-full rounded-md border"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Single snapshot (legacy) */}
          {message.snapshot && !message.snapshots && (
            <div className="mt-2 border-t pt-2">
              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <ImagePlus className="h-3 w-3" />
                视口截图
                {message.snapshotLabel ? (
                  <span className="ml-1 normal-case text-foreground/80">
                    · {message.snapshotLabel}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  title="下载高清 PNG"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = message.snapshot!;
                    a.download = `${
                      (message.snapshotLabel || "snapshot").replace(
                        /[^\w\u4e00-\u9fa5-]+/g,
                        "_"
                      )
                    }.png`;
                    a.click();
                  }}
                >
                  <Download className="h-3 w-3" />
                  <span>PNG</span>
                </button>
              </div>
              <img
                src={message.snapshot}
                alt={message.snapshotLabel || "viewport snapshot"}
                className="w-full rounded-md border"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
      <div className="flex gap-1">
        <span
          className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot"
          style={{ animationDelay: "0ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot"
          style={{ animationDelay: "200ms" }}
        />
        <span
          className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-dot"
          style={{ animationDelay: "400ms" }}
        />
      </div>
      <span className="text-xs">正在分析结构…</span>
    </div>
  );
}

function extractTitle(markdown: string): string | null {
  const m = markdown.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
}
