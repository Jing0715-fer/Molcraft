"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Zap, RefreshCw, Loader2, Info } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";

interface ElectrostaticResidue {
  chain: string;
  resno: number;
  resname: string;
  charge: number;
  coulomb_energy_kcal: number;
  n_partners: number;
}

interface ElectrostaticData {
  total_charged_residues: number;
  positive: number;
  negative: number;
  neutral: number;
  total_coulomb_energy_kcal: number;
  top_residues: ElectrostaticResidue[];
  all_residues: ElectrostaticResidue[];
}

export function ElectrostaticChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [chain, setChain] = useState("");
  const [data, setData] = useState<ElectrostaticData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);
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
      recipe: "electrostatic",
      params: { chain },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法分析静电势。请上传本地 .pdb/.cif 文件后再试。`
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
      toast(`静电势分析失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Draw energy bar chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const top = data.top_residues.slice(0, 15);
    if (top.length === 0) return;

    const maxAbs = Math.max(...top.map((r) => Math.abs(r.coulomb_energy_kcal)), 1);
    const w = 320;
    const headerH = 20;
    const rowH = 14;
    const margin = 40;
    const h = headerH + top.length * rowH + 10;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, w, h);

    // Zero line position
    const zeroX = margin + (w - margin - 60) / 2;
    const barMaxW = (w - margin - 60) / 2;

    // Header
    ctx.fillStyle = "#6b7280";
    ctx.font = "8px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("← 稳定 (负) | 库仑能 (kcal/mol) | 不稳定 (正) →", w / 2, 12);

    // Zero line
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(zeroX, headerH);
    ctx.lineTo(zeroX, h - 5);
    ctx.stroke();

    // Bars
    top.forEach((res, i) => {
      const y = headerH + i * rowH;
      const isHovered = hoveredBar === i;
      const energy = res.coulomb_energy_kcal;
      const barW = (Math.abs(energy) / maxAbs) * barMaxW;
      const color = energy < 0 ? "#10b981" : "#ef4444"; // green=stabilizing, red=destabilizing

      // Label
      ctx.fillStyle = "#374151";
      ctx.font = isHovered ? "bold 9px ui-monospace, monospace" : "9px ui-monospace, monospace";
      ctx.textAlign = "right";
      ctx.fillText(`${res.resname}${res.resno}`, margin - 4, y + 9);

      // Bar
      ctx.fillStyle = color + (isHovered ? "ff" : "aa");
      if (energy < 0) {
        // Stabilizing: bar extends left from zero
        ctx.fillRect(zeroX - barW, y + 2, barW, rowH - 5);
      } else {
        // Destabilizing: bar extends right from zero
        ctx.fillRect(zeroX, y + 2, barW, rowH - 5);
      }

      // Value
      ctx.fillStyle = isHovered ? "#111827" : "#6b7280";
      ctx.font = isHovered ? "bold 8px ui-monospace, monospace" : "8px ui-monospace, monospace";
      ctx.textAlign = "left";
      ctx.fillText(energy.toFixed(1), w - 50, y + 9);
    });
  }, [data, hoveredBar]);

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const rect = canvas.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const headerH = 20;
    const rowH = 14;
    const idx = Math.floor((y - headerH) / rowH);
    if (idx >= 0 && idx < Math.min(data.top_residues.length, 15)) {
      setHoveredBar(idx);
    } else {
      setHoveredBar(null);
    }
  };

  const handleFocusResidue = async (residue: ElectrostaticResidue) => {
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
          <Zap className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">静电势</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_charged_residues} 残基
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
        {/* Chain filter */}
        <div className="flex items-center gap-2">
          <Label className="text-[10px] text-muted-foreground">链 (空=全部)</Label>
          <Input
            value={chain}
            onChange={(e) => setChain(e.target.value.toUpperCase())}
            placeholder="A"
            maxLength={2}
            className="h-7 w-16 text-xs font-mono"
          />
        </div>

        {loading && <Skeleton className="h-40 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            加载一个结构以分析静电势
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Total energy card */}
            <div
              className={`rounded-md border p-2 text-center ${
                data.total_coulomb_energy_kcal < 0
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-red-500/40 bg-red-500/5"
              }`}
            >
              <div className="text-[9px] uppercase text-muted-foreground">总库仑能</div>
              <div
                className={`font-mono text-base font-bold ${
                  data.total_coulomb_energy_kcal < 0 ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {data.total_coulomb_energy_kcal.toFixed(1)} kcal/mol
              </div>
              <div className="text-[9px] text-muted-foreground">
                {data.total_coulomb_energy_kcal < 0 ? "净稳定" : "净不稳定"}
              </div>
            </div>

            {/* Charge summary cards */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md border bg-blue-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">正电荷</div>
                <div className="font-mono text-base font-bold text-blue-600">
                  {data.positive}
                </div>
              </div>
              <div className="rounded-md border bg-emerald-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">中性</div>
                <div className="font-mono text-base font-bold text-emerald-600">
                  {data.neutral}
                </div>
              </div>
              <div className="rounded-md border bg-red-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">负电荷</div>
                <div className="font-mono text-base font-bold text-red-600">
                  {data.negative}
                </div>
              </div>
            </div>

            {/* Energy bar chart */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                残基库仑能 (按绝对值排序, 前 15)
              </div>
              <div className="flex justify-center overflow-x-auto scrollbar-thin">
                <canvas
                  ref={canvasRef}
                  onMouseMove={handleCanvasMove}
                  onMouseLeave={() => setHoveredBar(null)}
                  onClick={() => {
                    if (hoveredBar !== null && data) {
                      handleFocusResidue(data.top_residues[hoveredBar]);
                    }
                  }}
                  className="cursor-pointer rounded-md border bg-white shadow-sm"
                />
              </div>
            </div>

            {/* Top residues list */}
            <div className="space-y-0.5">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                关键残基 (点击聚焦)
              </div>
              <div className="max-h-32 overflow-y-auto scrollbar-thin space-y-0.5">
                {data.top_residues.slice(0, 10).map((residue, i) => (
                  <button
                    key={i}
                    onClick={() => handleFocusResidue(residue)}
                    className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition hover:bg-accent/30"
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        residue.charge > 0
                          ? "bg-blue-500"
                          : residue.charge < 0
                          ? "bg-red-500"
                          : "bg-muted-foreground"
                      }`}
                    />
                    <span className="font-mono text-[10px] font-medium">
                      {residue.resname}{residue.resno}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      ({residue.chain})
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {residue.n_partners} 互作
                    </span>
                    <Badge
                      variant="outline"
                      className={`ml-auto font-mono text-[9px] ${
                        residue.coulomb_energy_kcal < 0
                          ? "border-emerald-500/40 text-emerald-600"
                          : "border-red-500/40 text-red-600"
                      }`}
                    >
                      {residue.coulomb_energy_kcal > 0 ? "+" : ""}
                      {residue.coulomb_energy_kcal.toFixed(1)}
                    </Badge>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                库仑相互作用能 E = 332·q₁·q₂/d (kcal/mol)。负值=稳定 (盐桥/吸引),正值=不稳定 (电荷排斥)。6Å 截断,简化无介电衰减。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
