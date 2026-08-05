"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Droplets, RefreshCw, Loader2, Info } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";

interface WaterBridge {
  water_resno: number;
  res1: string; // "ASP30(A)"
  atom1: string;
  dist1_A: number;
  res2: string;
  atom2: string;
  dist2_A: number;
  total_path_A: number;
}

interface WaterBridgeData {
  total_water_bridges: number;
  bridges: WaterBridge[];
  note?: string;
}

export function WaterBridgesChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [chain1, setChain1] = useState("A");
  const [chain2, setChain2] = useState("B");
  const [cutoff, setCutoff] = useState(3.5);
  const [data, setData] = useState<WaterBridgeData | null>(null);
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
      recipe: "water_bridges",
      params: { chain1, chain2, cutoff },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法分析水桥。请上传本地 .pdb/.cif 文件后再试。`
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
      toast(`水桥分析失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain1, chain2, cutoff, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusBridge = async (bridge: WaterBridge) => {
    if (!viewer) return;
    try {
      // Focus on the water molecule
      await executeCommand(viewer, {
        type: "focus_residue",
        compId: "HOH",
        resno: bridge.water_resno,
      });
      toast(`聚焦水分子 HOH${bridge.water_resno}`, "info");
    } catch {
      toast("聚焦失败", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Droplets className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">水桥</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_water_bridges} 个
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
        {/* Chain + cutoff inputs */}
        <div className="grid grid-cols-3 gap-1.5">
          <div>
            <Label className="text-[9px] text-muted-foreground">链 1</Label>
            <Input
              value={chain1}
              onChange={(e) => setChain1(e.target.value.toUpperCase())}
              className="h-7 text-xs font-mono"
              maxLength={2}
            />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">链 2</Label>
            <Input
              value={chain2}
              onChange={(e) => setChain2(e.target.value.toUpperCase())}
              className="h-7 text-xs font-mono"
              maxLength={2}
            />
          </div>
          <div>
            <Label className="text-[9px] text-muted-foreground">截断 (Å)</Label>
            <Input
              type="number"
              value={cutoff}
              onChange={(e) => setCutoff(Number(e.target.value))}
              step={0.1}
              min={2.5}
              max={5}
              className="h-7 text-xs font-mono"
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
            加载一个结构以分析水桥
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {(data.total_water_bridges ?? 0) === 0 || !data.bridges ? (
              <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                <Droplets className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
                {data.note || "未检测到水桥"}
                <div className="mt-0.5 text-[9px]">
                  (此结构可能不含水分子或两条链间无水桥)
                </div>
              </div>
            ) : (
              <>
                {/* Summary card */}
                <div className="rounded-md border bg-sky-500/5 p-2 text-center">
                  <div className="text-[9px] uppercase text-muted-foreground">
                    检测到的水桥
                  </div>
                  <div className="font-mono text-base font-bold text-sky-600">
                    {data.total_water_bridges}
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    蛋白-水-蛋白 氢键网络
                  </div>
                </div>

                {/* Bridge list */}
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    水桥列表 (点击聚焦水分子)
                  </div>
                  <div className="max-h-48 overflow-y-auto scrollbar-thin space-y-1">
                    {data.bridges.map((bridge, i) => (
                      <button
                        key={i}
                        onClick={() => handleFocusBridge(bridge)}
                        className="w-full rounded-md border bg-background p-1.5 text-left transition hover:border-primary/50 hover:bg-accent/30"
                      >
                        <div className="flex items-center gap-1.5 text-[10px]">
                          <Droplets className="h-3 w-3 shrink-0 text-sky-500" />
                          <span className="font-mono text-sky-700">
                            HOH{bridge.water_resno}
                          </span>
                          <span className="text-muted-foreground">↔</span>
                          <span className="font-mono font-semibold">{bridge.res1}</span>
                          <span className="text-muted-foreground">+</span>
                          <span className="font-mono font-semibold">{bridge.res2}</span>
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 pl-5 text-[9px] text-muted-foreground">
                          <span>{bridge.atom1}↔O: {bridge.dist1_A.toFixed(1)}Å</span>
                          <span>+</span>
                          <span>{bridge.atom2}↔O: {bridge.dist2_A.toFixed(1)}Å</span>
                          <Badge variant="outline" className="ml-auto font-mono">
                            总 {bridge.total_path_A.toFixed(1)}Å
                          </Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <div>
                    水桥是蛋白-水-蛋白氢键网络,介导远距离的链间相互作用。截断距离默认 3.5 Å (水-极性原子)。
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
