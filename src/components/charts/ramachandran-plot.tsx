"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, RefreshCw, Loader2, Info, Download } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore, selectActiveStructure } from "@/lib/store";

interface RamachandranPoint {
  chain: string;
  resno: number;
  resname: string;
  phi: number;
  psi: number;
  region: string;
}

interface RamachandranData {
  total_residues: number;
  regions: Record<string, number>;
  favoured_pct: number;
  outlier_pct: number;
  data: RamachandranPoint[];
}

const REGION_COLORS: Record<string, string> = {
  favoured: "#10b981", // emerald
  allowed: "#f59e0b", // amber
  outlier: "#ef4444", // red
  gly: "#3b82f6", // blue
  pro: "#8b5cf6", // violet
  pre_pro: "#ec4899", // pink
};

const REGION_LABELS: Record<string, string> = {
  favoured: "偏好区",
  allowed: "允许区",
  outlier: "异常区",
  gly: "Gly",
  pro: "Pro",
  pre_pro: "Pre-Pro",
};

// Approximate Ramachandran favoured region polygons (for background shading)
const FAVOURED_REGIONS: Array<Array<[number, number]>> = [
  // Alpha-helix region
  [
    [-150, -90],
    [-30, -90],
    [-30, 45],
    [-150, 45],
  ],
  // Beta-sheet region
  [
    [-180, 90],
    [-30, 90],
    [-30, 180],
    [-180, 180],
  ],
];

const ALLOWED_REGIONS: Array<Array<[number, number]>> = [
  // Extended alpha region
  [
    [-180, -120],
    [-30, -120],
    [-30, 90],
    [-180, 90],
  ],
];

export function RamachandranPlot() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [data, setData] = useState<RamachandranData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredPoint, setHoveredPoint] = useState<RamachandranPoint | null>(null);
  const [visibleRegions, setVisibleRegions] = useState<Set<string>>(
    new Set(["favoured", "allowed", "outlier", "gly", "pro", "pre_pro"])
  );
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 320, h: 320 });

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    // For PDB IDs, use the pdbId path. For uploaded files / AlphaFold, fall back
    // to fileContent (if cached). If neither is possible, show a helpful error.
    const body: Record<string, unknown> = {
      recipe: "ramachandran",
      params: {},
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法运行 Ramachandran 分析。请上传本地 .pdb/.cif 文件后再试。`
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
      toast(`Ramachandran 加载失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Resize observer for responsive canvas
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.min(entries[0].contentRect.width, 360);
      setCanvasSize({ w, h: w });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draw the plot
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { w, h } = canvasSize;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const margin = 28;
    const plotW = w - margin * 2;
    const plotH = h - margin * 2;
    const xScale = (phi: number) => margin + ((phi + 180) / 360) * plotW;
    const yScale = (psi: number) => h - margin - ((psi + 180) / 360) * plotH;

    // Clear
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, w, h);

    // Draw region shading
    const drawPolygon = (polygon: Array<[number, number]>, fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      polygon.forEach(([phi, psi], i) => {
        const x = xScale(phi);
        const y = yScale(psi);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fill();
    };

    if (visibleRegions.has("favoured")) {
      FAVOURED_REGIONS.forEach((poly) => drawPolygon(poly, "rgba(16,185,129,0.18)"));
    }
    if (visibleRegions.has("allowed")) {
      ALLOWED_REGIONS.forEach((poly) => drawPolygon(poly, "rgba(245,158,11,0.10)"));
    }

    // Draw grid lines
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 0.5;
    for (let v = -180; v <= 180; v += 60) {
      ctx.beginPath();
      ctx.moveTo(xScale(v), margin);
      ctx.lineTo(xScale(v), h - margin);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(margin, yScale(v));
      ctx.lineTo(w - margin, yScale(v));
      ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin, yScale(0));
    ctx.lineTo(w - margin, yScale(0));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(xScale(0), margin);
    ctx.lineTo(xScale(0), h - margin);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = "#6b7280";
    ctx.font = "9px ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillText("φ (°)", w / 2, h - 6);
    ctx.save();
    ctx.translate(8, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ψ (°)", 0, 0);
    ctx.restore();

    // Tick labels
    ctx.textAlign = "right";
    ctx.font = "8px ui-monospace, monospace";
    for (let v = -180; v <= 180; v += 90) {
      if (v === 0) continue;
      ctx.fillText(String(v), margin - 2, yScale(v) + 3);
    }
    ctx.textAlign = "center";
    for (let v = -180; v <= 180; v += 90) {
      if (v === 0) continue;
      ctx.fillText(String(v), xScale(v), h - margin + 10);
    }

    // Draw points
    const points = data.data || [];
    for (const p of points) {
      if (!visibleRegions.has(p.region)) continue;
      const x = xScale(p.phi);
      const y = yScale(p.psi);
      ctx.fillStyle = REGION_COLORS[p.region] ?? "#999";
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.arc(x, y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Highlight hovered point
    if (hoveredPoint) {
      const x = xScale(hoveredPoint.phi);
      const y = yScale(hoveredPoint.psi);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [data, canvasSize, hoveredPoint, visibleRegions]);

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!data || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const { w, h } = canvasSize;
    const margin = 28;
    const plotW = w - margin * 2;
    const plotH = h - margin * 2;
    const phi = ((x - margin) / plotW) * 360 - 180;
    const psi = -(((y - margin) / plotH) * 360 - 180);
    // Find nearest point
    let nearest: RamachandranPoint | null = null;
    let minDist = 10;
    for (const p of data.data) {
      const dx = p.phi - phi;
      const dy = p.psi - psi;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    setHoveredPoint(nearest);
  };

  const handleCanvasClick = async () => {
    if (!hoveredPoint || !viewer) return;
    // Focus the residue in the viewer
    try {
      const { executeCommand } = await import("@/lib/molstar/commands");
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: hoveredPoint.chain,
        resno: hoveredPoint.resno,
      });
      toast(`聚焦 ${hoveredPoint.resname}${hoveredPoint.resno} (${hoveredPoint.chain})`, "info");
    } catch (err) {
      toast(`聚焦失败`, "error");
    }
  };

  const toggleRegion = (region: string) => {
    setVisibleRegions((prev) => {
      const next = new Set(prev);
      if (next.has(region)) next.delete(region);
      else next.add(region);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <div className="flex min-w-0 items-center gap-2">
          <Activity className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">Ramachandran</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchData}
            disabled={loading}
            title="重新加载数据"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {data && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const canvas = canvasRef.current;
                if (!canvas) return;
                const link = document.createElement("a");
                link.download = `ramachandran-${activeId ?? "plot"}.png`;
                link.href = canvas.toDataURL("image/png");
                link.click();
              }}
              title="导出 PNG"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin p-3">
        {loading && (
          <div className="space-y-3">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            加载一个结构以查看 Ramachandran 图
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-3">
            {/* Canvas plot */}
            <div ref={containerRef} className="flex justify-center">
              <canvas
                ref={canvasRef}
                onMouseMove={handleCanvasMove}
                onMouseLeave={() => setHoveredPoint(null)}
                onClick={handleCanvasClick}
                className="cursor-crosshair rounded-md border bg-white shadow-sm"
                style={{ width: canvasSize.w, height: canvasSize.h }}
              />
            </div>

            {/* Hovered point info */}
            {hoveredPoint && (
              <div className="rounded-md border bg-accent/30 px-2.5 py-1.5 text-[10px]">
                <span className="font-mono font-medium">
                  {hoveredPoint.resname}
                  {hoveredPoint.resno} ({hoveredPoint.chain})
                </span>
                <span className="ml-2 text-muted-foreground">
                  φ: {hoveredPoint.phi.toFixed(1)}° · ψ: {hoveredPoint.psi.toFixed(1)}°
                </span>
                <span
                  className="ml-2 rounded px-1 py-0 text-[9px] font-medium"
                  style={{
                    backgroundColor: (REGION_COLORS[hoveredPoint.region] ?? "#999") + "30",
                    color: REGION_COLORS[hoveredPoint.region] ?? "#999",
                  }}
                >
                  {REGION_LABELS[hoveredPoint.region] ?? hoveredPoint.region}
                </span>
                <span className="ml-2 text-[9px] text-muted-foreground">
                  点击聚焦
                </span>
              </div>
            )}

            {/* Stats summary */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border bg-emerald-500/5 p-2.5">
                <div className="text-[9px] uppercase text-muted-foreground">
                  偏好区
                </div>
                <div className="font-mono text-lg font-bold text-emerald-600">
                  {data.favoured_pct}%
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {data.regions.favoured ?? 0} / {data.total_residues} 残基
                </div>
              </div>
              <div className="rounded-lg border bg-red-500/5 p-2.5">
                <div className="text-[9px] uppercase text-muted-foreground">
                  异常区
                </div>
                <div className="font-mono text-lg font-bold text-red-600">
                  {data.outlier_pct}%
                </div>
                <div className="text-[9px] text-muted-foreground">
                  {data.regions.outlier ?? 0} / {data.total_residues} 残基
                </div>
              </div>
            </div>

            {/* Region legend (toggleable) */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                区域分类 (点击切换显示)
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(REGION_LABELS).map(([key, label]) => {
                  const count = data.regions[key] ?? 0;
                  const visible = visibleRegions.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleRegion(key)}
                      className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] transition ${
                        visible ? "opacity-100" : "opacity-40"
                      }`}
                      style={{
                        backgroundColor: (REGION_COLORS[key] ?? "#999") + "20",
                      }}
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: REGION_COLORS[key] ?? "#999" }}
                      />
                      <span style={{ color: REGION_COLORS[key] ?? "#999" }}>
                        {label}
                      </span>
                      <span className="text-muted-foreground">{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                每个点代表一个残基的 φ/ψ 二面角。偏好区 &gt;90% 表示结构质量优秀。点击任意点可在查看器中聚焦该残基。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
