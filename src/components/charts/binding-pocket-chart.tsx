"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Target, RefreshCw, Loader2, Info } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";

interface PocketResidue {
  chain: string;
  resno: number;
  resname: string;
  min_dist_A: number;
  atom_count: number;
  category: string;
}

interface BindingPocketData {
  ligand: string;
  radius_A: number;
  pocket_residue_count: number;
  estimated_volume_A3: number;
  composition: Record<string, number>;
  residues: PocketResidue[];
}

const CATEGORY_META: Record<string, { label: string; color: string }> = {
  hydrophobic: { label: "疏水性", color: "#f59e0b" },
  polar: { label: "极性", color: "#06b6d4" },
  positive: { label: "正电荷", color: "#3b82f6" },
  negative: { label: "负电荷", color: "#ef4444" },
  glycine: { label: "甘氨酸", color: "#9ca3af" },
  other: { label: "其他", color: "#8b5cf6" },
};

export function BindingPocketChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [ligandCompId, setLigandCompId] = useState("REA");
  const [radius, setRadius] = useState(8);
  const [data, setData] = useState<BindingPocketData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableLigands, setAvailableLigands] = useState<string[] | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "binding_pocket",
      params: { ligandCompId: ligandCompId.toUpperCase(), radius },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法分析结合口袋。请上传本地 .pdb/.cif 文件后再试。`
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
          if (json.data.available) {
            setAvailableLigands(json.data.available);
          }
          setData(null);
        } else {
          setData(json.data);
          setAvailableLigands(null);
        }
      } else {
        setError(json.stderr || "无数据返回");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`结合口袋分析失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, ligandCompId, radius, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleFocusResidue = async (residue: PocketResidue) => {
    if (!viewer) return;
    try {
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: residue.chain,
        resno: residue.resno,
        compId: residue.resname,
      });
      toast(`聚焦 ${residue.resname}${residue.resno} (${residue.chain})`, "info");
    } catch {
      toast("聚焦失败", "error");
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Target className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">结合口袋</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.pocket_residue_count} 残基
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
        {/* Inputs */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">配体 (3-letter)</Label>
            <Input
              value={ligandCompId}
              onChange={(e) => setLigandCompId(e.target.value.toUpperCase())}
              placeholder="REA"
              className="h-8 text-sm font-mono"
              maxLength={6}
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">口袋半径 (Å)</Label>
            <Input
              type="number"
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              step={0.5}
              min={3}
              max={15}
              className="h-8 text-sm font-mono"
            />
          </div>
        </div>

        {loading && <Skeleton className="h-32 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
            {availableLigands && availableLigands.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                <span className="text-[9px] text-muted-foreground">可用配体:</span>
                {availableLigands.slice(0, 8).map((lig) => (
                  <button
                    key={lig}
                    onClick={() => setLigandCompId(lig)}
                    className="rounded bg-muted px-1.5 py-0 font-mono text-[9px] hover:bg-accent"
                  >
                    {lig}
                  </button>
                ))}
                {availableLigands.length > 8 && (
                  <span className="text-[9px] text-muted-foreground">
                    +{availableLigands.length - 8}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            加载一个结构以分析结合口袋
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Summary cards */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-md border bg-primary/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">口袋残基</div>
                <div className="font-mono text-base font-bold text-primary">
                  {data.pocket_residue_count}
                </div>
              </div>
              <div className="rounded-md border bg-amber-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">估算体积</div>
                <div className="font-mono text-base font-bold text-amber-600">
                  {data.estimated_volume_A3.toLocaleString("en-US", { maximumFractionDigits: 0 })} Å³
                </div>
              </div>
            </div>

            {/* Composition bar */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                残基组成
              </div>
              <div className="flex h-5 overflow-hidden rounded border">
                {Object.entries(data.composition).map(([cat, count]) => {
                  const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
                  const pct = data.pocket_residue_count > 0 ? (count / data.pocket_residue_count) * 100 : 0;
                  if (pct === 0) return null;
                  return (
                    <div
                      key={cat}
                      className="flex items-center justify-center text-[8px] font-bold text-white"
                      style={{ width: `${pct}%`, backgroundColor: meta.color }}
                      title={`${meta.label}: ${count} (${pct.toFixed(0)}%)`}
                    >
                      {pct >= 12 ? count : ""}
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5">
                {Object.entries(data.composition)
                  .filter(([, count]) => count > 0)
                  .map(([cat, count]) => {
                    const meta = CATEGORY_META[cat] ?? CATEGORY_META.other;
                    return (
                      <div key={cat} className="flex items-center gap-1 text-[9px]">
                        <span
                          className="h-2 w-2 rounded-sm"
                          style={{ backgroundColor: meta.color }}
                        />
                        <span className="text-muted-foreground">{meta.label}</span>
                        <span className="font-mono">{count}</span>
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* Residue list */}
            <div className="space-y-1">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                口袋残基 (点击聚焦, 按距离排序)
              </div>
              <div className="max-h-44 overflow-y-auto scrollbar-thin space-y-0.5">
                {data.residues.map((residue, i) => {
                  const meta = CATEGORY_META[residue.category] ?? CATEGORY_META.other;
                  return (
                    <button
                      key={i}
                      onClick={() => handleFocusResidue(residue)}
                      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-accent/30"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: meta.color }}
                        title={meta.label}
                      />
                      <span className="font-mono text-[10px] font-medium">
                        {residue.resname}{residue.resno}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        ({residue.chain})
                      </span>
                      <span className="text-[9px]" style={{ color: meta.color }}>
                        {meta.label}
                      </span>
                      <Badge variant="outline" className="ml-auto font-mono text-[9px]">
                        {residue.min_dist_A.toFixed(1)} Å
                      </Badge>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                配体周围 {data.radius_A} Å 范围内的蛋白残基。疏水性残基稳定配体非极性部分,极性/电荷残基形成氢键和盐桥。口袋体积为估算值。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
