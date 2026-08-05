"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Network, RefreshCw, Info, Ruler, Zap, Link2, Droplets } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { clearInteractionState, showAtomsForInteraction } from "@/lib/molstar/measure";
import { findAtomCoord } from "@/lib/structure-utils";

interface Interaction {
  type: "salt_bridge" | "hbond" | "hydrophobic";
  chain1: string;
  resno1: number;
  resname1: string;
  atom1: string;
  chain2: string;
  resno2: number;
  resname2: string;
  atom2: string;
  distance_A: number;
}

interface AllInteractionsData {
  chain1: string;
  chain2: string;
  total: number;
  salt_bridges: number;
  hbonds: number;
  hydrophobic: number;
  interactions: Interaction[];
}

const TYPE_META: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  salt_bridge: { label: "盐桥", color: "#f59e0b", icon: <Zap className="h-3 w-3" /> },
  hbond: { label: "氢键", color: "#0ea5e9", icon: <Link2 className="h-3 w-3" /> },
  hydrophobic: { label: "疏水", color: "#10b981", icon: <Droplets className="h-3 w-3" /> },
};

type FilterType = "all" | "salt_bridge" | "hbond" | "hydrophobic";

export function InteractionNetwork() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const setInteractionLines = useAppStore((s) => s.setInteractionLines);
  const clearInteractionLines = useAppStore((s) => s.clearInteractionLines);
  const clearMeasurements = useAppStore((s) => s.clearMeasurements);
  const [chain1, setChain1] = useState("A");
  const [chain2, setChain2] = useState("B");
  const [data, setData] = useState<AllInteractionsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [drawingIdx, setDrawingIdx] = useState<number | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "all_interactions",
      params: { chain1, chain2 },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法运行互作分析。`
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
      toast(`互作分析失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain1, chain2, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusInteraction = async (interaction: Interaction, idx: number) => {
    if (!viewer) return;
    if (drawingIdx !== null) return;
    setDrawingIdx(idx);
    try {
      const plugin = viewer.plugin;
      const pdbText =
        activeStructure?.pdbText ??
        (activeId ? structureFileCache[activeId]?.content : undefined) ??
        "";

      const coord1 = findAtomCoord(pdbText, {
        chain: interaction.chain1,
        resno: interaction.resno1,
        resname: interaction.resname1,
        atomName: interaction.atom1,
      });
      const coord2 = findAtomCoord(pdbText, {
        chain: interaction.chain2,
        resno: interaction.resno2,
        resname: interaction.resname2,
        atomName: interaction.atom2,
      });

      clearInteractionState(plugin);
      clearInteractionLines();
      clearMeasurements();
      await showAtomsForInteraction(plugin);
      // await showResidueSidechain(plugin, { chain: interaction.chain1, resno: interaction.resno1 });
      // await showResidueSidechain(plugin, { chain: interaction.chain2, resno: interaction.resno2 });

      if (coord1 && coord2) {
        const meta = TYPE_META[interaction.type];
        setInteractionLines([
          {
            from: { ...coord1, label: `${interaction.resname1}${interaction.resno1}(${interaction.chain1})/${interaction.atom1}` },
            to: { ...coord2, label: `${interaction.resname2}${interaction.resno2}(${interaction.chain2})/${interaction.atom2}` },
            color: meta.color,
            label: `${interaction.distance_A.toFixed(2)} Å`,
            dashed: true,
          },
        ]);
      }

      plugin.canvas3d?.requestDraw?.();

      toast(`聚焦 ${interaction.resname1}${interaction.resno1} ↔ ${interaction.resname2}${interaction.resno2}`, "info");
    } catch (err) {
      console.error("[handleFocusInteraction] failed:", err);
      toast("聚焦失败", "error");
    } finally {
      setDrawingIdx(null);
    }
  };

  const filteredInteractions = data?.interactions?.filter(
    (i) => filter === "all" || i.type === filter
  ) ?? [];

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">互作网络</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total} 个
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={fetchData} disabled={loading} title="重新分析">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-1.5">
          <div>
            <Label className="text-[9px] text-muted-foreground">链 1</Label>
            <Input value={chain1} onChange={(e) => setChain1(e.target.value.toUpperCase())} className="h-7 text-xs font-mono" maxLength={2} />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">链 2</Label>
            <Input value={chain2} onChange={(e) => setChain2(e.target.value.toUpperCase())} className="h-7 text-xs font-mono" maxLength={2} />
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
            加载一个结构以分析互作
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Filter tabs */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilter("all")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  filter === "all" ? "bg-primary text-primary-foreground" : "bg-muted/60 text-muted-foreground hover:bg-muted"
                }`}
              >
                全部 ({data.total})
              </button>
              <button
                onClick={() => setFilter("salt_bridge")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-0.5 ${
                  filter === "salt_bridge" ? "bg-amber-500 text-white" : "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20"
                }`}
              >
                <Zap className="h-2.5 w-2.5" /> 盐桥 ({data.salt_bridges})
              </button>
              <button
                onClick={() => setFilter("hbond")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-0.5 ${
                  filter === "hbond" ? "bg-sky-500 text-white" : "bg-sky-500/10 text-sky-700 hover:bg-sky-500/20"
                }`}
              >
                <Link2 className="h-2.5 w-2.5" /> 氢键 ({data.hbonds})
              </button>
              <button
                onClick={() => setFilter("hydrophobic")}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors flex items-center gap-0.5 ${
                  filter === "hydrophobic" ? "bg-emerald-500 text-white" : "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20"
                }`}
              >
                <Droplets className="h-2.5 w-2.5" /> 疏水 ({data.hydrophobic})
              </button>
            </div>

            {/* Interaction list */}
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                互作列表 (点击聚焦并画线)
              </div>
              <div className="max-h-56 overflow-y-auto scrollbar-thin space-y-1">
                {filteredInteractions.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                    当前筛选无互作
                  </div>
                ) : (
                  filteredInteractions.map((interaction, i) => {
                    const meta = TYPE_META[interaction.type];
                    return (
                      <div
                        key={i}
                        className="rounded-md border bg-background p-1.5 transition hover:border-primary/50"
                      >
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFocusInteraction(interaction, i); }}
                            disabled={drawingIdx !== null}
                            className="flex flex-1 min-w-0 items-center gap-1.5 text-left hover:bg-accent/30 rounded px-0.5 disabled:opacity-50"
                            title="聚焦并画线"
                          >
                            <span className="shrink-0" style={{ color: meta.color }}>{meta.icon}</span>
                            <span className="font-mono font-semibold truncate">
                              {interaction.resname1}{interaction.resno1}({interaction.chain1})
                            </span>
                            <span className="text-muted-foreground">↔</span>
                            <span className="font-mono font-semibold truncate">
                              {interaction.resname2}{interaction.resno2}({interaction.chain2})
                            </span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleFocusInteraction(interaction, i); }}
                            disabled={drawingIdx !== null}
                            className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 disabled:opacity-50 transition-colors"
                            title="聚焦并绘制距离线"
                          >
                            {drawingIdx === i ? (
                              <RefreshCw className="h-2.5 w-2.5 animate-spin" />
                            ) : (
                              <span className="flex items-center gap-0.5">
                                <Ruler className="h-2.5 w-2.5" />
                                画线
                              </span>
                            )}
                          </button>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 pl-5 text-[9px]">
                          <Badge variant="outline" className="font-mono text-[9px]" style={{ backgroundColor: meta.color + "10", color: meta.color, borderColor: meta.color + "40" }}>
                            {meta.label}
                          </Badge>
                          <Badge variant="outline" className="font-mono text-[9px]">
                            {interaction.atom1}↔{interaction.atom2}: {interaction.distance_A.toFixed(2)}Å
                          </Badge>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                互作类型：盐桥 (ARG/LYS/HIS ↔ ASP/GLU, &lt;4.0Å)、氢键 (供体-受体, &lt;3.5Å)、疏水 (疏水残基C-C, &lt;4.5Å)。点击列表项聚焦并绘制距离线。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
