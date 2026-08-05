"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spline, RefreshCw, Loader2, Info } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";

interface SsData {
  total_residues: number;
  ss_counts: {
    alpha_helix: number;
    beta_sheet: number;
    coil: number;
    turn: number;
  };
  alpha_helix_pct: number;
  beta_sheet_pct: number;
  coil_pct: number;
  turn_pct: number;
  residues?: Array<{
    chain: string;
    resno: number;
    resname: string;
    phi: number;
    psi: number;
    ss: string;
  }>;
}

const SS_META: Record<string, { label: string; color: string; symbol: string }> = {
  alpha_helix: { label: "α-螺旋", color: "#10b981", symbol: "H" },
  beta_sheet: { label: "β-折叠", color: "#3b82f6", symbol: "E" },
  turn: { label: "转角", color: "#f59e0b", symbol: "T" },
  coil: { label: "无规卷曲", color: "#9ca3af", symbol: "C" },
};

export function SecondaryStructureChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const [data, setData] = useState<SsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chain, setChain] = useState("");
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
      recipe: "secondary_structure_simple",
      params: { chain },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法分析二级结构。请上传本地 .pdb/.cif 文件后再试。`
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
      toast(`二级结构分析失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Draw donut chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = 180;
    const h = 180;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    // Clear
    ctx.fillStyle = "#fafafa";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const outerR = 70;
    const innerR = 42;

    const segments = [
      { key: "alpha_helix", value: data.ss_counts.alpha_helix },
      { key: "beta_sheet", value: data.ss_counts.beta_sheet },
      { key: "turn", value: data.ss_counts.turn },
      { key: "coil", value: data.ss_counts.coil },
    ];
    const total = segments.reduce((s, seg) => s + seg.value, 0) || 1;

    let startAngle = -Math.PI / 2;
    for (const seg of segments) {
      if (seg.value === 0) continue;
      const angle = (seg.value / total) * Math.PI * 2;
      const endAngle = startAngle + angle;
      ctx.fillStyle = SS_META[seg.key].color;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, startAngle, endAngle);
      ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
      ctx.closePath();
      ctx.fill();
      startAngle = endAngle;
    }

    // Center text
    ctx.fillStyle = "#374151";
    ctx.font = "bold 16px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(data.total_residues), cx, cy - 4);
    ctx.font = "8px ui-sans-serif, system-ui";
    ctx.fillStyle = "#6b7280";
    ctx.fillText("残基", cx, cy + 10);
  }, [data]);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Spline className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">二级结构</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.total_residues} 残基
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

        {loading && <Skeleton className="h-48 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            加载一个结构以分析二级结构
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              {/* Donut chart */}
              <div className="flex justify-center">
                <canvas ref={canvasRef} className="rounded-md border bg-white shadow-sm" />
              </div>

              {/* Legend + percentages */}
              <div className="flex-1 space-y-1">
                {(["alpha_helix", "beta_sheet", "turn", "coil"] as const).map((key) => {
                  const meta = SS_META[key];
                  const count = data.ss_counts[key];
                  const pct = data[`${key}_pct`];
                  return (
                    <div key={key} className="flex items-center gap-1.5 text-[10px]">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: meta.color }}
                      />
                      <span className="flex-1">{meta.label}</span>
                      <span className="font-mono font-semibold" style={{ color: meta.color }}>
                        {pct}%
                      </span>
                      <span className="w-8 text-right text-muted-foreground">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Composition bar */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                组成比例
              </div>
              <div className="flex h-4 overflow-hidden rounded border">
                {(["alpha_helix", "beta_sheet", "turn", "coil"] as const).map((key) => {
                  const meta = SS_META[key];
                  const pct = data[`${key}_pct`];
                  if (pct === 0) return null;
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-center text-[8px] font-bold text-white"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: meta.color,
                      }}
                      title={`${meta.label}: ${pct}%`}
                    >
                      {pct >= 8 ? meta.symbol : ""}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                通过 φ/ψ 二面角推断二级结构。α-螺旋 (φ≈-60°, ψ≈-45°)，β-折叠 (φ≈-120°, ψ≈130°)。比例反映蛋白的整体折叠类型。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
