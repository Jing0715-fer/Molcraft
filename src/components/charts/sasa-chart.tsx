"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CircleDashed, RefreshCw, Loader2, Info, Download } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";

interface SasaData {
  total_sasa_A2: number;
  chain_sasa_A2: Record<string, number>;
  n_chains: number;
}

// Color palette for chain bars
const CHAIN_COLORS = [
  "#10b981", // emerald (primary)
  "#3b82f6", // blue
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

export function SasaChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const [data, setData] = useState<SasaData | null>(null);
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
      recipe: "sasa",
      params: {},
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法运行 SASA 分析。请上传本地 .pdb/.cif 文件后再试。`
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
      toast(`SASA 加载失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Draw horizontal bar chart of per-chain SASA
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const chains = Object.entries(data.chain_sasa_A2).sort((a, b) => b[1] - a[1]);
    if (chains.length === 0) return;

    const maxSasa = Math.max(...chains.map(([, v]) => v), 1);
    const w = 320;
    const rowH = 22;
    const headerH = 18;
    const margin = 36;
    const h = headerH + chains.length * rowH + 10;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, w, h);

    // Header
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px ui-sans-serif, system-ui";
    ctx.textAlign = "left";
    ctx.fillText("链", margin, 12);
    ctx.textAlign = "right";
    ctx.fillText("SASA (Å²)", w - 8, 12);

    // Bars
    chains.forEach(([chain, sasa], i) => {
      const y = headerH + i * rowH;
      const color = CHAIN_COLORS[i % CHAIN_COLORS.length];
      const barW = ((sasa / maxSasa) * (w - margin - 70));

      // Chain label
      ctx.fillStyle = "#374151";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(chain, margin, y + 13);

      // Bar background
      ctx.fillStyle = color + "20";
      ctx.fillRect(margin + 18, y + 3, w - margin - 88, rowH - 8);

      // Bar fill
      ctx.fillStyle = color;
      ctx.fillRect(margin + 18, y + 3, Math.max(barW, 2), rowH - 8);

      // Value label
      ctx.fillStyle = "#1f2937";
      ctx.font = "9px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(sasa.toFixed(0), w - 8, y + 13);
    });
  }, [data]);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <CircleDashed className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">SASA</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.n_chains} 链
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
            加载一个结构以查看 SASA 分布
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Total SASA card */}
            <div className="rounded-md border bg-primary/5 p-2 text-center">
              <div className="text-[9px] uppercase text-muted-foreground">
                总溶剂可及表面积
              </div>
              <div className="font-mono text-lg font-bold text-primary">
                {data.total_sasa_A2.toLocaleString("en-US", { maximumFractionDigits: 0 })} Å²
              </div>
              <div className="text-[9px] text-muted-foreground">
                {data.n_chains} 条链
              </div>
            </div>

            {/* Per-chain bar chart */}
            <div className="flex justify-center overflow-x-auto scrollbar-thin">
              <canvas ref={canvasRef} className="rounded-md border bg-white shadow-sm" />
            </div>

            {/* Per-chain table */}
            <div className="space-y-0.5">
              {Object.entries(data.chain_sasa_A2)
                .sort((a, b) => b[1] - a[1])
                .map(([chain, sasa], i) => {
                  const maxSasa = Math.max(...Object.values(data.chain_sasa_A2));
                  const pct = (sasa / maxSasa) * 100;
                  return (
                    <div key={chain} className="flex items-center gap-2 text-[10px]">
                      <span className="w-6 font-mono font-medium">{chain}</span>
                      <div className="relative h-3 flex-1 overflow-hidden rounded bg-muted">
                        <div
                          className="absolute inset-y-0 left-0 rounded"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: CHAIN_COLORS[i % CHAIN_COLORS.length],
                          }}
                        />
                      </div>
                      <span className="w-14 text-right font-mono">
                        {sasa.toFixed(1)} Å²
                      </span>
                      <span className="w-10 text-right text-muted-foreground">
                        {((sasa / data.total_sasa_A2) * 100).toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                SASA 反映残基暴露于溶剂的程度。高 SASA 残基位于表面（药物结合候选位点），低 SASA 残基位于核心（稳定性关键）。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
