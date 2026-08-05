"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sigma, RefreshCw, Loader2, Info, Zap } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";

interface AromaticInteraction {
  type: "pi_pi" | "cation_pi";
  stacking?: string; // "parallel" | "perpendicular" | "displaced"
  res1: string; // "PHE85(A)"
  res2: string; // "TYR120(B)"
  distance_A: number;
  angle_deg?: number;
  cation_atom?: string;
}

interface AromaticData {
  total_aromatic_interactions: number;
  pi_pi_count: number;
  cation_pi_count: number;
  interactions: AromaticInteraction[];
}

const STACK_COLORS: Record<string, string> = {
  parallel: "#8b5cf6", // violet — face-to-face
  perpendicular: "#06b6d4", // cyan — T-shaped
  displaced: "#f59e0b", // amber — slipped
  unknown: "#9ca3af",
};

const STACK_LABELS: Record<string, string> = {
  parallel: "平行 (Face-to-Face)",
  perpendicular: "垂直 (T-shaped)",
  displaced: "位移 (Slipped)",
  unknown: "未知",
};

export function AromaticStackingChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [chain1, setChain1] = useState("A");
  const [chain2, setChain2] = useState("B");
  const [data, setData] = useState<AromaticData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "aromatic_stacking",
      params: { chain1, chain2 },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法分析芳香堆积。请上传本地 .pdb/.cif 文件后再试。`
      );
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/analyze/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      if (json.data) {
        // Check for recipe-level error (e.g. "chain not found")
        if (json.data.error) {
          setError(`分析失败: ${json.data.error}`);
          setData(null);
        } else {
          setData(json.data);
        }
      } else {
        setError(json.stderr || "无数据返回");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`芳香堆积分析失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain1, chain2, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusInteraction = async (interaction: AromaticInteraction) => {
    if (!viewer) return;
    try {
      // Parse "PHE85(A)" → chain A, resno 85, compId PHE
      const match = interaction.res1.match(/^(\w+?)(\d+)\(([A-Z])\)$/);
      if (!match) return;
      const [, compId, resnoStr, chain] = match;
      await executeCommand(viewer, {
        type: "focus_residue",
        chain,
        resno: Number(resnoStr),
        compId,
      });
      toast(`聚焦 ${interaction.res1}`, "info");
    } catch {
      toast("聚焦失败", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Sigma className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">芳香堆积</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_aromatic_interactions} 个
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchData}
            disabled={loading}
            title="重新分析"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {/* Chain inputs */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">链 1</Label>
            <Input
              value={chain1}
              onChange={(e) => setChain1(e.target.value.toUpperCase())}
              className="h-8 text-sm font-mono"
              maxLength={2}
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">链 2</Label>
            <Input
              value={chain2}
              onChange={(e) => setChain2(e.target.value.toUpperCase())}
              className="h-8 text-sm font-mono"
              maxLength={2}
            />
          </div>
        </div>

        {loading && <Skeleton className="h-24 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            加载一个结构以分析芳香堆积
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-md border bg-violet-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">π-π 堆积</div>
                <div className="font-mono text-base font-bold text-violet-600">
                  {data.pi_pi_count}
                </div>
              </div>
              <div className="rounded-md border bg-amber-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">阳离子-π</div>
                <div className="font-mono text-base font-bold text-amber-600">
                  {data.cation_pi_count}
                </div>
              </div>
            </div>

            {data.total_aromatic_interactions === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                <Sigma className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
                未检测到芳香堆积相互作用
              </div>
            ) : (
              <>
                {/* Interaction list */}
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    相互作用列表 (点击聚焦)
                  </div>
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                    {data.interactions.slice(0, 30).map((interaction, i) => {
                      const isPiPi = interaction.type === "pi_pi";
                      const color = isPiPi
                        ? STACK_COLORS[interaction.stacking ?? "unknown"]
                        : "#f59e0b";
                      return (
                        <button
                          key={i}
                          onClick={() => handleFocusInteraction(interaction)}
                          className="flex w-full items-center gap-1.5 rounded-md border bg-background p-1.5 text-left transition hover:border-primary/50 hover:bg-accent/30"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1 font-mono text-[10px]">
                              <span className="truncate font-semibold">{interaction.res1}</span>
                              <span className="text-muted-foreground">↔</span>
                              <span className="truncate font-semibold">{interaction.res2}</span>
                            </div>
                            <div className="text-[9px] text-muted-foreground">
                              {isPiPi ? (
                                <span style={{ color }}>
                                  {STACK_LABELS[interaction.stacking ?? "unknown"]?.split(" ")[0]}
                                  {interaction.angle_deg !== undefined && ` · ${interaction.angle_deg}°`}
                                </span>
                              ) : (
                                <span className="text-amber-700">
                                  阳离子-π · {interaction.cation_atom}
                                </span>
                              )}
                            </div>
                          </div>
                          <Badge variant="outline" className="font-mono text-[9px]">
                            {interaction.distance_A.toFixed(1)} Å
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                  <span className="text-muted-foreground">π-π 类型:</span>
                  {Object.entries(STACK_LABELS).slice(0, 3).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-1">
                      <span
                        className="h-0.5 w-3"
                        style={{ backgroundColor: STACK_COLORS[key] }}
                      />
                      <span className="text-muted-foreground">{label.split(" ")[0]}</span>
                    </div>
                  ))}
                </div>

                <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <div>
                    芳香堆积 (π-π / 阳离子-π) 稳定蛋白-蛋白界面，常见于抗体-抗原结合。PHE/TYR/TRP/HIS 环中心 &lt; 6Å。
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
