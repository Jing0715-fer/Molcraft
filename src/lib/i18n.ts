/**
 * Simple bilingual (CN/EN) translation system.
 * Usage: const { t } = useLang(); t("structures") → "结构" or "Structures"
 */

import { useState, useEffect, useCallback } from "react";

export type Lang = "zh" | "en";

// All UI strings
const STRINGS: Record<string, { zh: string; en: string }> = {
  // Tabs
  structures: { zh: "结构", en: "Structures" },
  measure: { zh: "测量", en: "Measure" },
  analysis: { zh: "分析", en: "Analysis" },
  volume: { zh: "体积", en: "Volume" },
  export: { zh: "导出", en: "Export" },
  // Panel headers
  tools_analysis: { zh: "工具与分析", en: "Tools & Analysis" },
  ai_assistant: { zh: "AI 助手", en: "AI Assistant" },
  reports: { zh: "报告", en: "Reports" },
  // Structure list
  no_structure: { zh: "尚未加载结构", en: "No structure loaded" },
  no_structure_hint: { zh: "在顶部搜索栏输入 PDB ID 加载", en: "Enter a PDB ID in the search bar above" },
  global_controls: { zh: "全局控制", en: "Global" },
  reset_view: { zh: "重置视角", en: "Reset View" },
  spin: { zh: "旋转", en: "Spin" },
  stop_spin: { zh: "停止旋转", en: "Stop Spin" },
  // Measure
  atom_a: { zh: "原子 A", en: "Atom A" },
  atom_b: { zh: "原子 B", en: "Atom B" },
  measure_distance: { zh: "测量距离", en: "Measure Distance" },
  add_label: { zh: "添加标签", en: "Add Label" },
  clear_measurements: { zh: "清除测量", en: "Clear Measurements" },
  // Analysis
  interaction_viz: { zh: "3D 互作可视化", en: "3D Interaction Viz" },
  center_residue: { zh: "中心残基", en: "Center Residue" },
  radius: { zh: "半径 (Å)", en: "Radius (Å)" },
  show_interactions: { zh: "显示互作", en: "Show Interactions" },
  clear: { zh: "清除", en: "Clear" },
  // Volume
  emdb_id: { zh: "EMDB ID", en: "EMDB ID" },
  load: { zh: "加载", en: "Load" },
  // Export
  width: { zh: "宽", en: "Width" },
  height: { zh: "高", en: "Height" },
  download_png: { zh: "下载 PNG", en: "Download PNG" },
  save_session: { zh: "保存会话 (molj)", en: "Save Session (molj)" },
  // Inline controls
  representation: { zh: "表示", en: "Representation" },
  color_scheme: { zh: "着色方案", en: "Color Scheme" },
  apply_repr: { zh: "应用表示", en: "Apply Repr" },
  apply_color: { zh: "应用着色", en: "Apply Color" },
  custom_color: { zh: "选择颜色使用自定义着色", en: "Pick color for custom" },
  apply_custom: { zh: "应用自定义色", en: "Apply Custom" },
  cancel: { zh: "取消", en: "Cancel" },
  // Structure actions
  hide: { zh: "隐藏", en: "Hide" },
  show: { zh: "显示", en: "Show" },
  close_structure: { zh: "关闭结构", en: "Close Structure" },
  align_to: { zh: "比对到此结构", en: "Align to This" },
  align_ref: { zh: "比对到此参考结构", en: "Align to Reference" },
  reference: { zh: "参考", en: "Reference" },
  // Chat
  deep_analysis: { zh: "深度结构分析 · 真实数据驱动", en: "Deep Structural Analysis · Real Data" },
  ai_desc: { zh: "AI 调用 RCSB API + 本地工具获取真实数据", en: "AI calls RCSB API + local tools for real data" },
  quick_start: { zh: "快速开始", en: "Quick Start" },
  chat_placeholder: { zh: "描述你想做的分析… AI 会调用 RCSB API 和本地工具获取真实数据。 (Enter 发送)", en: "Describe your analysis... AI uses RCSB API + local tools. (Enter to send)" },
  // TopBar
  search_placeholder: { zh: "PDB ID / UniProt / EMD-xxxx", en: "PDB ID / UniProt / EMD-xxxx" },
  // Footer
  footer_text: { zh: "自然语言驱动 · 测量 · 互作分析 · 结构比对 · 图文报告", en: "NLP-driven · Measurement · Interactions · Alignment · Reports" },
  // Structure card tabs
  info: { zh: "信息", en: "Info" },
  style: { zh: "样式", en: "Style" },
  align: { zh: "比对", en: "Align" },
  // Structure card info
  source: { zh: "来源", en: "Source" },
  method: { zh: "方法", en: "Method" },
  resolution: { zh: "分辨率", en: "Resolution" },
  chains: { zh: "链", en: "Chains" },
  residues: { zh: "残基", en: "Residues" },
  atoms: { zh: "原子", en: "Atoms" },
  // Structure list header
  structures_count: { zh: "个 · 点击卡片展开", en: "open · click a card to expand" },
  clear_all: { zh: "全部清除", en: "Clear all" },
  no_structures_yet: { zh: "尚未加载结构", en: "No structures yet" },
  no_structures_hint: { zh: "在顶部搜索栏输入 PDB ID / UniProt / EMD-xxxx，或上传文件", en: "Use the search bar above to load your first protein" },
  // Measure toolbar
  distance: { zh: "距离", en: "Dist" },
  angle: { zh: "角度", en: "Angle" },
  measurements: { zh: "测量", en: "Measurements" },
  distance_measured: { zh: "距离测量", en: "Distance" },
  angle_measured: { zh: "角度测量", en: "Angle" },
  shown_in_3d: { zh: "已在 3D 视图中显示", en: "Shown in 3D viewer" },
  distance_added: { zh: "距离测量已添加", en: "Distance measurement added" },
  angle_added: { zh: "角度测量已添加", en: "Angle measurement added" },
  clear_all_measurements: { zh: "已清除所有测量", en: "Cleared all measurements" },
  reset_selection: { zh: "重置选择", en: "Reset selection" },
  exit_measure: { zh: "退出测量模式", en: "Exit measure mode" },
  // Align panel
  align_to_reference: { zh: "比对到参考结构", en: "Align onto reference" },
  select_reference: { zh: "选择参考结构…", en: "Select reference…" },
  align_description: { zh: "使用 Kabsch 叠合 对共享 Cα 原子进行最优叠合。移动结构将旋转平移到参考结构上,两者叠加显示在查看器中。", en: "Uses Kabsch superposition on shared Cα atoms. The mobile structure is rotated and translated onto the reference; both are shown overlaid." },
  run_alignment: { zh: "运行比对", en: "Run alignment" },
  need_other_structure: { zh: "加载至少一个其他结构进行比对", en: "Open at least one other structure to align against" },
  // Alignment history
  alignment_history: { zh: "比对历史", en: "Alignment history" },
  clear_history: { zh: "清空历史", en: "Clear history" },
  // Analysis charts
  analysis_charts: { zh: "分析图表", en: "Analysis charts" },
  search_charts: { zh: "搜索图表…", en: "Search charts…" },
  no_charts_found: { zh: "未找到匹配的图表", en: "No matching charts found" },
  // Chart categories
  overview: { zh: "概览", en: "Overview" },
  geometry: { zh: "几何分析", en: "Geometry" },
  interactions: { zh: "相互作用", en: "Interactions" },
  ligand_assembly: { zh: "配体与组装", en: "Ligand & Assembly" },
  quality: { zh: "质量评估", en: "Quality" },
  // Overview dashboard
  overview_dashboard: { zh: "结构概览仪表盘", en: "Structure Overview" },
  comparison_dashboard: { zh: "结构比较仪表盘", en: "Comparison Dashboard" },
  running_analysis: { zh: "正在并行运行", en: "Running" },
  analyses: { zh: "项分析…", en: "analyses…" },
  // Export
  export_report: { zh: "导出概览报告", en: "Export report" },
  export_markdown: { zh: "纯文本,适合 GitHub", en: "Plain text, for GitHub" },
  export_html: { zh: "带样式,可直接打开", en: "Styled, open in browser" },
  screenshot: { zh: "截图当前视口", en: "Capture viewport" },
  reanalyze: { zh: "重新分析", en: "Reanalyze" },
  // Structure quality
  quality_score: { zh: "质量评分", en: "Quality" },
  clashes: { zh: "碰撞", en: "Clashes" },
  rama_outlier: { zh: "拉氏异常", en: "Rama outlier" },
  missing_sidechain: { zh: "缺侧链", en: "Missing SC" },
  // Settings
  settings: { zh: "设置 (工具安装与管理)", en: "Settings (Tool Management)" },
};

// Global language state
let currentLang: Lang = "zh";
const listeners = new Set<() => void>();

export function setLang(lang: Lang) {
  currentLang = lang;
  listeners.forEach((fn) => fn());
}

export function getLang(): Lang {
  return currentLang;
}

/** Hook to get translation function + current language. */
export function useLang() {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const t = useCallback((key: string): string => {
    const entry = STRINGS[key];
    if (!entry) return key;
    return entry[currentLang];
  }, []);

  return { t, lang: currentLang, setLang };
}

