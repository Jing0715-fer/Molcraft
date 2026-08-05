"use client";

import { useState, useMemo } from "react";
import {
  History,
  Trash2,
  Search,
  User,
  Bot,
  ImageIcon,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * History Panel — shows all past chat messages and reports.
 * Messages are loaded from localStorage (persisted by the store).
 * Users can search, expand individual messages, and clear history.
 */
export function HistoryPanel() {
  const messages = useAppStore((s) => s.messages);
  const reports = useAppStore((s) => s.reports);
  const clearChat = useAppStore((s) => s.clearChat);
  const removeReport = useAppStore((s) => s.removeReport);
  const toast = useAppStore((s) => s.toast);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Filter messages by search query
  const filteredMessages = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter(
      (m) =>
        m.content?.toLowerCase().includes(q) ||
        m.commands?.some((c: any) => c.type?.toLowerCase().includes(q))
    );
  }, [messages, search]);

  // Group messages by conversation (user message starts a new conversation)
  const conversations = useMemo(() => {
    const groups: Array<{
      id: string;
      title: string;
      messages: typeof messages;
      timestamp: number;
    }> = [];
    let currentGroup: typeof messages = [];
    let groupTitle = "";
    let groupTime = 0;

    for (const msg of messages) {
      if (msg.role === "user") {
        if (currentGroup.length > 0) {
          groups.push({
            id: `conv-${groupTime}`,
            title: groupTitle,
            messages: currentGroup,
            timestamp: groupTime,
          });
        }
        currentGroup = [msg];
        groupTitle = msg.content.slice(0, 60);
        groupTime = msg.ts;
      } else {
        currentGroup.push(msg);
      }
    }
    if (currentGroup.length > 0) {
      groups.push({
        id: `conv-${groupTime}`,
        title: groupTitle,
        messages: currentGroup,
        timestamp: groupTime,
      });
    }
    return groups.reverse();
  }, [filteredMessages, messages]);

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="uni-panel-header">
        <History className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">历史记录</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">
          {messages.length} 条
        </Badge>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              if (confirm("确定清除所有聊天历史？")) {
                clearChat();
                toast("聊天历史已清除", "info");
              }
            }}
            title="清除聊天历史"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="shrink-0 border-b p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索历史记录…"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0 scrollbar-thin">
        <div className="space-y-2 p-2">
          {messages.length === 0 ? (
            <div className="py-8 text-center">
              <History className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">暂无历史记录</p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                在 AI 助手中对话后，记录会自动保存
              </p>
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                className="rounded-lg border bg-background overflow-hidden"
              >
                {/* Conversation header */}
                <button
                  onClick={() =>
                    setExpandedId(expandedId === conv.id ? null : conv.id)
                  }
                  className="flex w-full items-center gap-2 p-2 text-left hover:bg-accent/30 transition-colors"
                >
                  <ChevronRight
                    className={`h-3 w-3 shrink-0 text-muted-foreground transition-transform ${
                      expandedId === conv.id ? "rotate-90" : ""
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">
                      {conv.title}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(conv.timestamp).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {conv.messages.length} 条消息
                    </div>
                  </div>
                </button>

                {/* Expanded conversation */}
                {expandedId === conv.id && (
                  <div className="border-t bg-muted/20 p-2 space-y-2 max-h-96 overflow-y-auto scrollbar-thin">
                    {conv.messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`rounded-md p-2 text-xs ${
                          msg.role === "user"
                            ? "bg-primary/5 border-l-2 border-primary"
                            : "bg-background border"
                        }`}
                      >
                        <div className="mb-1 flex items-center gap-1.5">
                          {msg.role === "user" ? (
                            <User className="h-3 w-3 text-primary" />
                          ) : (
                            <Bot className="h-3 w-3 text-muted-foreground" />
                          )}
                          <span className="text-[10px] font-medium text-muted-foreground">
                            {msg.role === "user" ? "用户" : "AI 助手"}
                          </span>
                          {msg.commands && msg.commands.length > 0 && (
                            <Badge variant="outline" className="text-[9px]">
                              {msg.commands.length} 指令
                            </Badge>
                          )}
                          {msg.snapshot && (
                            <Badge variant="outline" className="text-[9px]">
                              <ImageIcon className="h-2 w-2 mr-0.5" />
                              截图
                            </Badge>
                          )}
                        </div>
                        <div className="prose-chat text-[11px] leading-relaxed">
                          {msg.content.includes("```json") ? (
                            <pre className="text-[10px] bg-muted/50 p-1.5 rounded overflow-x-auto">
                              {msg.content}
                            </pre>
                          ) : (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.content}
                            </ReactMarkdown>
                          )}
                        </div>
                        {msg.snapshots && msg.snapshots.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {msg.snapshots.map((snap, i) => (
                              <div key={i}>
                                <div className="text-[9px] text-muted-foreground mb-0.5">
                                  {i + 1}. {snap.label}
                                </div>
                                <img
                                  src={snap.dataUrl}
                                  alt={snap.label}
                                  className="w-full rounded border max-h-48 object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                        {msg.snapshot && !msg.snapshots && (
                          <img
                            src={msg.snapshot}
                            alt="截图"
                            className="mt-2 w-full rounded border max-h-48 object-cover"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}

          {/* Reports section */}
          {reports.length > 0 && (
            <div className="pt-2">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1 mb-1">
                已保存报告 ({reports.length})
              </div>
              {reports.map((r) => (
                <div
                  key={r.id}
                  className="rounded-lg border bg-background p-2 mb-1.5"
                >
                  <div className="flex items-center gap-1.5">
                    <div className="text-xs font-medium flex-1 truncate">
                      {r.title}
                    </div>
                    <span className="text-[9px] text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("zh-CN", {
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">
                    {r.markdown.replace(/^#{1,6}\s+.+$/m, "").trim().slice(0, 120)}
                    …
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
