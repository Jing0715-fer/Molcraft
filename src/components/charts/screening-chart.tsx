"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";
import { Loader2, AlertCircle, FlaskConical } from "lucide-react";

// ----- Types -----
interface RankedHit {
  name?: string;
  smiles?: string;
  mw?: number;
  logp?: number;
  hbond_donors?: number;
  hbond_acceptors?: number;
  affinity_kcal_mol?: number;
  ki_uM?: number;
  score?: number;
  rationale?: string;
}

interface ScreeningData {
  ligand?: string;
  pocket_score?: number;
  pocket_composition?: Record<string, number>;
  pocket_volume_A3?: number;
  hydrophobic_pct?: number;
  polar_pct?: number;
  charged_pct?: number;
  num_fragments_screened?: number;
  ranked_hits?: RankedHit[];
  top_hit?: string;
  best_affinity_kcal_mol?: number;
  best_ki_uM?: number;
}

// Format Ki intelligently (nM if <0.001µM, etc.)
function formatKi(ki_uM: number): string {
  if (!Number.isFinite(ki_uM)) return "—";
  if (ki_uM === 0) return "—";
  if (ki_uM < 0.001) return `${(ki_uM * 1e6).toFixed(1)} nM`; // µM → nM
  if (ki_uM < 1) return `${(ki_uM * 1000).toFixed(1)} nM`; // µM → nM
  if (ki_uM < 1000) return `${ki_uM.toFixed(2)} µM`;
  return `${(ki_uM / 1000).toFixed(2)} mM`;
}

// Affinity color: green < -5, blue < -2, amber < 0, red >= 0
function affinityColor(affinityKcal: number): string {
  if (affinityKcal < -5) return "#10b981"; // emerald
  if (affinityKcal < -2) return "#3b82f6"; // blue
  if (affinityKcal < 0) return "#f59e0b"; // amber
  return "#ef4444"; // red
}

// Lipinski rule-of-five badges
function lipinskiBadges(h: RankedHit) {
  const mw = h.mw ?? 0;
  const logp = h.logp ?? 0;
  const hbd = h.hbond_donors ?? 0;
  const hba = h.hbond_acceptors ?? 0;
  const passes = mw <= 500 && logp <= 5 && hbd <= 5 && hba <= 10;
  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <Badge
        variant="outline"
        className={`text-[8px] ${passes ? "border-emerald-500/40 text-emerald-700" : "border-red-500/40 text-red-700"}`}
      >
        Ro5 {passes ? "✓" : "✗"}
      </Badge>
      <Badge variant="outline" className="text-[8px] font-mono">
        MW {mw.toFixed(0)}
      </Badge>
      <Badge variant="outline" className="text-[8px] font-mono">
        logP {logp.toFixed(1)}
      </Badge>
      <Badge variant="outline" className="text-[8px] font-mono">
        HBD {hbd}
      </Badge>
      <Badge variant="outline" className="text-[8px] font-mono">
        HBA {hba}
      </Badge>
    </div>
  );
}

export function ScreeningChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [ligandCompId, setLigandCompId] = useState("REA");
  const [fragmentSet, setFragmentSet] = useState<"druglike" | "fragment" | "natural">("druglike");
  const [data, setData] = useState<ScreeningData | null>(null);
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
    if (!ligandCompId.trim()) {
      setError("请输入配体 compId");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await executeCommand(viewer, {
        type: "run_virtual_screening",
        ligandCompId: ligandCompId.toUpperCase(),
        pdbId,
        fragmentSet,
      });
      if (!result.ok) {
        setError(result.detail ?? "虚拟筛选失败");
        return;
      }
      const d = (result.analysisResult as any)?.data?.data;
      if (d) {
        setData(d as ScreeningData);
        toast(result.detail ?? "筛选完成", "success");
      } else {
        setError("未返回有效数据");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [activeStructure, viewer, pdbId, ligandCompId, fragmentSet, toast]);

  // ----- Derived (defensive) -----
  const hits = data?.ranked_hits ?? [];
  const topHit = hits[0] ?? null;
  const numScreened = data?.num_fragments_screened ?? 0;
  const pocketScore = data?.pocket_score ?? 0;
  const hydrophobicPct = data?.hydrophobic_pct ?? 0;
  const polarPct = data?.polar_pct ?? 0;
  const chargedPct = data?.charged_pct ?? 0;
  const pocketVolume = data?.pocket_volume_A3 ?? 0;
  const ligandLabel = data?.ligand ?? ligandCompId;
  // Find worst affinity for bar scaling
  const worstAffinity = hits.reduce(
    (m, h) => Math.max(m, h.affinity_kcal_mol ?? 0),
    0
  );
  const bestAffinity = hits.reduce(
    (m, h) => Math.min(m, h.affinity_kcal_mol ?? 0),
    0
  );
  const scaleRange = Math.max(Math.abs(worstAffinity), Math.abs(bestAffinity), 5);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <FlaskConical className="h-4 w-4 shrink-0 text-emerald-500" />
          <span className="text-sm font-semibold">虚拟筛选</span>
          {activeStructure && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure.label ?? pdbId}
            </Badge>
          )}
        </div>
        {data && (
          <Badge variant="secondary" className="text-[10px]">
            {hits.length} 命中
          </Badge>
        )}
      </div>

      <div className="space-y-3 p-4">
        {/* Controls */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">配体 compId</Label>
            <Input
              value={ligandCompId}
              onChange={(e) => setLigandCompId(e.target.value.toUpperCase())}
              placeholder="REA"
              maxLength={6}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">片段库</Label>
            <Select
              value={fragmentSet}
              onValueChange={(v) => setFragmentSet(v as "druglike" | "fragment" | "natural")}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="druglike">druglike (类药)</SelectItem>
                <SelectItem value="fragment">fragment (片段)</SelectItem>
                <SelectItem value="natural">natural (天然产物)</SelectItem>
              </SelectContent>
            </Select>
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
              运行虚拟筛选…
            </>
          ) : (
            <>
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
              运行虚拟筛选
            </>
          )}
        </Button>

        {!loading && !error && !data && (
          <div className="rounded-md border border-dashed bg-muted/30 p-4 text-center text-[11px] text-muted-foreground">
            选择片段库,输入配体 compId,点击运行将基于口袋特征(疏水性/极性/电荷/体积)对片段库进行打分排序。
          </div>
        )}

        {loading && <Skeleton className="h-48 w-full" />}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        )}

        {/* Results */}
        {!loading && !error && data && (
          <div className="space-y-3">
            {/* Top hit card */}
            {topHit && (
              <div className="rounded-md border-2 border-emerald-500/50 bg-emerald-500/5 p-3">
                <div className="mb-1 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Badge className="bg-emerald-500 text-white text-[9px]">★ Top Hit</Badge>
                    <span className="text-xs font-bold">{topHit.name ?? "unknown"}</span>
                  </div>
                  <Badge variant="outline" className="text-[9px]">
                    筛选库 {fragmentSet}
                  </Badge>
                </div>
                {/* SMILES */}
                <div className="mb-1.5 rounded bg-white/60 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground break-all">
                  {topHit.smiles ?? ""}
                </div>
                {/* Big ΔG */}
                <div className="flex items-baseline gap-2">
                  <span className="text-[9px] uppercase text-muted-foreground">ΔG</span>
                  <span
                    className="font-mono text-2xl font-bold"
                    style={{
                      color: affinityColor(topHit.affinity_kcal_mol ?? 0),
                    }}
                  >
                    {(topHit.affinity_kcal_mol ?? 0).toFixed(2)}
                  </span>
                  <span className="text-[9px] text-muted-foreground">kcal/mol</span>
                  <span className="ml-2 text-[9px] uppercase text-muted-foreground">Ki</span>
                  <span className="font-mono text-sm font-semibold text-emerald-700">
                    {formatKi(topHit.ki_uM ?? 0)}
                  </span>
                </div>
                {/* Property badges */}
                <div className="mt-1.5">{lipinskiBadges(topHit)}</div>
                {/* Rationale */}
                {topHit.rationale && (
                  <div className="mt-1.5 rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-900">
                    <span className="font-semibold">依据: </span>
                    {topHit.rationale}
                  </div>
                )}
              </div>
            )}

            {/* Pocket summary */}
            <div className="rounded-md border bg-muted/30 p-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                口袋摘要 (配体 {ligandLabel})
              </div>
              <div className="grid grid-cols-4 gap-1.5 text-center">
                <div>
                  <div className="text-[8px] uppercase text-muted-foreground">口袋分</div>
                  <div className="font-mono text-sm font-bold text-primary">
                    {(pocketScore ?? 0).toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] uppercase text-muted-foreground">疏水%</div>
                  <div className="font-mono text-sm font-bold text-amber-600">
                    {(hydrophobicPct ?? 0).toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] uppercase text-muted-foreground">极性%</div>
                  <div className="font-mono text-sm font-bold text-cyan-600">
                    {(polarPct ?? 0).toFixed(0)}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] uppercase text-muted-foreground">电荷%</div>
                  <div className="font-mono text-sm font-bold text-blue-600">
                    {(chargedPct ?? 0).toFixed(0)}
                  </div>
                </div>
              </div>
              <div className="mt-1 text-center text-[9px] text-muted-foreground">
                体积 {(pocketVolume ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })} Å³
                · 筛选 {numScreened} 个片段
              </div>
            </div>

            {/* Full hits list */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                完整命中列表 (按 ΔG 升序)
              </div>
              <div className="max-h-72 overflow-y-auto scrollbar-thin space-y-1">
                {hits.length === 0 && (
                  <div className="text-[10px] text-muted-foreground">无命中</div>
                )}
                {hits.map((h, i) => {
                  const aff = h.affinity_kcal_mol ?? 0;
                  const color = affinityColor(aff);
                  // Bar width: more negative = longer. Scale by scaleRange.
                  const barW = Math.min(100, (Math.abs(aff) / scaleRange) * 100);
                  return (
                    <div
                      key={i}
                      className="rounded border bg-card px-2 py-1 text-[10px] transition hover:border-primary/40"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[10px] font-bold text-muted-foreground">
                          #{i + 1}
                        </span>
                        <span className="font-medium">{h.name ?? "—"}</span>
                        <span
                          className="ml-auto font-mono text-[11px] font-bold"
                          style={{ color }}
                        >
                          {aff.toFixed(2)} kcal/mol
                        </span>
                        <span className="font-mono text-[9px] text-muted-foreground">
                          Ki {formatKi(h.ki_uM ?? 0)}
                        </span>
                      </div>
                      {/* SMILES */}
                      <div className="mt-0.5 font-mono text-[8px] text-muted-foreground break-all">
                        {h.smiles ?? ""}
                      </div>
                      {/* Affinity bar */}
                      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full"
                          style={{ width: `${barW}%`, backgroundColor: color }}
                        />
                      </div>
                      {/* Property badges */}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {lipinskiBadges(h)}
                      </div>
                      {/* Rationale */}
                      {h.rationale && (
                        <div className="mt-0.5 text-[8px] italic text-muted-foreground">
                          {h.rationale}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Scoring formula */}
            <div className="rounded-md bg-primary/5 p-2 text-[9px] text-muted-foreground">
              <div className="mb-0.5 font-semibold text-primary">评分模型</div>
              <div className="font-mono leading-relaxed">
                score = 0.5·norm(-ΔG) + 0.2·pocket_match + 0.2·Ro5_pass + 0.1·novelty
              </div>
              <div className="mt-0.5">
                其中 pocket_match = 1 - |fragment_props - pocket_props| / max · 片段属性匹配口袋特征 (疏水/极性/电荷比例)。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
