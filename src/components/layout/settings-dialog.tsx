"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  RefreshCw,
  Terminal,
  FlaskConical,
  Package,
  Settings,
} from "lucide-react";

interface ToolInfo {
  id: string;
  label: string;
  available: boolean;
  version?: string;
  description: string;
  capabilities: string[];
  error?: string;
}

interface InstallResult {
  ok: boolean;
  detail: string;
}

/** Tools that can be pip-installed (one-click install) */
const INSTALLABLE: Record<
  string,
  { pipPackage: string; label: string; description: string }
> = {
  pymol: {
    pipPackage: "pymol-open-source",
    label: "PyMOL (open-source)",
    description: "分子可视化与脚本分析 (RMSD, interface residues, 测量)",
  },
  dssp: {
    pipPackage: "dssp",
    label: "DSSP (mkdssp)",
    description: "二级结构分配 (α-helix, β-sheet, turn, coil) + 氢键检测",
  },
};

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  const [installResults, setInstallResults] = useState<
    Record<string, InstallResult>
  >({});

  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cli/list");
      if (res.ok) {
        const data = await res.json();
        setTools(data.clis ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  const handleInstall = async (toolId: string) => {
    const config = INSTALLABLE[toolId];
    if (!config) return;
    setInstalling(toolId);
    try {
      const res = await fetch("/api/cli/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolId, pipPackage: config.pipPackage }),
      });
      const data = await res.json();
      setInstallResults((prev) => ({
        ...prev,
        [toolId]: { ok: data.ok, detail: data.detail || data.error },
      }));
      if (data.ok) {
        // Refresh tool list
        await fetchTools();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setInstallResults((prev) => ({
        ...prev,
        [toolId]: { ok: false, detail: msg },
      }));
    } finally {
      setInstalling(null);
    }
  };

  const availableCount = tools.filter((t) => t.available).length;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="h-5 w-5 text-primary" />
            设置 — 生物信息工具管理
          </DialogTitle>
          <DialogDescription className="text-xs">
            查看本地已安装的结构生物学分析工具。LLM 可调用已安装的工具进行深度分析。部分工具支持一键安装。
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between border-b bg-accent/20 px-5 py-2">
          <div className="flex items-center gap-2 text-xs">
            <Package className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">
              {availableCount}/{tools.length} 个工具可用
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={fetchTools}
            disabled={loading}
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            重新检测
          </Button>
        </div>

        <ScrollArea className="max-h-[55vh] scrollbar-thin">
          <div className="space-y-2 p-4">
            {loading && (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-20 animate-pulse rounded-lg border bg-muted/30"
                  />
                ))}
              </div>
            )}

            {!loading &&
              tools.map((tool) => {
                const isInstallable = INSTALLABLE[tool.id];
                const installResult = installResults[tool.id];
                return (
                  <div
                    key={tool.id}
                    className={`rounded-lg border p-3 transition ${
                      tool.available
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : "border-muted bg-muted/20"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {tool.available ? (
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                          ) : (
                            <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="text-sm font-semibold">
                            {tool.label}
                          </span>
                          {tool.version && (
                            <Badge
                              variant="outline"
                              className="font-mono text-[10px]"
                            >
                              v{tool.version.slice(0, 12)}
                            </Badge>
                          )}
                          {tool.available ? (
                            <Badge
                              variant="secondary"
                              className="bg-emerald-500/15 px-1.5 py-0 text-[9px] text-emerald-700"
                            >
                              已安装
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="px-1.5 py-0 text-[9px] text-muted-foreground"
                            >
                              未安装
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                          {tool.description}
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {tool.capabilities.slice(0, 4).map((cap) => (
                            <span
                              key={cap}
                              className="rounded bg-muted px-1 py-0 text-[9px] text-muted-foreground"
                            >
                              {cap}
                            </span>
                          ))}
                        </div>
                        {installResult && (
                          <div
                            className={`mt-2 rounded px-2 py-1 text-[10px] ${
                              installResult.ok
                                ? "bg-emerald-500/10 text-emerald-700"
                                : "bg-destructive/10 text-destructive"
                            }`}
                          >
                            {installResult.ok ? "✓ " : "✗ "}
                            {installResult.detail}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0">
                        {!tool.available && isInstallable && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 text-[11px]"
                            onClick={() => handleInstall(tool.id)}
                            disabled={installing === tool.id}
                          >
                            {installing === tool.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Download className="h-3 w-3" />
                            )}
                            一键安装
                          </Button>
                        )}
                        {!tool.available && !isInstallable && (
                          <span className="text-[10px] text-muted-foreground">
                            需手动安装
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </ScrollArea>

        <div className="border-t bg-accent/10 px-5 py-2 text-[10px] text-muted-foreground">
          <FlaskConical className="mr-1 inline h-3 w-3" />
          安装的工具将被 LLM 自动检测并可用于深度结构分析（如 DSSP 二级结构、PyMOL RMSD 比对等）。
        </div>
      </DialogContent>
    </Dialog>
  );
}
