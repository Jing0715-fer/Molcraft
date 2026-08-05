"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GitCompare,
  RefreshCw,
  Loader2,
  Info,
  Check,
  X,
  Download,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface StructureComparison {
  id: string;
  label: string;
  source: string;
  chain_count?: number;
  total_residues?: number;
  total_atoms?: number;
  has_ligands?: boolean;
  ligand_count?: number;
  rama_favoured_pct?: number;
  ss_alpha_pct?: number;
  ss_beta_pct?: number;
  total_sasa?: number;
  disulfide_count?: number;
  oligomer_type?: string;
  quality?: string;
  bfactor_mean?: number;
  error?: string;
}

interface ComparisonState {
  comparisons: StructureComparison[];
  loaded: boolean;
}

export function StructureComparisonDashboard() {
  const structures = useAppStore((s) => s.structures);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [state, setState] = useState<ComparisonState>({ comparisons: [], loaded: false });
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);

  // Auto-select first 2 structures by default
  useEffect(() => {
    if (structures.length >= 2 && selectedIds.size === 0) {
      setSelectedIds(new Set(structures.slice(0, Math.min(4, structures.length)).map((s) => s.id)));
    }
  }, [structures, selectedIds]);

  const toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= 4) {
          toast("最多选择 4 个结构进行比较", "info");
          return prev;
        }
        next.add(id);
      }
      return next;
    });
  };

  const fetchComparison = useCallback(async () => {
    if (selectedIds.size < 2) {
      setState({ comparisons: [], loaded: false });
      return;
    }

    setLoading(true);
    setProgress(0);
    const selectedStructs = structures.filter((s) => selectedIds.has(s.id));
    const results: StructureComparison[] = [];
    let done = 0;

    await Promise.all(
      selectedStructs.map(async (struct) => {
        const comp: StructureComparison = {
          id: struct.id,
          label: struct.label,
          source: struct.source,
        };

        const isPdbId = /^[a-zA-Z0-9]{4}$/.test(struct.id);
        const hasFileCache = !!structureFileCache[struct.id];

        const body: Record<string, unknown> = {};
        if (isPdbId) {
          body.pdbId = struct.id;
        } else if (hasFileCache) {
          body.fileContent = structureFileCache[struct.id].content;
          body.fileFormat = structureFileCache[struct.id].format;
        } else {
          comp.error = "非 PDB ID 且无文件缓存";
          results.push(comp);
          done++;
          setProgress(Math.round((done / selectedStructs.length) * 100));
          return;
        }

        // Run 5 key recipes in parallel for each structure
        const recipes = ["summary", "ramachandran", "secondary_structure_simple", "sasa", "disulfide_bonds", "oligomer_analysis", "structure_validation", "bfactor_stats"];
        const recipeResults: Record<string, unknown> = {};

        await Promise.all(
          recipes.map(async (recipe) => {
            try {
              const res = await fetch("/api/analyze/run", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ...body, recipe }),
              });
              if (res.ok) {
                const json = await res.json();
                if (json.data && !json.data.error) {
                  recipeResults[recipe] = json.data;
                }
              }
            } catch {
              // ignore individual recipe failures
            }
          })
        );

        // Extract comparison data
        const summary = recipeResults.summary as { chain_count?: number; total_residues?: number; total_atoms?: number; ligands?: Record<string, number> } | undefined;
        if (summary) {
          comp.chain_count = summary.chain_count;
          comp.total_residues = summary.total_residues;
          comp.total_atoms = summary.total_atoms;
          comp.ligand_count = summary.ligands ? Object.keys(summary.ligands).length : 0;
          comp.has_ligands = (comp.ligand_count ?? 0) > 0;
        }

        const rama = recipeResults.ramachandran as { favoured_pct?: number } | undefined;
        if (rama) comp.rama_favoured_pct = rama.favoured_pct;

        const ss = recipeResults.secondary_structure_simple as { alpha_helix_pct?: number; beta_sheet_pct?: number } | undefined;
        if (ss) {
          comp.ss_alpha_pct = ss.alpha_helix_pct;
          comp.ss_beta_pct = ss.beta_sheet_pct;
        }

        const sasa = recipeResults.sasa as { total_sasa_A2?: number } | undefined;
        if (sasa) comp.total_sasa = sasa.total_sasa_A2;

        const disulfide = recipeResults.disulfide_bonds as { count?: number } | undefined;
        if (disulfide) comp.disulfide_count = disulfide.count;

        const oligomer = recipeResults.oligomer_analysis as { oligomer_type?: string } | undefined;
        if (oligomer) comp.oligomer_type = oligomer.oligomer_type;

        const validation = recipeResults.structure_validation as { quality?: string } | undefined;
        if (validation) comp.quality = validation.quality;

        const bfactor = recipeResults.bfactor_stats as { chains?: Record<string, { mean?: number }> } | undefined;
        if (bfactor?.chains) {
          const first = Object.values(bfactor.chains)[0];
          comp.bfactor_mean = first?.mean;
        }

        results.push(comp);
        done++;
        setProgress(Math.round((done / selectedStructs.length) * 100));
      })
    );

    setState({ comparisons: results, loaded: true });
    setLoading(false);
    const successCount = results.filter((r) => !r.error).length;
    toast(`比较完成: ${successCount}/${results.length} 结构成功`, "success");
  }, [selectedIds, structures, structureFileCache, toast]);

  /** Export comparison results as Markdown report */
  const handleExportMd = useCallback(() => {
    if (!state.loaded || state.comparisons.length < 2) return;
    const date = new Date().toLocaleString("zh-CN");
    const lines: string[] = [];
    lines.push("# 结构比较报告");
    lines.push("");
    lines.push(`> 生成时间: ${date}`);
    lines.push(`> 比较结构数: ${state.comparisons.length}`);
    lines.push(`> 分析项: 8 项并行 × ${state.comparisons.length} 结构`);
    lines.push("");

    lines.push("## 比较结构");
    lines.push("");
    for (const comp of state.comparisons) {
      lines.push(`- **${comp.label}** (${comp.source})${comp.error ? ` ⚠️ ${comp.error}` : ""}`);
    }
    lines.push("");

    lines.push("## 指标比较");
    lines.push("");
    // Table header
    const header = ["指标", ...state.comparisons.map((c) => c.label)];
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);

    for (const row of metricRows) {
      const cells = [row.label];
      const best = getBestValue(row.key);
      const worst = getWorstValue(row.key);
      for (const comp of state.comparisons) {
        if (comp.error) {
          cells.push("—");
        } else {
          const val = comp[row.key];
          const formatted = formatValue(val, row.type);
          const str = typeof formatted === "object" ? (formatted as { label: string }).label : String(formatted);
          const isBest = best !== null && val === best;
          cells.push(isBest ? `**${str}** ★` : str);
        }
      }
      lines.push(`| ${cells.join(" | ")} |`);
    }
    lines.push("");

    lines.push("## 最优值规则");
    lines.push("");
    lines.push("- **★ 最优值**: Ramachandran 偏好区/α-螺旋/β-折叠 最高; B-factor 均值/总 SASA 最低");
    lines.push("");
    lines.push("---");
    lines.push("");
    lines.push("*报告由 MolCraft AI 自动生成 · 结构比较仪表盘*");

    const md = lines.join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comparison-report-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast("比较报告 (Markdown) 已导出", "success");
  }, [state, toast]);

  /** Export comparison results as styled HTML report */
  const handleExportHtml = useCallback(() => {
    if (!state.loaded || state.comparisons.length < 2) return;
    const date = new Date().toLocaleString("zh-CN");
    let html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>结构比较报告</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:1000px;margin:20px auto;padding:0 16px;color:#1e293b;line-height:1.5}h1{color:#0369a1;border-bottom:2px solid #0369a1;padding-bottom:6px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px 10px;text-align:center}th{background:#f1f5f9}td:first-child{text-align:left;font-weight:500;background:#f8fafc;position:sticky;left:0}.best{background:#10b98115;font-weight:bold;color:#059669}.good{background:#10b98108;color:#047857}.mid{background:#f59e0b08;color:#b45309}.bad{background:#ef444408;color:#dc2626}.meta{color:#64748b;font-size:11px}</style></head><body>`;
    html += `<h1>🔬 结构比较报告</h1><p class="meta">生成时间: ${date} · 比较结构数: ${state.comparisons.length} · 8 项并行分析</p>`;

    // Structure list
    html += "<h2>比较结构</h2><ul>";
    for (const comp of state.comparisons) {
      html += `<li><b>${comp.label}</b> (${comp.source})${comp.error ? ` ⚠️ ${comp.error}` : ""}</li>`;
    }
    html += "</ul>";

    // Comparison table
    html += "<h2>指标比较</h2><table><thead><tr><th>指标</th>";
    for (const comp of state.comparisons) {
      html += `<th>${comp.label}<br><span style="font-size:9px;color:#64748b">${comp.source}</span></th>`;
    }
    html += "</tr></thead><tbody>";

    for (const row of metricRows) {
      html += `<tr><td>${row.label}</td>`;
      const best = getBestValue(row.key);
      const worst = getWorstValue(row.key);
      for (const comp of state.comparisons) {
        if (comp.error) {
          html += '<td style="color:#94a3b8">—</td>';
        } else {
          const val = comp[row.key];
          const formatted = formatValue(val, row.type);
          const str = typeof formatted === "object" ? (formatted as { label: string; color?: string }).label : String(formatted);
          const colorStyle = typeof formatted === "object" && (formatted as { color?: string }).color ? `color:${(formatted as { color: string }).color}` : "";
          const isBest = best !== null && val === best;
          const cls = getCellColorClass(row.key, val);
          html += `<td class="${cls}" style="${colorStyle}">${str}${isBest ? " ★" : ""}</td>`;
        }
      }
      html += "</tr>";
    }
    html += "</tbody></table>";

    html += '<p class="meta">★ = 最优值 · 颜色: 🟢最优 🟡中等 🔴最差 · 报告由 MolCraft AI 自动生成</p>';
    html += "</body></html>";

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `comparison-report-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast("比较报告 (HTML) 已导出", "success");
  }, [state, toast]);

  useEffect(() => {
    if (selectedIds.size >= 2) {
      fetchComparison();
    } else {
      setState({ comparisons: [], loaded: false });
    }
  }, [fetchComparison, selectedIds]);

  const metricRows = [
    { key: "source" as const, label: "来源", type: "text" as const },
    { key: "chain_count" as const, label: "链数", type: "number" as const },
    { key: "total_residues" as const, label: "残基数", type: "number" as const },
    { key: "total_atoms" as const, label: "原子数", type: "number" as const },
    { key: "quality" as const, label: "质量评分", type: "quality" as const },
    { key: "rama_favoured_pct" as const, label: "Ramachandran 偏好区", type: "pct" as const },
    { key: "ss_alpha_pct" as const, label: "α-螺旋", type: "pct" as const },
    { key: "ss_beta_pct" as const, label: "β-折叠", type: "pct" as const },
    { key: "bfactor_mean" as const, label: "B-factor 均值", type: "float1" as const },
    { key: "total_sasa" as const, label: "总 SASA (Å²)", type: "int" as const },
    { key: "disulfide_count" as const, label: "二硫键数", type: "number" as const },
    { key: "oligomer_type" as const, label: "寡聚类型", type: "text" as const },
    { key: "has_ligands" as const, label: "含配体", type: "bool" as const },
  ];

  const getBestValue = (key: keyof StructureComparison) => {
    const values = state.comparisons
      .filter((c) => !c.error && c[key] !== undefined)
      .map((c) => c[key]);
    if (values.length === 0) return null;
    // For percentages, higher is better (except quality)
    if (key === "rama_favoured_pct" || key === "ss_alpha_pct" || key === "ss_beta_pct") {
      return Math.max(...(values as number[]));
    }
    // For B-factor and SASA, lower is better (more stable/compact)
    if (key === "bfactor_mean" || key === "total_sasa") {
      return Math.min(...(values as number[]));
    }
    return null;
  };

  const getWorstValue = (key: keyof StructureComparison) => {
    const values = state.comparisons
      .filter((c) => !c.error && c[key] !== undefined)
      .map((c) => c[key]);
    if (values.length === 0) return null;
    if (key === "rama_favoured_pct" || key === "ss_alpha_pct" || key === "ss_beta_pct") {
      return Math.min(...(values as number[]));
    }
    if (key === "bfactor_mean" || key === "total_sasa") {
      return Math.max(...(values as number[]));
    }
    return null;
  };

  /** Returns a color class based on how good the value is relative to best/worst */
  const getCellColorClass = (key: keyof StructureComparison, value: unknown): string => {
    if (value === undefined || value === null || typeof value !== "number") return "";
    const best = getBestValue(key);
    const worst = getWorstValue(key);
    if (best === null || worst === null || best === worst) return "";
    const numValue = value as number;
    const bestN = best as number;
    const worstN = worst as number;
    // Normalize to 0-1 range (1 = best, 0 = worst)
    const t = (numValue - worstN) / (bestN - worstN);
    if (t >= 0.95) return "bg-emerald-500/15 font-bold text-emerald-600";
    if (t >= 0.75) return "bg-emerald-500/8 text-emerald-700";
    if (t >= 0.5) return "bg-amber-500/8 text-amber-700";
    if (t >= 0.25) return "bg-orange-500/8 text-orange-700";
    return "bg-red-500/8 text-red-700";
  };

  const formatValue = (value: unknown, type: string) => {
    if (value === undefined || value === null) return "—";
    switch (type) {
      case "number":
      case "int":
        return typeof value === "number" ? (type === "int" ? Math.round(value).toLocaleString() : String(value)) : String(value);
      case "pct":
        return typeof value === "number" ? `${value}%` : String(value);
      case "float1":
        return typeof value === "number" ? value.toFixed(1) : String(value);
      case "bool":
        return value ? "✓ 是" : "✗ 否";
      case "quality":
        const meta: Record<string, { label: string; color: string }> = {
          good: { label: "优秀", color: "#059669" },
          fair: { label: "一般", color: "#f59e0b" },
          poor: { label: "较差", color: "#ef4444" },
        };
        const m = meta[value as string] ?? { label: String(value), color: "#6b7280" };
        return m;
      default:
        return String(value);
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="comparison-header flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <GitCompare className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="text-sm font-semibold">结构比较仪表盘</span>
          <Badge variant="outline" className="text-[9px]">
            {selectedIds.size}/{Math.min(4, structures.length)} 已选
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={loading || !state.loaded || state.comparisons.length < 2}
                title="导出比较报告"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1" sideOffset={4}>
              <button
                onClick={handleExportMd}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5 text-emerald-600" />
                <div>
                  <div className="font-medium">Markdown (.md)</div>
                  <div className="text-[9px] text-muted-foreground">纯文本,适合 GitHub</div>
                </div>
              </button>
              <button
                onClick={handleExportHtml}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition hover:bg-accent"
              >
                <Download className="h-3.5 w-3.5 text-blue-600" />
                <div>
                  <div className="font-medium">HTML (.html)</div>
                  <div className="text-[9px] text-muted-foreground">带样式+颜色渐变</div>
                </div>
              </button>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchComparison}
            disabled={loading || selectedIds.size < 2}
            title="重新比较"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {/* Structure selection */}
        <div>
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            选择要比较的结构 (2-4 个)
          </div>
          <div className="flex flex-wrap gap-1">
            {structures.map((s, i) => {
              const isSelected = selectedIds.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => toggleSelection(s.id)}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] transition ${
                    isSelected
                      ? "border-blue-500 bg-blue-500/10 text-blue-600"
                      : "border-border bg-background hover:border-blue-500/50"
                  }`}
                >
                  {isSelected ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <X className="h-3 w-3 opacity-30" />
                  )}
                  <span className="font-mono">{s.label}</span>
                  <Badge variant="outline" className="px-1 py-0 text-[8px]">
                    {s.source}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>

        {/* Loading progress */}
        {loading && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">正在并行分析 {selectedIds.size} 个结构…</span>
              <span className="font-mono text-blue-500">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Empty state */}
        {selectedIds.size < 2 && (
          <div className="rounded-md border border-dashed p-4 text-center text-[11px] text-muted-foreground">
            <GitCompare className="mx-auto mb-1 h-6 w-6 text-muted-foreground/40" />
            选择至少 2 个结构进行比较
            <div className="mt-0.5 text-[9px]">加载多个结构后在此并列对比关键指标</div>
          </div>
        )}

        {/* Comparison table */}
        {!loading && state.loaded && state.comparisons.length >= 2 && (
          <div className="space-y-2">
            <div className="overflow-x-auto scrollbar-thin">
              <table className="comparison-table w-full border-collapse text-[10px]">
                <thead>
                  <tr>
                    <th className="border-b bg-muted/30 px-2 py-1 text-left font-medium text-muted-foreground sticky left-0 bg-card">
                      指标
                    </th>
                    {state.comparisons.map((comp) => (
                      <th key={comp.id} className="border-b bg-muted/30 px-2 py-1 text-center font-medium">
                        <div className="font-mono text-[10px] font-bold">{comp.label}</div>
                        <div className="text-[8px] text-muted-foreground">{comp.source}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metricRows.map((row) => (
                    <tr key={row.key} className="hover:bg-accent/10">
                      <td className="border-b px-2 py-1 text-left font-medium text-muted-foreground sticky left-0 bg-card">
                        {row.label}
                      </td>
                      {state.comparisons.map((comp) => {
                        const value = comp[row.key];
                        const formatted = formatValue(value, row.type);
                        const bestVal = getBestValue(row.key);
                        const isBest = bestVal !== null && value === bestVal && !comp.error;
                        const colorClass = !comp.error ? getCellColorClass(row.key, value) : "";
                        if (row.type === "quality" && typeof formatted === "object") {
                          const m = formatted as { label: string; color: string };
                          return (
                            <td
                              key={comp.id}
                              className="border-b px-2 py-1 text-center"
                              style={{ color: m.color }}
                            >
                              <span className="font-bold">{m.label}</span>
                            </td>
                          );
                        }
                        return (
                          <td
                            key={comp.id}
                            className={`border-b px-2 py-1 text-center font-mono transition-colors ${
                              comp.error ? "text-muted-foreground/50" : colorClass
                            }`}
                          >
                            {comp.error ? "—" : String(formatted)}
                            {isBest && <span className="ml-0.5 text-[8px]">★</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Legend */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span className="grid h-3 w-3 place-items-center rounded bg-emerald-500/15 text-[8px] text-emerald-600">★</span>
                  <span>最优值</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-emerald-500/8" />
                  <span>较优</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-amber-500/8" />
                  <span>中等</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-red-500/8" />
                  <span>较差</span>
                </div>
              </div>
              <div className="text-[9px] text-muted-foreground">
                颜色基于该行最优/最差值渐变: 绿=最优,黄=中等,红=最差
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-blue-500/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-blue-500" />
              <div>
                并行运行 8 项分析 (摘要/Ramachandran/二级结构/B-factor/SASA/二硫键/寡聚体/验证) × {state.comparisons.length} 个结构,一表掌握多结构差异。★ 标记每行最优值。
              </div>
            </div>
          </div>
        )}

        {/* Errors */}
        {!loading && state.loaded && state.comparisons.some((c) => c.error) && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700">
            <div className="font-medium">部分结构分析失败:</div>
            {state.comparisons.filter((c) => c.error).map((c) => (
              <div key={c.id} className="font-mono text-[9px]">
                {c.label}: {c.error}
              </div>
            ))}
          </div>
        )}

        {/* RMSD Per-Residue Heatmap (if 2+ structures loaded) */}
        {!loading && state.loaded && state.comparisons.length >= 2 && (
          <RmsdHeatmapSection
            structures={structures}
            structureFileCache={structureFileCache}
            toast={toast}
          />
        )}
      </div>
    </div>
  );
}

/** RMSD per-residue heatmap section — shows a color-coded bar chart
 *  of per-residue Cα deviation between two structures. */
function RmsdHeatmapSection({
  structures,
  structureFileCache,
  toast,
}: {
  structures: Array<{ id: string; label: string; pdbText?: string }>;
  structureFileCache: Record<string, { content: string; format: string }>;
  toast: (msg: string, kind?: "default" | "success" | "error" | "info") => void;
}) {
  const [rmsdData, setRmsdData] = useState<Array<{ resno: number; rmsd: number }> | null>(null);
  const [rmsdStats, setRmsdStats] = useState<{
    rmsdAligned: number | null;
    rmsdRaw: number | null;
    tmScore: number | null;
    commonResidues: number | null;
    highVarCount: number | null;
  }>({ rmsdAligned: null, rmsdRaw: null, tmScore: null, commonResidues: null, highVarCount: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computeRmsd = useCallback(async () => {
    if (structures.length < 2) return;
    setLoading(true);
    setError(null);
    try {
      // Use the first two structures
      const s1 = structures[0];
      const s2 = structures[1];
      const pdb1 = s1.pdbText ?? structureFileCache[s1.id]?.content;
      const pdb2 = s2.pdbText ?? structureFileCache[s2.id]?.content;

      if (!pdb1 || !pdb2) {
        setError("缺少 PDB 文本数据，无法计算逐残基 RMSD");
        return;
      }

      // Use the cross-structure recipe (per_residue_rmsd_two) which
      // supports two independent PDB files via fileContent + fileContent2.
      const body: Record<string, unknown> = {
        recipe: "per_residue_rmsd_two",
        fileContent: pdb1,
        fileContent2: pdb2,
        fileFormat: "pdb",
        fileFormat2: "pdb",
        params: { chain1: "A", chain2: "A" },
      };

      const res = await fetch("/api/analyze/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const data = json.data;
      if (data?.error) {
        setError(data.error);
        return;
      }
      // The per_residue_rmsd_two recipe returns per_residue with {resno, rmsd}
      const deviations = data.per_residue || data.residue_deviations || data.deviations || [];
      if (deviations.length > 0) {
        setRmsdData(deviations.map((d: any) => ({
          resno: d.resno || d.residue_number || 0,
          rmsd: d.rmsd || d.deviation || 0,
        })));
        setRmsdStats({
          rmsdAligned: data.rmsd_aligned_A ?? data.rmsd_aligned ?? null,
          rmsdRaw: data.rmsd_raw_A ?? data.rmsd_raw ?? null,
          tmScore: data.tm_score ?? null,
          commonResidues: data.common_residues ?? deviations.length,
          highVarCount: data.high_variation_count ?? null,
        });
        toast(`逐残基 RMSD 完成: ${deviations.length} 残基, RMSD=${data.rmsd_aligned_A ?? "?"}Å, TM=${data.tm_score ?? "?"}`, "success");
      } else {
        setError("未返回逐残基偏差数据");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`RMSD 计算失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [structures, structureFileCache, toast]);

  // Auto-compute on mount if 2+ structures have PDB text
  useEffect(() => {
    const s1 = structures[0];
    const s2 = structures[1];
    if (s1 && s2 && (s1.pdbText || structureFileCache[s1.id]) && (s2.pdbText || structureFileCache[s2.id])) {
      computeRmsd();
    }
  }, [structures, structureFileCache, computeRmsd]);

  return (
    <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <GitCompare className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-semibold">逐残基 RMSD 热图</span>
        <Badge variant="outline" className="ml-auto text-[9px]">
          {structures[0]?.label} vs {structures[1]?.label}
        </Badge>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={computeRmsd}
          disabled={loading}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {loading && <Skeleton className="h-24 w-full" />}

      {error && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700">
          {error}
        </div>
      )}

      {!loading && !error && rmsdData && rmsdData.length > 0 && (
        <div>
          {/* Heatmap bar */}
          <div className="flex h-8 w-full overflow-hidden rounded">
            {rmsdData.map((d, i) => {
              // Color: green (<1Å) → yellow (1-3Å) → red (>3Å)
              const r = d.rmsd;
              const color =
                r < 1 ? `rgba(16, 185, 129, ${0.3 + Math.min(r, 1) * 0.7})` :
                r < 3 ? `rgba(245, 158, 11, ${0.3 + Math.min((r - 1) / 2, 1) * 0.7})` :
                `rgba(239, 68, 68, ${0.3 + Math.min((r - 3) / 5, 1) * 0.7})`;
              return (
                <div
                  key={i}
                  className="flex-1 min-w-[2px]"
                  style={{ backgroundColor: color }}
                  title={`残基 ${d.resno}: ${d.rmsd.toFixed(2)} Å`}
                />
              );
            })}
          </div>
          {/* X-axis labels */}
          <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
            <span>{rmsdData[0]?.resno}</span>
            <span>{rmsdData[Math.floor(rmsdData.length / 2)]?.resno}</span>
            <span>{rmsdData[rmsdData.length - 1]?.resno}</span>
          </div>
          {/* Legend */}
          <div className="mt-2 flex items-center gap-3 text-[9px] text-muted-foreground">
            <div className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-emerald-500/50" />
              &lt;1Å (保守)
            </div>
            <div className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-amber-500/50" />
              1-3Å (中等变异)
            </div>
            <div className="flex items-center gap-1">
              <span className="h-3 w-3 rounded bg-red-500/50" />
              &gt;3Å (高变异)
            </div>
          </div>
          {/* Stats */}
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
            <div className="rounded bg-background p-1.5 text-center">
              <div className="text-[9px] text-muted-foreground">平均</div>
              <div className="font-mono font-bold">
                {(rmsdData.reduce((s, d) => s + d.rmsd, 0) / rmsdData.length).toFixed(2)} Å
              </div>
            </div>
            <div className="rounded bg-background p-1.5 text-center">
              <div className="text-[9px] text-muted-foreground">最大</div>
              <div className="font-mono font-bold text-red-500">
                {Math.max(...rmsdData.map((d) => d.rmsd)).toFixed(2)} Å
              </div>
            </div>
            <div className="rounded bg-background p-1.5 text-center">
              <div className="text-[9px] text-muted-foreground">残基数</div>
              <div className="font-mono font-bold">{rmsdData.length}</div>
            </div>
          </div>
          {/* Cross-structure alignment stats */}
          {rmsdStats.rmsdAligned !== null && (
            <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
              <div className="rounded bg-emerald-500/5 border border-emerald-500/20 p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground">叠合 RMSD</div>
                <div className="font-mono font-bold text-emerald-600">
                  {rmsdStats.rmsdAligned} Å
                </div>
              </div>
              <div className="rounded bg-blue-500/5 border border-blue-500/20 p-1.5 text-center">
                <div className="text-[9px] text-muted-foreground">TM-score</div>
                <div className="font-mono font-bold text-blue-600">
                  {rmsdStats.tmScore ?? "—"}
                </div>
              </div>
              {rmsdStats.rmsdRaw !== null && (
                <div className="rounded bg-amber-500/5 border border-amber-500/20 p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground">原始 RMSD</div>
                  <div className="font-mono font-bold text-amber-600">
                    {rmsdStats.rmsdRaw} Å
                  </div>
                </div>
              )}
              {rmsdStats.highVarCount !== null && (
                <div className="rounded bg-red-500/5 border border-red-500/20 p-1.5 text-center">
                  <div className="text-[9px] text-muted-foreground">高变异残基</div>
                  <div className="font-mono font-bold text-red-600">
                    {rmsdStats.highVarCount} (&gt;3Å)
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!loading && !error && !rmsdData && (
        <div className="py-3 text-center text-[10px] text-muted-foreground">
          点击刷新按钮计算逐残基 RMSD
        </div>
      )}
    </div>
  );
}
