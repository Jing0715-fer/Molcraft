"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link2, RefreshCw, Loader2, Info } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";

interface DisulfideBond {
  chain1: string;
  resno1: number;
  chain2: string;
  resno2: number;
  distance_A: number;
}

interface DisulfideData {
  count: number;
  bonds: DisulfideBond[];
  cutoff: number;
}

export function DisulfideChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [data, setData] = useState<DisulfideData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cutoff, setCutoff] = useState(2.5);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "disulfide_bonds",
      params: { cutoff },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法检测二硫键。请上传本地 .pdb/.cif 文件后再试。`
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
      toast(`二硫键检测失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, cutoff, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusBond = async (bond: DisulfideBond) => {
    if (!viewer) return;
    try {
      // Focus the first CYS of the bond
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: bond.chain1,
        resno: bond.resno1,
        compId: "CYS",
      });
      toast(`聚焦 ${bond.chain1}:CYS${bond.resno1} ↔ ${bond.chain2}:CYS${bond.resno2}`, "info");
    } catch {
      toast("聚焦失败", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link2 className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">二硫键</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.count} 个
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchData}
            disabled={loading}
            title="重新检测"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {/* Cutoff input */}
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-muted-foreground">距离截断 (Å)</Label>
          <Input
            type="number"
            value={cutoff}
            onChange={(e) => setCutoff(Number(e.target.value))}
            step={0.1}
            min={1.5}
            max={3.5}
            className="h-7 w-20 text-xs font-mono"
          />
          <span className="text-[9px] text-muted-foreground">SG-SG</span>
        </div>

        {loading && <Skeleton className="h-24 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            加载一个结构以检测二硫键
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {data.count === 0 ? (
              <div className="rounded-md border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                <Link2 className="mx-auto mb-1 h-5 w-5 text-muted-foreground/40" />
                未检测到二硫键
                <div className="mt-0.5 text-[9px]">
                  (cutoff {data.cutoff} Å · 此蛋白可能不含 CYS-CYS 配对)
                </div>
              </div>
            ) : (
              <>
                {/* Summary card */}
                <div className="rounded-md border bg-amber-500/5 p-2 text-center">
                  <div className="text-[9px] uppercase text-muted-foreground">
                    检测到的二硫键
                  </div>
                  <div className="font-mono text-lg font-bold text-amber-600">
                    {data.count}
                  </div>
                </div>

                {/* Bond list */}
                <div className="space-y-1">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    键列表 (点击聚焦)
                  </div>
                  {data.bonds.map((bond, i) => (
                    <button
                      key={i}
                      onClick={() => handleFocusBond(bond)}
                      className="flex w-full items-center gap-2 rounded-md border bg-background p-1.5 text-left transition hover:border-primary/50 hover:bg-accent/30"
                    >
                      <div className="flex items-center gap-1 font-mono text-[10px]">
                        <span className="font-semibold text-amber-700">CYS</span>
                        <span>{bond.chain1}:{bond.resno1}</span>
                      </div>
                      <Link2 className="h-3 w-3 text-amber-600" />
                      <div className="flex items-center gap-1 font-mono text-[10px]">
                        <span className="font-semibold text-amber-700">CYS</span>
                        <span>{bond.chain2}:{bond.resno2}</span>
                      </div>
                      <Badge
                        variant="outline"
                        className="ml-auto font-mono text-[9px]"
                      >
                        {bond.distance_A.toFixed(2)} Å
                      </Badge>
                    </button>
                  ))}
                </div>

                <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
                  <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <div>
                    二硫键 (S-S) 是 CYS 残基间的共价交联，对蛋白稳定性至关重要。标准 SG-SG 距离约 2.05 Å，截断 2.5 Å。
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
