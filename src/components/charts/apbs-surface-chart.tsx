"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";
import { Loader2, AlertCircle, Zap, CheckCircle2, XCircle } from "lucide-react";

// ----- Types (mirror the recipe output) -----
interface ChargedAtomRow {
  chain?: string;
  resno?: number;
  resname?: string;
  atom?: string;
  charge?: number;
  potential_kcal_mol?: number;
}

interface ApbsData {
  chain_filter?: string;
  ionic_strength_mM?: number;
  debye_length_A?: number;
  forcefield?: string;
  pdb2pqr_used?: boolean;
  num_charged_atoms?: number;
  total_potential_kcal_mol?: number;
  mean_potential_kcal_mol?: number;
  most_stabilizing?: ChargedAtomRow[];
  most_destabilizing?: ChargedAtomRow[];
  surface_charged?: ChargedAtomRow[];
}

export function ApbsSurfaceChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [chain, setChain] = useState("");
  const [ionicStrength, setIonicStrength] = useState(150);
  const [data, setData] = useState<ApbsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pdbId = activeStructure?.id ?? "";

  const run = useCallback(async () => {
    if (!activeStructure) {
      setError("请先加载一个结构");
      return;
    }
    if (!viewer) {
      setError("3D 视图未就绪,请稍后再试");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await executeCommand(viewer, {
        type: "show_electrostatic_surface",
        pdbId,
        chain: chain || undefined,
        ionicStrength,
      });
      if (!result.ok) {
        setError(result.detail ?? "APBS 计算失败");
        return;
      }
      const d = (result.analysisResult as any)?.data?.data;
      if (d) {
        setData(d as ApbsData);
        toast(result.detail ?? "APBS 表面已应用", "success");
      } else {
        setError("未返回有效数据");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeStructure, viewer, pdbId, chain, ionicStrength, toast]);

  // ----- Helpers -----
  const fmt = (v: number | undefined, digits = 2) => (v ?? 0).toFixed(digits);
  const pdb2pqr = data?.pdb2pqr_used ?? false;
  const forcefield = data?.forcefield ?? "PARSE";
  const debye = data?.debye_length_A ?? 0;
  const numCharged = data?.num_charged_atoms ?? 0;
  const totalPot = data?.total_potential_kcal_mol ?? 0;
  const meanPot = data?.mean_potential_kcal_mol ?? 0;
  const stabilizing = (data?.most_stabilizing ?? []).slice(0, 5);
  const destabilizing = (data?.most_destabilizing ?? []).slice(0, 5);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Zap className="h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-sm font-semibold">APBS 静电表面</span>
          {activeStructure && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure.label ?? pdbId}
            </Badge>
          )}
        </div>
        {data && (
          <Badge variant="secondary" className="text-[10px]">
            {numCharged} 带电原子
          </Badge>
        )}
      </div>

      <div className="space-y-3 p-4">
        {/* Controls */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">链 (可选, 空=全部)</Label>
            <Input
              value={chain}
              onChange={(e) => setChain(e.target.value.toUpperCase())}
              placeholder="A"
              maxLength={2}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">离子强度 (mM)</Label>
            <Input
              type="number"
              value={ionicStrength}
              onChange={(e) => setIonicStrength(Number(e.target.value) || 0)}
              step={10}
              min={0}
              max={500}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>

        <Button
          onClick={run}
          disabled={loading || !activeStructure}
          className="w-full h-8 text-xs"
          size="sm"
        >
          {loading ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              计算 APBS 表面…
            </>
          ) : (
            <>
              <Zap className="mr-1.5 h-3.5 w-3.5" />
              计算 + 3D 可视化
            </>
          )}
        </Button>

        {/* Empty state */}
        {!loading && !error && !data && (
          <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-[11px] text-muted-foreground">
            点击 "计算 + 3D 可视化" 后,会在 3D 视图中应用 <span className="font-mono">molecular-surface</span> +{" "}
            <span className="font-mono">partial-charge</span> 主题,并在下方展示带电原子分析结果。
          </div>
        )}

        {loading && <Skeleton className="h-40 w-full" />}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {/* Results */}
        {!loading && !error && data && (
          <div className="space-y-3">
            {/* Force field + pdb2pqr status */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="text-[10px] font-mono">
                力场: {forcefield}
              </Badge>
              {pdb2pqr ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15 text-[10px]">
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                  pdb2pqr 已用
                </Badge>
              ) : (
                <Badge className="bg-red-500/15 text-red-700 hover:bg-red-500/15 text-[10px]">
                  <XCircle className="mr-1 h-3 w-3" />
                  pdb2pqr 未用
                </Badge>
              )}
              <Badge variant="secondary" className="text-[10px]">
                链: {data.chain_filter ?? "all"}
              </Badge>
              <Badge variant="secondary" className="text-[10px]">
                λ_D = {fmt(debye)} Å
              </Badge>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border bg-amber-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">带电原子</div>
                <div className="font-mono text-base font-bold text-amber-600">
                  {numCharged}
                </div>
              </div>
              <div
                className={`rounded-md border p-2 text-center ${
                  totalPot < 0
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <div className="text-[9px] uppercase text-muted-foreground">总势能</div>
                <div
                  className={`font-mono text-base font-bold ${
                    totalPot < 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {totalPot > 0 ? "+" : ""}
                  {fmt(totalPot, 1)}
                </div>
                <div className="text-[8px] text-muted-foreground">kcal/mol</div>
              </div>
              <div
                className={`rounded-md border p-2 text-center ${
                  meanPot < 0
                    ? "border-emerald-500/30 bg-emerald-500/5"
                    : "border-red-500/30 bg-red-500/5"
                }`}
              >
                <div className="text-[9px] uppercase text-muted-foreground">平均势能</div>
                <div
                  className={`font-mono text-base font-bold ${
                    meanPot < 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {meanPot > 0 ? "+" : ""}
                  {fmt(meanPot, 3)}
                </div>
                <div className="text-[8px] text-muted-foreground">kcal/mol</div>
              </div>
            </div>

            {/* Color legend bar */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                表面着色 (红 = 负, 白 = 中性, 蓝 = 正)
              </div>
              <div className="relative h-4 overflow-hidden rounded border">
                <div
                  className="h-full w-full"
                  style={{
                    background:
                      "linear-gradient(to right, #ef4444 0%, #fee2e2 30%, #ffffff 50%, #dbeafe 70%, #3b82f6 100%)",
                  }}
                />
                <span className="absolute left-1 top-0 text-[8px] font-bold text-white drop-shadow">
                  −
                </span>
                <span className="absolute right-1 top-0 text-[8px] font-bold text-white drop-shadow">
                  +
                </span>
              </div>
              <div className="mt-0.5 flex justify-between text-[8px] text-muted-foreground">
                <span>负电荷区</span>
                <span>中性</span>
                <span>正电荷区</span>
              </div>
            </div>

            {/* Stabilizing + Destabilizing lists */}
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                  最稳定原子 (Top 5)
                </div>
                <div className="space-y-0.5">
                  {stabilizing.length === 0 && (
                    <div className="text-[9px] text-muted-foreground">无数据</div>
                  )}
                  {stabilizing.map((r, i) => {
                    const pot = (r.potential_kcal_mol ?? 0);
                    return (
                      <div
                        key={`stab-${i}`}
                        className="flex items-center gap-1 rounded bg-emerald-500/5 px-1.5 py-0.5 text-[10px]"
                      >
                        <span className="font-mono text-emerald-700">
                          {(r.resname ?? "")}
                          {r.resno ?? ""}
                          <span className="text-muted-foreground">.{r.atom ?? ""}</span>
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          ({r.chain ?? ""})
                        </span>
                        <Badge
                          variant="outline"
                          className="ml-auto border-emerald-500/40 font-mono text-[9px] text-emerald-700"
                        >
                          {pot.toFixed(2)}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-blue-700">
                  最不稳定原子 (Top 5)
                </div>
                <div className="space-y-0.5">
                  {destabilizing.length === 0 && (
                    <div className="text-[9px] text-muted-foreground">无数据</div>
                  )}
                  {destabilizing.map((r, i) => {
                    const pot = (r.potential_kcal_mol ?? 0);
                    return (
                      <div
                        key={`destab-${i}`}
                        className="flex items-center gap-1 rounded bg-blue-500/5 px-1.5 py-0.5 text-[10px]"
                      >
                        <span className="font-mono text-blue-700">
                          {(r.resname ?? "")}
                          {r.resno ?? ""}
                          <span className="text-muted-foreground">.{r.atom ?? ""}</span>
                        </span>
                        <span className="text-[9px] text-muted-foreground">
                          ({r.chain ?? ""})
                        </span>
                        <Badge
                          variant="outline"
                          className="ml-auto border-blue-500/40 font-mono text-[9px] text-blue-700"
                        >
                          {pot > 0 ? "+" : ""}
                          {pot.toFixed(2)}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 3D viz applied notice */}
            <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-800">
              <Zap className="mt-0.5 h-3 w-3 shrink-0" />
              <div>
                3D 可视化已应用: 已切换为{" "}
                <span className="font-mono">molecular-surface</span> 表示并应用{" "}
                <span className="font-mono">partial-charge</span> 颜色主题。Debye 屏蔽长度 ={" "}
                <span className="font-mono">{fmt(debye)} Å</span> (离子强度{" "}
                {data.ionic_strength_mM ?? 150} mM)。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
