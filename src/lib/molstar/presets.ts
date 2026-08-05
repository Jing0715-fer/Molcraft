/**
 * Catalog of Molstar representation presets, color themes, and example
 * structures. Mirrors the values documented in the viewer-docs / source.
 */

export interface CatalogEntry {
  id: string;
  label: string;
  description: string;
}

/** Representation presets applicable via `managers.structure.component.applyPreset`. */
export const REPRESENTATION_PRESETS: CatalogEntry[] = [
  {
    id: "auto",
    label: "自动 (Auto)",
    description: "智能选择：大分子用 cartoon，小分子用 ball-and-stick",
  },
  {
    id: "atomic-detail",
    label: "原子细节 (Atomic Detail)",
    description: "全部原子 ball-and-stick，适合配体/活性位点",
  },
  {
    id: "polymer-cartoon",
    label: "聚合物卡通 (Polymer Cartoon)",
    description: "仅显示大分子的 cartoon",
  },
  {
    id: "polymer-and-ligand",
    label: "大分子 + 配体",
    description: "蛋白/核酸 cartoon，配体 ball-and-stick",
  },
  {
    id: "protein-and-nucleic",
    label: "蛋白 + 核酸",
    description: "蛋白 cartoon，核酸 sugar-pucker/gaussian",
  },
  {
    id: "coarse-surface",
    label: "粗糙表面 (Coarse Surface)",
    description: "外表面 + cartoon 概览，适合大复合物",
  },
  {
    id: "illustrative",
    label: "插画风格 (Illustrative)",
    description: "扁平卡通 + 边缘描边，论文配图首选",
  },
  {
    id: "molecular-surface",
    label: "分子表面",
    description: "可及/溶剂表面，分析结合位点",
  },
  {
    id: "auto-lod",
    label: "LOD 自动",
    description: "基于相机距离的层级细节",
  },
  {
    id: "mesoscale",
    label: "介观 (Mesoscale)",
    description: "粗粒化球体表示巨大结构",
  },
  {
    id: "empty",
    label: "清空表示",
    description: "不显示任何表示，仅保留结构数据",
  },
];

/** Individual representation types usable via `representation.addRepresentation`. */
export const REPRESENTATION_TYPES: CatalogEntry[] = [
  { id: "cartoon", label: "Cartoon 卡通", description: "二级结构骨架" },
  { id: "ball-and-stick", label: "Ball & Stick", description: "球棍模型" },
  { id: "spacefill", label: "Spacefill 空间填充", description: "范德华球" },
  { id: "line", label: "Line 线框", description: "键线" },
  { id: "point", label: "Point 点", description: "原子点" },
  { id: "cross", label: "Cross 十字", description: "原子十字" },
  {
    id: "molecular-surface",
    label: "Molecular Surface",
    description: "分子表面（可及/溶剂）",
  },
  {
    id: "gaussian-surface",
    label: "Gaussian Surface",
    description: "高斯密度表面",
  },
  { id: "orientation", label: "Orientation", description: "取向椭球" },
  { id: "label", label: "Label", description: "文字标签" },
];

/** Color theme names applicable via `updateRepresentationsTheme({ color })`. */
export const COLOR_THEMES: CatalogEntry[] = [
  { id: "uniform", label: "Uniform 统一色", description: "所有原子同色" },
  { id: "chain", label: "Chain 链", description: "按聚合物链着色" },
  { id: "entity", label: "Entity", description: "按实体着色" },
  { id: "sequence-id", label: "Sequence 残基序号", description: "N→C 渐变" },
  { id: "residue-name", label: "残基名", description: "按氨基酸/核苷酸类型" },
  { id: "element-symbol", label: "Element 元素", description: "CPK 元素色" },
  { id: "secondary-structure", label: "二级结构", description: "α/β/coil 区分" },
  {
    id: "hydrophobicity",
    label: "Hydrophobicity",
    description: "疏水性梯度（蓝→白→橙）",
  },
  { id: "occupancy", label: "Occupancy", description: "占据率" },
  { id: "uncertainty", label: "B-factor", description: "不确定性/B 因子" },
  { id: "illustrative", label: "Illustrative", description: "扁平插画色板" },
  {
    id: "partial-charge",
    label: "Partial Charge",
    description: "部分电荷（需扩展）",
  },
  {
    id: "entity-source",
    label: "Entity Source",
    description: "按来源物种着色",
  },
];

/** Selection granularity for interactivity. */
export const SELECTION_GRANULARITY: CatalogEntry[] = [
  { id: "element", label: "Element 原子", description: "单个原子" },
  { id: "residue", label: "Residue 残基", description: "整残基" },
  { id: "chain", label: "Chain 链", description: "整条链" },
  { id: "structure", label: "Structure", description: "整个结构" },
];

/** Curated example PDB entries for quick demo. */
export const EXAMPLE_STRUCTURES: Array<{
  id: string;
  label: string;
  description: string;
  source: "pdb" | "alphafold" | "emdb";
}> = [
  {
    id: "1cbs",
    label: "1CBS — Retinoic Acid Binding Protein",
    description: "细胞视黄酸结合蛋白，含配体 REA",
    source: "pdb",
  },
  {
    id: "1tqn",
    label: "1TQN — Thrombin Complex",
    description: "凝血酶与抑制剂复合物",
    source: "pdb",
  },
  {
    id: "6z1w",
    label: "6Z1W — SARS-CoV-2 Polymerase",
    description: "新冠病毒 RNA 依赖 RNA 聚合酶",
    source: "pdb",
  },
  {
    id: "6lu7",
    label: "6LU7 — SARS-CoV-2 Mpro",
    description: "主蛋白酶 Mpro 与抑制剂 N3",
    source: "pdb",
  },
  {
    id: "4hhb",
    label: "4HHB — Hemoglobin",
    description: "脱氧血红蛋白，经典 α2β2 四聚体",
    source: "pdb",
  },
  {
    id: "1bna",
    label: "1BNA — DNA Dodecamer",
    description: "B 型 DNA 十二聚体",
    source: "pdb",
  },
  {
    id: "7rkp",
    label: "7RKP — GPCR β2 Adrenergic Receptor",
    description: "β2 肾上腺素受体 GPCR",
    source: "pdb",
  },
  {
    id: "P00533",
    label: "AF-P00533 — EGFR (AlphaFold)",
    description: "表皮生长因子受体 AlphaFold 预测",
    source: "alphafold",
  },
  {
    id: "EMD-30210",
    label: "EMD-30210 — EM Density",
    description: "冷冻电镜密度图示例",
    source: "emdb",
  },
];

/** Built-in animation types. */
export const ANIMATIONS: CatalogEntry[] = [
  { id: "spin", label: "Spin 旋转", description: "绕固定轴持续旋转" },
  { id: "rock", label: "Rock 摇摆", description: "在角度范围内来回摇摆" },
  { id: "stop", label: "Stop 停止", description: "停止所有动画" },
];

/** Snapshot/session export types. */
export const SNAPSHOT_TYPES: CatalogEntry[] = [
  {
    id: "molj",
    label: "molj (JSON)",
    description: "可读 JSON 状态，便于版本管理",
  },
  {
    id: "molx",
    label: "molx (Binary)",
    description: "二进制状态，体积更小",
  },
];

/** Color palette for quick UI swatches. */
export const COLOR_SWATCHES = [
  { name: "Emerald", value: 0x10b981 },
  { name: "Rose", value: 0xf43f5e },
  { name: "Amber", value: 0xf59e0b },
  { name: "Cyan", value: 0x06b6d4 },
  { name: "Violet", value: 0x8b5cf6 },
  { name: "Slate", value: 0x475569 },
  { name: "Lime", value: 0x84cc16 },
  { name: "Orange", value: 0xf97316 },
];
