"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  RefreshCw,
  Loader2,
  Info,
  Download,
} from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";

interface ChainBfactor {
  chain: string;
  n_atoms: number;
  mean: number;
  min: number;
  max: number;
  std: number;
  histogram_bins: number[];
  histogram_bin_size: number;
  threshold_high_flex: number;
  high_flexibility_residues: Array<{ resno: number; resname: string; bfactor: number }>;
  is_plddt: boolean;
  per_residue_count: number;
}

interface BfactorData {
  chains: Record<string, ChainBfactor>;
  total_chains: number;
}

// Color scale for B-factor (blue → white → red)
function bfactorColor(b: number, min: number, max: number): string {
  if (max <= min) return "#6b7280";
  const t = (b - min) / (max - min);
  // Blue (low) → white (mid) → red (high)
  if (t < 0.5) {
    const r = Math.round(59 + (255 - 59) * t * 2);
    const g = Math.round(130 + (255 - 130) * t * 2);
    const b = Math.round(246 + (255 - 246) * t * 2);
    return `rgb(${r},${g},${b})`;
  }
  const t2 = (t - 0.5) * 2;
  const r = 255;
  const g = Math.round(255 - 255 * t2);
  const bl = Math.round(255 - 255 * t2);
  return `rgb(${r},${g},${bl})`;
}

export function BfactorChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const [data, setData] = useState<BfactorData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "bfactor_stats",
      params: {},
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法运行 B-factor 分析。请上传本地 .pdb/.cif 文件后再试。`
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
      toast(`B-factor 加载失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Draw histogram
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 320;
    const h = 120;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Use the first chain's histogram for display
    const firstChain = Object.values(data.chains)[0];
    if (!firstChain) return;
    const bins = firstChain.histogram_bins;
    const maxCount = Math.max(...bins, 1);
    const margin = 30;
    const plotW = w - margin * 2;
    const plotH = h - margin - 10;
    const barW = plotW / bins.length;

    // Clear
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, w, h);

    // Draw bars colored by B-factor range
    bins.forEach((count, i) => {
      const barH = (count / maxCount) * plotH;
      const x = margin + i * barW;
      const y = h - margin - barH;
      // Color by bin center B-factor
      const binCenter = firstChain.min + (i + 0.5) * firstChain.histogram_bin_size;
      ctx.fillStyle = bfactorColor(binCenter, firstChain.min, firstChain.max);
      ctx.fillRect(x + 1, y, barW - 2, barH);
    });

    // Axes
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, h - margin);
    ctx.lineTo(w - margin, h - margin);
    ctx.stroke();

    // Labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "8px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(firstChain.min.toFixed(0), margin, h - margin + 10);
    ctx.textAlign = "right";
    ctx.fillText(firstChain.max.toFixed(0), w - margin, h - margin + 10);
    ctx.textAlign = "center";
    ctx.fillText(
      firstChain.is_plddt ? "pLDDT" : "B-factor",
      w / 2,
      h - 2
    );
    ctx.textAlign = "left";
    ctx.fillText("count", 4, margin - 4);
  }, [data]);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <BarChart3 className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">B-factor</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_chains} 链
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchData}
            disabled={loading}
            title="重新加载"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {loading && <Skeleton className="h-32 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            加载一个 PDB 结构以查看 B-factor 分布
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Histogram */}
            <div className="flex justify-center">
              <canvas ref={canvasRef} className="rounded-md border bg-white shadow-sm" />
            </div>

            {/* Per-chain stats */}
            {Object.values(data.chains).map((c) => (
              <div key={c.chain} className="rounded-md border p-2">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-semibold">
                      链 {c.chain}
                    </span>
                    {c.is_plddt && (
                      <Badge
                        variant="outline"
                        className="px-1 py-0 text-[9px] text-violet-600"
                      >
                        pLDDT
                      </Badge>
                    )}
                  </div>
                  <span className="text-[9px] text-muted-foreground">
                    {c.per_residue_count} 残基
                  </span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-[10px]">
                  <div className="text-center">
                    <div className="text-[8px] uppercase text-muted-foreground">
                      均值
                    </div>
                    <div className="font-mono font-medium" style={{ color: bfactorColor(c.mean, c.min, c.max) }}>
                      {c.mean}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[8px] uppercase text-muted-foreground">
                      最小
                    </div>
                    <div className="font-mono font-medium text-blue-600">
                      {c.min}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[8px] uppercase text-muted-foreground">
                      最大
                    </div>
                    <div className="font-mono font-medium text-red-600">
                      {c.max}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-[8px] uppercase text-muted-foreground">
                      标准差
                    </div>
                    <div className="font-mono font-medium text-amber-600">
                      {c.std}
                    </div>
                  </div>
                </div>
                {/* High flexibility residues */}
                {c.high_flexibility_residues.length > 0 && (
                  <div className="mt-1.5 border-t pt-1">
                    <div className="text-[9px] text-muted-foreground">
                      高柔性残基 (B &gt; {c.threshold_high_flex}):
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-0.5">
                      {c.high_flexibility_residues.slice(0, 8).map((r) => (
                        <span
                          key={r.resno}
                          className="rounded px-1 py-0 font-mono text-[9px]"
                          style={{
                            backgroundColor: bfactorColor(r.bfactor, c.min, c.max) + "30",
                            color: bfactorColor(r.bfactor, c.min, c.max),
                          }}
                        >
                          {r.resname}
                          {r.resno}
                        </span>
                      ))}
                      {c.high_flexibility_residues.length > 8 && (
                        <span className="text-[9px] text-muted-foreground">
                          +{c.high_flexibility_residues.length - 8}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Color scale legend */}
            <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
              <span>低</span>
              <div
                className="h-2 flex-1 rounded"
                style={{
                  background:
                    "linear-gradient(to right, rgb(59,130,246), rgb(255,255,255), rgb(255,0,0))",
                }}
              />
              <span>高</span>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                B-factor 反映原子热运动不确定性（晶体学）或模型置信度（AlphaFold pLDDT）。高 B-factor 区域通常是柔性 loop 或低置信度区。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
