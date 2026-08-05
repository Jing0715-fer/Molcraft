"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LayoutDashboard,
  RefreshCw,
  Loader2,
  Info,
  Microscope,
  Activity,
  Box,
  Zap,
  Link2,
  SunMedium,
  FlaskConical,
  Layers,
  Download,
  Camera,
} from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// ===== Types for each analysis result =====
interface SummaryData {
  chain_count: number;
  chains: Record<string, { residue_count: number; first_resno: number | null; last_resno: number | null; atom_count: number }>;
  total_residues: number;
  total_atoms: number;
  ligands: Record<string, number>;
  has_hydrogens: boolean;
}

interface RamaData {
  total_residues: number;
  favoured_pct: number;
  outlier_pct: number;
  regions: Record<string, number>;
}

interface SsData {
  total_residues: number;
  ss_counts: { alpha_helix: number; beta_sheet: number; coil: number; turn: number };
  alpha_helix_pct: number;
  beta_sheet_pct: number;
  coil_pct: number;
  turn_pct: number;
}

interface BfactorData {
  total_chains: number;
  chains: Record<string, { mean: number; min: number; max: number; std: number; is_plddt: boolean }>;
}

interface SasaData {
  total_sasa_A2: number;
  chain_sasa_A2: Record<string, number>;
  n_chains: number;
}

interface DisulfideData {
  count: number;
  bonds: Array<{ chain1: string; resno1: number; chain2: string; resno2: number; distance_A: number }>;
  cutoff: number;
}

interface OligomerData {
  n_chains: number;
  oligomer_type: string;
  is_homomer: boolean;
  n_interfaces: number;
  chains: Array<{ chain: string; residue_count: number; atom_count: number }>;
  interfaces: Array<{ chain1: string; chain2: string; contact_atoms: number; min_distance_A: number }>;
}

interface ValidationData {
  quality: "good" | "fair" | "poor";
  clash_count: number;
  rama_outlier_count: number;
  rama_outlier_pct: number;
  missing_sidechain_count: number;
}

interface OverviewState {
  summary: SummaryData | null;
  rama: RamaData | null;
  ss: SsData | null;
  bfactor: BfactorData | null;
  sasa: SasaData | null;
  disulfide: DisulfideData | null;
  oligomer: OligomerData | null;
  validation: ValidationData | null;
  errors: string[];
  loaded: boolean;
}

const INITIAL_STATE: OverviewState = {
  summary: null,
  rama: null,
  ss: null,
  bfactor: null,
  sasa: null,
  disulfide: null,
  oligomer: null,
  validation: null,
  errors: [],
  loaded: false,
};

const QUALITY_META: Record<string, { label: string; color: string; bg: string }> = {
  good: { label: "优秀", color: "#059669", bg: "#05966920" },
  fair: { label: "一般", color: "#f59e0b", bg: "#f59e0b20" },
  poor: { label: "较差", color: "#ef4444", bg: "#ef444420" },
};

const SS_COLORS: Record<string, string> = {
  alpha_helix: "#10b981",
  beta_sheet: "#3b82f6",
  turn: "#f59e0b",
  coil: "#9ca3af",
};

const SS_LABELS: Record<string, string> = {
  alpha_helix: "α-螺旋",
  beta_sheet: "β-折叠",
  turn: "转角",
  coil: "卷曲",
};

export function StructureOverviewDashboard() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const viewer = useAppStore((s) => s.viewer);
  const [state, setState] = useState<OverviewState>(INITIAL_STATE);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchAll = useCallback(async () => {
    if (!activeId) {
      setState(INITIAL_STATE);
      return;
    }

    const body: Record<string, unknown> = {};
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setState({
        ...INITIAL_STATE,
        errors: [`当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法生成概览。`],
      });
      return;
    }

    setLoading(true);
    setProgress(0);
    progressRef.current = 0;
    setState({ ...INITIAL_STATE, loaded: false });

    const recipes = [
      { key: "summary" as const, recipe: "summary" },
      { key: "rama" as const, recipe: "ramachandran" },
      { key: "ss" as const, recipe: "secondary_structure_simple" },
      { key: "bfactor" as const, recipe: "bfactor_stats" },
      { key: "sasa" as const, recipe: "sasa" },
      { key: "disulfide" as const, recipe: "disulfide_bonds" },
      { key: "oligomer" as const, recipe: "oligomer_analysis" },
      { key: "validation" as const, recipe: "structure_validation" },
    ];

    const errors: string[] = [];
    const results: Partial<OverviewState> = {};

    // Run all recipes in parallel for speed
    await Promise.all(
      recipes.map(async ({ key, recipe }) => {
        try {
          const res = await fetch("/api/analyze/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, recipe }),
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || err.error || `HTTP ${res.status}`);
          }
          const json = await res.json();
          if (json.data) {
            if (json.data.error) {
              errors.push(`${recipe}: ${json.data.error}`);
            } else {
              results[key] = json.data;
            }
          } else {
            errors.push(`${recipe}: 无数据`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          errors.push(`${recipe}: ${msg}`);
        }
        progressRef.current += 1;
        setProgress(Math.round((progressRef.current / recipes.length) * 100));
      })
    );

    setState({
      ...(results as OverviewState),
      errors,
      loaded: true,
    });
    setLoading(false);
    if (errors.length > 0 && errors.length < recipes.length) {
      toast(`概览完成 (${recipes.length - errors.length}/${recipes.length} 成功)`, "info");
    } else if (errors.length === 0) {
      toast("概览分析完成", "success");
    } else {
      toast(`概览失败: ${errors.length} 项错误`, "error");
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, toast]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** Export all analysis results as a markdown report */
  const handleExport = useCallback(() => {
    if (!state.loaded || !activeId) return;
    const label = activeStructure?.label ?? activeId;
    const lines: string[] = [];
    lines.push(`# 结构概览报告: ${label}`);
    lines.push("");
    lines.push(`> 生成时间: ${new Date().toLocaleString("zh-CN")}`);
    lines.push(`> 分析项: 8 项并行 (摘要 / Ramachandran / 二级结构 / B-factor / SASA / 二硫键 / 寡聚体 / 验证)`);
    lines.push("");

    // Summary
    if (state.summary) {
      lines.push("## 1. 结构摘要");
      lines.push("");
      lines.push(`- **链数**: ${state.summary.chain_count}`);
      lines.push(`- **总残基数**: ${state.summary.total_residues}`);
      lines.push(`- **总原子数**: ${state.summary.total_atoms}`);
      lines.push(`- **含氢原子**: ${state.summary.has_hydrogens ? "是" : "否"}`);
      if (Object.keys(state.summary.ligands).length > 0) {
        lines.push(`- **配体**: ${Object.entries(state.summary.ligands).map(([k, v]) => `${k}${v > 1 ? `×${v}` : ""}`).join(", ")}`);
      }
      lines.push("");
      lines.push("### 链详情");
      lines.push("");
      lines.push("| 链 | 残基数 | 原子数 | 范围 |");
      lines.push("|---|---|---|---|");
      for (const [chain, info] of Object.entries(state.summary.chains)) {
        lines.push(`| ${chain} | ${info.residue_count} | ${info.atom_count} | ${info.first_resno}-${info.last_resno} |`);
      }
      lines.push("");
    }

    // Validation
    if (state.validation) {
      lines.push("## 2. 结构质量验证");
      lines.push("");
      lines.push(`- **质量评分**: ${QUALITY_META[state.validation.quality].label}`);
      lines.push(`- **原子碰撞数**: ${state.validation.clash_count}`);
      lines.push(`- **Ramachandran 异常率**: ${state.validation.rama_outlier_pct}% (${state.validation.rama_outlier_count}/${state.validation.total_phi_psi})`);
      lines.push(`- **缺失侧链数**: ${state.validation.missing_sidechain_count}`);
      lines.push("");
    }

    // Ramachandran
    if (state.rama) {
      lines.push("## 3. Ramachandran 分析");
      lines.push("");
      lines.push(`- **总残基数**: ${state.rama.total_residues}`);
      lines.push(`- **偏好区**: ${state.rama.favoured_pct}%`);
      lines.push(`- **异常区**: ${state.rama.outlier_pct}%`);
      lines.push("");
    }

    // Secondary structure
    if (state.ss) {
      lines.push("## 4. 二级结构组成");
      lines.push("");
      lines.push(`- **总残基数**: ${state.ss.total_residues}`);
      lines.push(`- **α-螺旋**: ${state.ss.alpha_helix_pct}% (${state.ss.ss_counts.alpha_helix} 残基)`);
      lines.push(`- **β-折叠**: ${state.ss.beta_sheet_pct}% (${state.ss.ss_counts.beta_sheet} 残基)`);
      lines.push(`- **转角**: ${state.ss.turn_pct}% (${state.ss.ss_counts.turn} 残基)`);
      lines.push(`- **无规卷曲**: ${state.ss.coil_pct}% (${state.ss.ss_counts.coil} 残基)`);
      lines.push("");
    }

    // B-factor
    if (state.bfactor) {
      lines.push("## 5. B-factor / pLDDT 统计");
      lines.push("");
      lines.push("| 链 | 均值 | 最小 | 最大 | 标准差 | 类型 |");
      lines.push("|---|---|---|---|---|---|");
      for (const [chain, info] of Object.entries(state.bfactor.chains)) {
        lines.push(`| ${chain} | ${info.mean} | ${info.min} | ${info.max} | ${info.std} | ${info.is_plddt ? "pLDDT" : "B-factor"} |`);
      }
      lines.push("");
    }

    // SASA
    if (state.sasa) {
      lines.push("## 6. 溶剂可及表面积 (SASA)");
      lines.push("");
      lines.push(`- **总 SASA**: ${state.sasa.total_sasa_A2.toFixed(2)} Å²`);
      lines.push(`- **链数**: ${state.sasa.n_chains}`);
      lines.push("");
      lines.push("| 链 | SASA (Å²) | 占比 |");
      lines.push("|---|---|---|");
      for (const [chain, sasa] of Object.entries(state.sasa.chain_sasa_A2)) {
        const pct = (sasa / state.sasa.total_sasa_A2) * 100;
        lines.push(`| ${chain} | ${sasa.toFixed(2)} | ${pct.toFixed(1)}% |`);
      }
      lines.push("");
    }

    // Disulfide bonds
    if (state.disulfide) {
      lines.push("## 7. 二硫键");
      lines.push("");
      lines.push(`- **检测数**: ${state.disulfide.count} (截断 ${state.disulfide.cutoff} Å)`);
      if (state.disulfide.bonds.length > 0) {
        lines.push("");
        lines.push("| 残基 1 | 残基 2 | 距离 (Å) |");
        lines.push("|---|---|---|");
        for (const bond of state.disulfide.bonds) {
          lines.push(`| CYS${bond.resno1} (${bond.chain1}) | CYS${bond.resno2} (${bond.chain2}) | ${bond.distance_A.toFixed(3)} |`);
        }
      }
      lines.push("");
    }

    // Oligomer
    if (state.oligomer) {
      lines.push("## 8. 寡聚体分析");
      lines.push("");
      lines.push(`- **寡聚类型**: ${state.oligomer.oligomer_type}`);
      lines.push(`- **链数**: ${state.oligomer.n_chains}`);
      lines.push(`- **界面数**: ${state.oligomer.n_interfaces}`);
      lines.push(`- **对称性**: ${state.oligomer.is_homomer ? "同源寡聚体" : "异源寡聚体"}`);
      if (state.oligomer.interfaces.length > 0) {
        lines.push("");
        lines.push("### 链间界面");
        lines.push("");
        lines.push("| 链 1 | 链 2 | 接触原子数 | 最小距离 (Å) |");
        lines.push("|---|---|---|---|");
        for (const iface of state.oligomer.interfaces) {
          lines.push(`| ${iface.chain1} | ${iface.chain2} | ${iface.contact_atoms} | ${iface.min_distance_A.toFixed(2)} |`);
        }
      }
      lines.push("");
    }

    // Errors
    if (state.errors.length > 0) {
      lines.push("## ⚠️ 失败的分析");
      lines.push("");
      for (const err of state.errors) {
        lines.push(`- ${err}`);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("");
    lines.push("*报告由 MolCraft AI 自动生成 · 基于 Molstar + Biopython + FreeSASA*");

    const md = lines.join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overview-${label.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast("概览报告 (Markdown) 已导出", "success");
  }, [state, activeId, activeStructure, toast]);

  /** Export all analysis results as a styled HTML report */
  const handleExportHtml = useCallback(() => {
    if (!state.loaded || !activeId) return;
    const label = activeStructure?.label ?? activeId;
    const date = new Date().toLocaleString("zh-CN");
    const qualityColor = state.validation ? QUALITY_META[state.validation.quality].color : "#6b7280";
    const qualityLabel = state.validation ? QUALITY_META[state.validation.quality].label : "—";

    const card = (title: string, content: string, bg = "#f8fafc") =>
      `<div style="background:${bg};border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-bottom:12px"><h3 style="margin:0 0 8px;color:#0f766e;font-size:13px;border-bottom:1px solid #e2e8f0;padding-bottom:4px">${title}</h3>${content}</div>`;

    const metric = (label: string, value: string, color: string) =>
      `<div style="text-align:center;padding:8px;border:1px solid #e2e8f0;border-radius:6px;background:#fff"><div style="font-size:9px;color:#64748b;text-transform:uppercase">${label}</div><div style="font-family:monospace;font-weight:bold;font-size:14px;color:${color}">${value}</div></div>`;

    let html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>结构概览报告: ${label}</title><style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:900px;margin:20px auto;padding:0 16px;color:#1e293b;line-height:1.5}h1{color:#0f766e;border-bottom:2px solid #0f766e;padding-bottom:6px}h2{color:#0369a1;margin-top:20px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd5e1;padding:4px 8px;text-align:left}th{background:#f1f5f9}.meta{color:#64748b;font-size:11px}</style></head><body>`;
    html += `<h1>🔬 结构概览报告: ${label}</h1><p class="meta">生成时间: ${date} · MolCraft AI · 8 项并行分析</p>`;

    // Identity + Quality
    html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">';
    if (state.summary) {
      html += card("结构标识", `<div style="font-family:monospace;font-size:16px;font-weight:bold">${label}</div><div style="font-size:11px;color:#64748b">${state.summary.chain_count} 链 · ${state.summary.total_residues} 残基 · ${state.summary.total_atoms} 原子</div>`, "#ecfdf5");
    }
    if (state.validation) {
      html += card("质量评分", `<div style="font-size:16px;font-weight:bold;color:${qualityColor}">${qualityLabel}</div><div style="font-size:11px;color:#64748b">碰撞 ${state.validation.clash_count} · 拉氏异常 ${state.validation.rama_outlier_pct}% · 缺侧链 ${state.validation.missing_sidechain_count}</div>`, qualityColor + "15");
    }
    html += '</div>';

    // Key metrics
    html += '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px">';
    if (state.rama) html += metric("偏好区", `${state.rama.favoured_pct}%`, "#10b981");
    if (state.ss) html += metric("α/β 比", `${state.ss.alpha_helix_pct}/${state.ss.beta_sheet_pct}`, "#3b82f6");
    if (state.bfactor) {
      const first = Object.values(state.bfactor.chains)[0];
      html += metric("B 均值", first ? first.mean.toFixed(1) : "—", "#8b5cf6");
    }
    if (state.sasa) html += metric("总 SASA", `${(state.sasa.total_sasa_A2 / 1000).toFixed(1)}k`, "#06b6d4");
    html += '</div>';

    // Summary
    if (state.summary) {
      let table = '<table><thead><tr><th>链</th><th>残基</th><th>原子</th><th>范围</th></tr></thead><tbody>';
      for (const [chain, info] of Object.entries(state.summary.chains)) {
        table += `<tr><td><b>${chain}</b></td><td>${info.residue_count}</td><td>${info.atom_count}</td><td>${info.first_resno}-${info.last_resno}</td></tr>`;
      }
      table += '</tbody></table>';
      const ligands = Object.keys(state.summary.ligands).length > 0
        ? `<p><b>配体:</b> ${Object.entries(state.summary.ligands).map(([k, v]) => `${k}${v > 1 ? `×${v}` : ""}`).join(", ")}</p>`
        : "";
      html += card("1. 结构摘要", `<p><b>链数:</b> ${state.summary.chain_count} · <b>总残基:</b> ${state.summary.total_residues} · <b>总原子:</b> ${state.summary.total_atoms} · <b>含氢:</b> ${state.summary.has_hydrogens ? "是" : "否"}</p>${ligands}${table}`);
    }

    // Validation
    if (state.validation) {
      html += card("2. 结构质量验证", `<p><b>质量评分:</b> <span style="color:${qualityColor};font-weight:bold">${qualityLabel}</span></p><p><b>原子碰撞:</b> ${state.validation.clash_count} · <b>Ramachandran 异常:</b> ${state.validation.rama_outlier_pct}% (${state.validation.rama_outlier_count}/${state.validation.total_phi_psi}) · <b>缺失侧链:</b> ${state.validation.missing_sidechain_count}</p>`);
    }

    // Ramachandran
    if (state.rama) {
      html += card("3. Ramachandran 分析", `<p><b>总残基:</b> ${state.rama.total_residues} · <b>偏好区:</b> ${state.rama.favoured_pct}% · <b>异常区:</b> ${state.rama.outlier_pct}%</p>`);
    }

    // Secondary structure
    if (state.ss) {
      html += card("4. 二级结构组成", `<p><b>α-螺旋:</b> ${state.ss.alpha_helix_pct}% (${state.ss.ss_counts.alpha_helix}) · <b>β-折叠:</b> ${state.ss.beta_sheet_pct}% (${state.ss.ss_counts.beta_sheet}) · <b>转角:</b> ${state.ss.turn_pct}% (${state.ss.ss_counts.turn}) · <b>卷曲:</b> ${state.ss.coil_pct}% (${state.ss.ss_counts.coil})</p>`);
    }

    // B-factor
    if (state.bfactor) {
      let table = '<table><thead><tr><th>链</th><th>均值</th><th>最小</th><th>最大</th><th>标准差</th><th>类型</th></tr></thead><tbody>';
      for (const [chain, info] of Object.entries(state.bfactor.chains)) {
        table += `<tr><td><b>${chain}</b></td><td>${info.mean}</td><td>${info.min}</td><td>${info.max}</td><td>${info.std}</td><td>${info.is_plddt ? "pLDDT" : "B-factor"}</td></tr>`;
      }
      table += '</tbody></table>';
      html += card("5. B-factor / pLDDT 统计", table);
    }

    // SASA
    if (state.sasa) {
      let table = '<table><thead><tr><th>链</th><th>SASA (Å²)</th><th>占比</th></tr></thead><tbody>';
      for (const [chain, sasa] of Object.entries(state.sasa.chain_sasa_A2)) {
        table += `<tr><td><b>${chain}</b></td><td>${sasa.toFixed(2)}</td><td>${((sasa / state.sasa.total_sasa_A2) * 100).toFixed(1)}%</td></tr>`;
      }
      table += '</tbody></table>';
      html += card("6. 溶剂可及表面积 (SASA)", `<p><b>总 SASA:</b> ${state.sasa.total_sasa_A2.toFixed(2)} Å² · <b>链数:</b> ${state.sasa.n_chains}</p>${table}`);
    }

    // Disulfide
    if (state.disulfide) {
      let content = `<p><b>检测数:</b> ${state.disulfide.count} (截断 ${state.disulfide.cutoff} Å)</p>`;
      if (state.disulfide.bonds.length > 0) {
        let table = '<table><thead><tr><th>残基 1</th><th>残基 2</th><th>距离 (Å)</th></tr></thead><tbody>';
        for (const bond of state.disulfide.bonds) {
          table += `<tr><td>CYS${bond.resno1} (${bond.chain1})</td><td>CYS${bond.resno2} (${bond.chain2})</td><td>${bond.distance_A.toFixed(3)}</td></tr>`;
        }
        table += '</tbody></table>';
        content += table;
      }
      html += card("7. 二硫键", content);
    }

    // Oligomer
    if (state.oligomer) {
      let content = `<p><b>寡聚类型:</b> ${state.oligomer.oligomer_type} · <b>链数:</b> ${state.oligomer.n_chains} · <b>界面数:</b> ${state.oligomer.n_interfaces} · <b>对称性:</b> ${state.oligomer.is_homomer ? "同源" : "异源"}</p>`;
      if (state.oligomer.interfaces.length > 0) {
        let table = '<table><thead><tr><th>链 1</th><th>链 2</th><th>接触原子数</th><th>最小距离 (Å)</th></tr></thead><tbody>';
        for (const iface of state.oligomer.interfaces) {
          table += `<tr><td><b>${iface.chain1}</b></td><td><b>${iface.chain2}</b></td><td>${iface.contact_atoms}</td><td>${iface.min_distance_A.toFixed(2)}</td></tr>`;
        }
        table += '</tbody></table>';
        content += table;
      }
      html += card("8. 寡聚体分析", content);
    }

    // Errors
    if (state.errors.length > 0) {
      let content = '<ul>';
      for (const err of state.errors) {
        content += `<li style="font-family:monospace;font-size:11px">${err}</li>`;
      }
      content += '</ul>';
      html += card("⚠️ 失败的分析", content, "#fef2f2");
    }

    html += '<hr><p style="text-align:center;color:#64748b;font-size:11px">报告由 MolCraft AI 自动生成 · 基于 Molstar + Biopython + FreeSASA</p>';
    html += '</body></html>';

    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `overview-${label.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast("概览报告 (HTML) 已导出", "success");
  }, [state, activeId, activeStructure, toast]);

  /** Capture a screenshot of the current Molstar viewport */
  const handleScreenshot = useCallback(async () => {
    if (!viewer) {
      toast("查看器未就绪", "error");
      return;
    }
    try {
      const plugin = viewer.plugin as any;
      const dataUri = await plugin?.helpers?.viewportScreenshot?.getImageDataUri({
        width: 1920,
        height: 1080,
        transparency: false,
        axes: true,
      });
      if (!dataUri) {
        toast("截图失败: 无图像数据", "error");
        return;
      }
      const label = activeStructure?.label ?? activeId ?? "structure";
      const a = document.createElement("a");
      a.href = dataUri;
      a.download = `overview-screenshot-${label.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}-${Date.now()}.png`;
      a.click();
      toast("视口截图已下载", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`截图失败: ${msg}`, "error");
    }
  }, [viewer, activeStructure, activeId, toast]);

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="dashboard-header flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <LayoutDashboard className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">结构概览仪表盘</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                disabled={loading || !state.loaded}
                title="导出概览报告"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-48 p-1" sideOffset={4}>
              <button
                onClick={handleExport}
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
                  <div className="text-[9px] text-muted-foreground">带样式,可直接打开</div>
                </div>
              </button>
            </PopoverContent>
          </Popover>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleScreenshot}
            disabled={!viewer}
            title="截图当前视口 (PNG)"
          >
            <Camera className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchAll}
            disabled={loading}
            title="重新分析"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {/* Loading progress */}
        {loading && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-muted-foreground">正在并行运行 8 项分析…</span>
              <span className="font-mono text-primary">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="grid grid-cols-4 gap-1">
              {["摘要", "Ramachandran", "二级结构", "B-factor", "SASA", "二硫键", "寡聚体", "验证"].map((label, i) => {
                const done = progressRef.current > i;
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-center rounded border p-1 text-[9px] transition ${
                      done
                        ? "border-emerald-500/40 bg-emerald-500/5 text-emerald-600"
                        : "border-muted bg-muted/20 text-muted-foreground"
                    }`}
                  >
                    {done ? "✓" : "…"} {label}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Errors */}
        {state.errors.length > 0 && !loading && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[10px] text-amber-700">
            <div className="font-medium">部分分析失败 ({state.errors.length}):</div>
            <div className="mt-0.5 space-y-0.5">
              {state.errors.slice(0, 3).map((err, i) => (
                <div key={i} className="font-mono text-[9px] truncate">
                  {err}
                </div>
              ))}
              {state.errors.length > 3 && (
                <div className="text-[9px]">+{state.errors.length - 3} 更多</div>
              )}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && !state.loaded && !activeId && (
          <div className="py-6 text-center text-[11px] text-muted-foreground">
            <LayoutDashboard className="mx-auto mb-1 h-8 w-8 text-muted-foreground/40" />
            加载一个结构以生成综合概览
          </div>
        )}

        {/* Loaded content */}
        {!loading && state.loaded && (
          <div className="space-y-3">
            {/* Row 1: Identity + Quality banner */}
            <div className="grid grid-cols-2 gap-2">
              {/* Identity card */}
              <div className="rounded-md border bg-primary/5 p-2">
                <div className="mb-1 flex items-center gap-1 text-[9px] font-medium uppercase text-muted-foreground">
                  <Microscope className="h-3 w-3 text-primary" />
                  结构标识
                </div>
                <div className="font-mono text-sm font-bold text-foreground">
                  {activeStructure?.label ?? activeId}
                </div>
                <div className="mt-0.5 text-[9px] text-muted-foreground">
                  {state.summary ? `${state.summary.chain_count} 链 · ${state.summary.total_residues} 残基 · ${state.summary.total_atoms} 原子` : "—"}
                </div>
              </div>

              {/* Quality card */}
              {state.validation ? (
                <div
                  className="rounded-md border p-2"
                  style={{
                    borderColor: QUALITY_META[state.validation.quality].color + "60",
                    background: `linear-gradient(135deg, ${QUALITY_META[state.validation.quality].bg} 0%, transparent 70%)`,
                  }}
                >
                  <div className="mb-1 flex items-center justify-between text-[9px] font-medium uppercase text-muted-foreground">
                    <span>质量评分</span>
                    <span
                      className="rounded px-1.5 py-0 text-[9px] font-bold"
                      style={{
                        color: QUALITY_META[state.validation.quality].color,
                        backgroundColor: QUALITY_META[state.validation.quality].bg,
                      }}
                    >
                      {QUALITY_META[state.validation.quality].label}
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[9px]">
                    <div>
                      <span className="text-muted-foreground">碰撞: </span>
                      <span className={state.validation.clash_count > 3 ? "text-red-600 font-bold" : "text-foreground"}>
                        {state.validation.clash_count}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">拉氏: </span>
                      <span className={state.validation.rama_outlier_pct > 5 ? "text-red-600 font-bold" : state.validation.rama_outlier_pct > 2 ? "text-amber-600 font-bold" : "text-emerald-600 font-bold"}>
                        {state.validation.rama_outlier_pct}%
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">缺侧链: </span>
                      <span className={state.validation.missing_sidechain_count > 1 ? "text-amber-600 font-bold" : "text-foreground"}>
                        {state.validation.missing_sidechain_count}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-2 text-center text-[10px] text-muted-foreground">
                  验证数据不可用
                </div>
              )}
            </div>

            {/* Row 2: Geometry metrics */}
            <div className="grid grid-cols-4 gap-1.5">
              {/* Ramachandran */}
              <MetricCard
                icon={<Activity className="h-3 w-3" />}
                label="偏好区"
                value={state.rama ? `${state.rama.favoured_pct}%` : "—"}
                color={state.rama && state.rama.favoured_pct > 90 ? "#10b981" : state.rama && state.rama.favoured_pct > 80 ? "#f59e0b" : "#ef4444"}
              />
              {/* Secondary structure */}
              <MetricCard
                icon={<Box className="h-3 w-3" />}
                label="α/β 比"
                value={state.ss ? `${state.ss.alpha_helix_pct}/${state.ss.beta_sheet_pct}` : "—"}
                color="#3b82f6"
              />
              {/* B-factor mean */}
              <MetricCard
                icon={<Zap className="h-3 w-3" />}
                label="B 均值"
                value={state.bfactor ? (() => {
                  const first = Object.values(state.bfactor.chains)[0];
                  return first ? first.mean.toFixed(1) : "—";
                })() : "—"}
                color="#8b5cf6"
              />
              {/* Total SASA */}
              <MetricCard
                icon={<SunMedium className="h-3 w-3" />}
                label="总 SASA"
                value={state.sasa ? `${(state.sasa.total_sasa_A2 / 1000).toFixed(1)}k` : "—"}
                color="#06b6d4"
              />
            </div>

            {/* Row 3: Secondary structure composition bar */}
            {state.ss && state.ss.total_residues > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-1 text-[10px] font-medium">
                  <Box className="h-3 w-3 text-blue-500" />
                  二级结构组成
                </div>
                <div className="flex h-6 overflow-hidden rounded border">
                  {(["alpha_helix", "beta_sheet", "turn", "coil"] as const).map((key) => {
                    const pct = state.ss!.ss_counts[key];
                    const totalPct = state.ss![`${key}_pct` as keyof SsData] as number;
                    if (totalPct === 0) return null;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-center text-[8px] font-bold text-white"
                        style={{
                          width: `${totalPct}%`,
                          backgroundColor: SS_COLORS[key],
                        }}
                        title={`${SS_LABELS[key]}: ${pct} 残基 (${totalPct}%)`}
                      >
                        {totalPct >= 10 ? `${totalPct}%` : ""}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[9px]">
                  {(["alpha_helix", "beta_sheet", "turn", "coil"] as const).map((key) => (
                    <div key={key} className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-sm" style={{ backgroundColor: SS_COLORS[key] }} />
                      <span className="text-muted-foreground">{SS_LABELS[key]}</span>
                      <span className="font-mono">{state.ss!.ss_counts[key]}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Row 4: Oligomer + Disulfide + Ligands */}
            <div className="grid grid-cols-3 gap-1.5">
              {/* Oligomer */}
              {state.oligomer && (
                <div className="rounded-md border bg-blue-500/5 p-2">
                  <div className="mb-0.5 flex items-center gap-1 text-[9px] font-medium uppercase text-muted-foreground">
                    <Layers className="h-3 w-3 text-blue-500" />
                    寡聚状态
                  </div>
                  <div className="font-mono text-xs font-bold text-blue-600">
                    {state.oligomer.oligomer_type}
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    {state.oligomer.n_chains} 链 · {state.oligomer.n_interfaces} 界面
                  </div>
                </div>
              )}

              {/* Disulfide bonds */}
              {state.disulfide && (
                <div className="rounded-md border bg-amber-500/5 p-2">
                  <div className="mb-0.5 flex items-center gap-1 text-[9px] font-medium uppercase text-muted-foreground">
                    <Link2 className="h-3 w-3 text-amber-500" />
                    二硫键
                  </div>
                  <div className="font-mono text-xs font-bold text-amber-600">
                    {state.disulfide.count} 个
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    CYS-CYS &lt; {state.disulfide.cutoff}Å
                  </div>
                </div>
              )}

              {/* Ligands */}
              {state.summary && Object.keys(state.summary.ligands).length > 0 && (
                <div className="rounded-md border bg-violet-500/5 p-2">
                  <div className="mb-0.5 flex items-center gap-1 text-[9px] font-medium uppercase text-muted-foreground">
                    <FlaskConical className="h-3 w-3 text-violet-500" />
                    配体
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {Object.entries(state.summary.ligands).slice(0, 4).map(([lig, count]) => (
                      <span
                        key={lig}
                        className="rounded bg-violet-500/15 px-1 font-mono text-[9px] text-violet-700"
                      >
                        {lig}
                        {count > 1 ? `×${count}` : ""}
                      </span>
                    ))}
                    {Object.keys(state.summary.ligands).length > 4 && (
                      <span className="text-[9px] text-muted-foreground">
                        +{Object.keys(state.summary.ligands).length - 4}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Row 5: Chain summary table */}
            {state.summary && Object.keys(state.summary.chains).length > 0 && (
              <div>
                <div className="mb-1 flex items-center gap-1 text-[10px] font-medium">
                  <Layers className="h-3 w-3 text-muted-foreground" />
                  链详情
                </div>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full border-collapse text-[10px]">
                    <thead>
                      <tr>
                        <th className="border-b bg-muted/30 px-1.5 py-0.5 text-left font-medium text-muted-foreground">链</th>
                        <th className="border-b bg-muted/30 px-1.5 py-0.5 text-right font-medium text-muted-foreground">残基</th>
                        <th className="border-b bg-muted/30 px-1.5 py-0.5 text-right font-medium text-muted-foreground">原子</th>
                        <th className="border-b bg-muted/30 px-1.5 py-0.5 text-right font-medium text-muted-foreground">范围</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(state.summary.chains).map(([chain, info]) => (
                        <tr key={chain}>
                          <td className="px-1.5 py-0.5 font-mono font-bold text-foreground">{chain}</td>
                          <td className="px-1.5 py-0.5 text-right font-mono">{info.residue_count}</td>
                          <td className="px-1.5 py-0.5 text-right font-mono">{info.atom_count}</td>
                          <td className="px-1.5 py-0.5 text-right font-mono text-[9px] text-muted-foreground">
                            {info.first_resno}-{info.last_resno}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                综合概览: 并行运行 8 项分析 (摘要 / Ramachandran / 二级结构 / B-factor / SASA / 二硫键 / 寡聚体 / 验证),一屏掌握结构全局特征。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact metric card */
function MetricCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-md border bg-card p-1.5 text-center">
      <div className="mb-0.5 flex items-center justify-center gap-0.5 text-[9px] uppercase text-muted-foreground">
        <span style={{ color }}>{icon}</span>
        {label}
      </div>
      <div className="font-mono text-xs font-bold" style={{ color }}>
        {value}
      </div>
    </div>
  );
}
