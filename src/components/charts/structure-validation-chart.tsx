"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, ShieldX, ShieldAlert, RefreshCw, Info } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";

interface ValidationIssue {
  type: string;
  count?: number;
  details?: Array<Record<string, unknown>>;
  residue?: string;
  atom1?: string;
  atom2?: string;
  distance_A?: number;
  phi?: number;
  psi?: number;
}

interface ValidationData {
  quality: "good" | "fair" | "poor";
  clash_count: number;
  rama_outlier_count: number;
  rama_outlier_pct: number;
  total_phi_psi: number;
  missing_sidechain_count: number;
  issues: ValidationIssue[];
}

const QUALITY_META: Record<string, { label: string; color: string; bg: string; icon: typeof ShieldCheck }> = {
  good: { label: "优秀", color: "#059669", bg: "#05966920", icon: ShieldCheck },
  fair: { label: "一般", color: "#f59e0b", bg: "#f59e0b20", icon: ShieldAlert },
  poor: { label: "较差", color: "#ef4444", bg: "#ef444420", icon: ShieldX },
};

export function StructureValidationChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const [data, setData] = useState<ValidationData | null>(null);
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
      recipe: "structure_validation",
      params: {},
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法运行结构验证。请上传本地 .pdb/.cif 文件后再试。`
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
        setData(json.data);
      } else {
        setError(json.stderr || "无数据返回");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`结构验证失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="rounded-lg border bg-card shadow-sm p-3">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border bg-card shadow-sm p-3 text-center text-xs text-muted-foreground">
        {!activeId ? "加载一个结构以运行质量验证" : "无数据"}
      </div>
    );
  }

  const quality = QUALITY_META[data.quality];
  const QualityIcon = quality.icon;

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      {/* Header with quality banner */}
      <div
        className="flex items-center gap-2 border-b px-3 py-2"
        style={{ background: `linear-gradient(90deg, ${quality.bg} 0%, transparent 100%)` }}
      >
        <QualityIcon className="h-4 w-4 shrink-0" style={{ color: quality.color }} />
        <span className="text-sm font-semibold">结构质量验证</span>
        {activeId && (
          <Badge variant="outline" className="truncate font-mono text-[9px]">
            {activeStructure?.label ?? activeId}
          </Badge>
        )}
        <Badge
          variant="outline"
          className="ml-auto px-2 py-0 text-[10px] font-semibold"
          style={{ color: quality.color, borderColor: quality.color + "60", backgroundColor: quality.bg }}
        >
          {quality.label}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={fetchData}
          disabled={loading}
          title="重新验证"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      <div className="space-y-3 p-3">
        {/* Quality summary banner */}
        <div
          className="rounded-md border p-2.5 text-center"
          style={{ borderColor: quality.color + "60", backgroundColor: quality.bg }}
        >
          <div className="text-[10px] uppercase text-muted-foreground">综合质量评分</div>
          <div className="flex items-center justify-center gap-1.5">
            <QualityIcon className="h-5 w-5" style={{ color: quality.color }} />
            <span className="text-lg font-bold" style={{ color: quality.color }}>
              {quality.label}
            </span>
          </div>
        </div>

        {/* Metric cards grid */}
        <div className="grid grid-cols-3 gap-1.5">
          {/* Clashes */}
          <div className={`rounded-md border p-2 text-center ${data.clash_count > 3 ? "border-red-500/40 bg-red-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
            <div className="text-[9px] uppercase text-muted-foreground">原子碰撞</div>
            <div className={`font-mono text-base font-bold ${data.clash_count > 3 ? "text-red-600" : "text-emerald-600"}`}>
              {data.clash_count}
            </div>
            <div className="text-[8px] text-muted-foreground">{"<1.5Å"}</div>
          </div>
          {/* Ramachandran outliers */}
          <div className={`rounded-md border p-2 text-center ${data.rama_outlier_pct > 5 ? "border-red-500/40 bg-red-500/5" : data.rama_outlier_pct > 2 ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
            <div className="text-[9px] uppercase text-muted-foreground">拉式异常</div>
            <div className={`font-mono text-base font-bold ${data.rama_outlier_pct > 5 ? "text-red-600" : data.rama_outlier_pct > 2 ? "text-amber-600" : "text-emerald-600"}`}>
              {data.rama_outlier_pct}%
            </div>
            <div className="text-[8px] text-muted-foreground">
              {data.rama_outlier_count}/{data.total_phi_psi}
            </div>
          </div>
          {/* Missing sidechains */}
          <div className={`rounded-md border p-2 text-center ${data.missing_sidechain_count > 1 ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
            <div className="text-[9px] uppercase text-muted-foreground">缺失侧链</div>
            <div className={`font-mono text-base font-bold ${data.missing_sidechain_count > 1 ? "text-amber-600" : "text-emerald-600"}`}>
              {data.missing_sidechain_count}
            </div>
            <div className="text-[8px] text-muted-foreground">残基</div>
          </div>
        </div>

        {/* Issues list (if any) */}
        {data.issues.length > 0 && (
          <div>
            <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              问题详情 ({data.issues.length})
            </div>
            <div className="max-h-40 overflow-y-auto scrollbar-thin space-y-0.5">
              {data.issues.slice(0, 15).map((issue, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] hover:bg-accent/20"
                >
                  {issue.type === "clashes" && issue.details ? (
                    <span className="text-red-700 font-medium">碰撞</span>
                  ) : issue.type === "rama_outlier" ? (
                    <span className="text-amber-700 font-medium">拉氏异常</span>
                  ) : issue.type === "missing_sidechain" ? (
                    <span className="text-orange-700 font-medium">缺侧链</span>
                  ) : (
                    <span className="text-muted-foreground">{issue.type}</span>
                  )}
                  {(issue.residue || issue.atom1) && (
                    <span className="font-mono">
                      {issue.residue || `${issue.atom1} ↔ ${issue.atom2}`}
                    </span>
                  )}
                  {(issue.phi !== undefined || issue.distance_A !== undefined) && (
                    <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                      {issue.phi !== undefined && issue.psi !== undefined
                        ? `φ ${issue.phi}° · ψ ${issue.psi}°`
                        : issue.distance_A !== undefined
                        ? `${issue.distance_A} Å`
                        : ""}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
          <div>
            结构质量综合评估: 原子碰撞 (&lt;1.5Å)、Ramachandran 异常率、缺失侧链。优秀 = 无明显问题, 较差 = 多处需修复。
          </div>
        </div>
      </div>
    </div>
  );
}
