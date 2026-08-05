"use client";

import { create } from "zustand";
import type { MolstarViewer, MolstarPlugin } from "./molstar/types";

// ---- localStorage persistence helpers ----
const STORAGE_KEY_MESSAGES = "molcraft:messages";
const STORAGE_KEY_REPORTS = "molcraft:reports";

function loadFromStorage<T>(key: string): T[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMessagesToStorage(messages: ChatMessage[]): void {
  if (typeof window === "undefined") return;
  try {
    // Strip snapshot data URLs from older messages to save space
    const cleaned = messages.slice(-100).map((m, i) => ({
      ...m,
      // Keep snapshots only for the last 3 messages
      snapshot: i >= messages.length - 3 ? m.snapshot : undefined,
      snapshots: i >= messages.length - 3 ? m.snapshots : undefined,
    }));
    localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(cleaned));
  } catch {
    // localStorage full — try without any snapshots
    try {
      const cleaned = messages.slice(-20).map((m) => ({
        ...m,
        snapshot: undefined,
        snapshots: undefined,
      }));
      localStorage.setItem(STORAGE_KEY_MESSAGES, JSON.stringify(cleaned));
    } catch {
      /* give up */
    }
  }
}

function saveReportsToStorage(reports: AnalysisReport[]): void {
  if (typeof window === "undefined") return;
  try {
    // Keep snapshot only for the last 5 reports
    const cleaned = reports.slice(-50).map((r, i) => ({
      ...r,
      snapshot: i >= reports.length - 5 ? r.snapshot : undefined,
    }));
    localStorage.setItem(STORAGE_KEY_REPORTS, JSON.stringify(cleaned));
  } catch {
    /* give up */
  }
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Optional commands that were extracted from this assistant message. */
  commands?: unknown[];
  /** Optional attached snapshot data URL (for assistant turns that captured one). */
  snapshot?: string;
  /** Optional label for the snapshot (used in figure captions). */
  snapshotLabel?: string;
  /** ISO timestamp. */
  ts: number;
  /** Whether this message is still streaming / thinking. */
  pending?: boolean;
  /** Optional error message. */
  error?: string;
  /** Optional notes from VLM screenshot verification (e.g. "截图 X 角度可能不佳"). */
  cmdErrors?: string[];
}

export interface AnalysisReport {
  id: string;
  title: string;
  markdown: string;
  snapshot?: string;
  snapshots?: Array<{ label: string; dataUrl: string }>;
  createdAt: number;
}

export interface LoadedStructure {
  id: string; // pdb id or label
  label: string;
  source: "pdb" | "alphafold" | "emdb" | "url" | "file";
  loadedAt: number;
  /** The raw PDB text (for client-side alignment & analysis). */
  pdbText?: string;
  /** Color assigned to this structure (for list + viewer legend). */
  color?: string;
  /** Per-structure style (representation, colorScheme, opacity, singleColor). */
  style?: {
    representation: "cartoon" | "stick" | "line" | "sphere" | "surface";
    colorScheme: "chain" | "element" | "secondary" | "single" | "spectrum" | "bfactor" | "residue" | "charge";
    opacity: number;
    singleColor: string;
  };
  /** Optional metadata badges (populated from parsePdb or RCSB API). */
  metadata?: {
    chains?: string[];
    numAtoms?: number;
    numResidues?: number;
    method?: string;
    resolution?: number | null;
    title?: string;
    organism?: string;
  };
  /** Alignment transform (4x4 row-major) applied when this structure is the mobile. */
  transform?: number[][];
  /** Alignment result if this structure has been aligned (mobile side). */
  alignRmsd?: number;
  alignTmScore?: number;
}

export const DEFAULT_STYLE = {
  representation: "cartoon" as const,
  colorScheme: "spectrum" as const,
  opacity: 1,
  singleColor: "#6366f1",
};

export interface MolstarStateSnapshot {
  measurements: Array<{ kind: "distance" | "angle" | "dihedral" | "label"; label: string }>;
}

interface AppState {
  // Viewer
  viewer: MolstarViewer | null;
  plugin: MolstarPlugin | null;
  ready: boolean;
  setViewer: (v: MolstarViewer | null) => void;

  // Structures
  structures: LoadedStructure[];
  /** ID of the structure currently "focused" for analysis. Null = use structures[0]. */
  activeStructureId: string | null;
  addStructure: (s: LoadedStructure) => void;
  removeStructure: (id: string) => void;
  clearStructures: () => void;
  setActiveStructure: (id: string | null) => void;
  renameStructure: (id: string, label: string) => void;
  updateStructureStyle: (id: string, patch: Partial<NonNullable<LoadedStructure["style"]>>) => void;
  updateStructureMetadata: (id: string, metadata: LoadedStructure["metadata"]) => void;
  setStructureAlignment: (id: string, rmsd: number, tmScore?: number, transform?: number[][]) => void;
  /** Optional cached file content for non-PDB-ID structures (keyed by structure id). */
  structureFileCache: Record<string, { content: string; format: "pdb" | "cif" }>;
  setStructureFileCache: (id: string, content: string, format: "pdb" | "cif") => void;

  // UI
  leftPanelTab: "tools" | "sequence" | "analysis";
  setLeftPanelTab: (t: "tools" | "sequence" | "analysis") => void;
  rightPanelTab: "chat" | "reports" | "history";
  setRightPanelTab: (t: "chat" | "reports" | "history") => void;
  // Viewer background
  viewerBgDark: boolean;
  setViewerBgDark: (dark: boolean) => void;

  // Chat
  messages: ChatMessage[];
  addMessage: (m: ChatMessage) => void;
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void;
  clearChat: () => void;

  // Reports
  reports: AnalysisReport[];
  addReport: (r: AnalysisReport) => void;
  removeReport: (id: string) => void;

  // Last viewport snapshot (for attaching to reports)
  lastSnapshot: string | null;
  setLastSnapshot: (s: string | null) => void;

  // Active command log (most recent N executed commands)
  commandLog: Array<{ ts: number; type: string; ok: boolean; detail?: string }>;
  logCommand: (entry: { type: string; ok: boolean; detail?: string }) => void;

  /** Result of the most recent structure alignment (for the overlay panel). */
  lastAlignment: AlignmentResult | null;
  setLastAlignment: (a: AlignmentResult | null) => void;
  /** Full alignment history (借鉴 upload project). */
  alignmentHistory: AlignmentResult[];
  addAlignmentToHistory: (a: AlignmentResult) => void;
  clearAlignmentHistory: () => void;

  /** Click-to-measure mode in 3D viewer (借鉴 upload project). */
  measureMode: "off" | "distance" | "angle";
  setMeasureMode: (m: "off" | "distance" | "angle") => void;
  measurements: Array<{ id: string; mode: "distance" | "angle"; label: string; detail: string; ts: number }>;
  addMeasurement: (m: { mode: "distance" | "angle"; label: string; detail: string }) => void;
  removeMeasurement: (id: string) => void;
  clearMeasurements: () => void;

  // ----- Advanced visualization overlays (APBS / Druggability / Screening / Pockets) -----
  electrostaticViz: ElectrostaticViz | null;
  setElectrostaticViz: (v: ElectrostaticViz | null) => void;
  druggabilityViz: DruggabilityViz | null;
  setDruggabilityViz: (v: DruggabilityViz | null) => void;
  screeningViz: ScreeningViz | null;
  setScreeningViz: (v: ScreeningViz | null) => void;
  pocketDetectionViz: PocketDetectionViz | null;
  setPocketDetectionViz: (v: PocketDetectionViz | null) => void;

  // Session save/load (serialize/deserialize state to JSON)
  saveSession: () => string;
  loadSession: (data: unknown) => void;

  // Toast bus (lightweight)
  toast: (msg: string, kind?: "default" | "success" | "error" | "info") => void;
}

// ============================================================
// Advanced visualization state types
// ============================================================

export interface ElectrostaticViz {
  pdbId: string;
  chainFilter: string;
  ionicStrengthMm: number;
  debyeLengthA: number;
  forcefield: string;
  pdb2pqrUsed: boolean;
  numChargedAtoms: number;
  totalPotentialKcal: number;
  meanPotentialKcal: number;
  mostStabilizing: Array<{
    chain: string; resno: number; resname: string; atom: string;
    charge: number; potential_kcal_mol: number;
  }>;
  mostDestabilizing: Array<{
    chain: string; resno: number; resname: string; atom: string;
    charge: number; potential_kcal_mol: number;
  }>;
  surfaceCharged: Array<{
    chain: string; resno: number; resname: string; atom: string;
    charge: number; potential_kcal_mol: number;
  }>;
  createdAt: number;
}

export interface DruggabilityViz {
  pdbId: string;
  ligand: string;
  radiusA: number;
  pocketResidueCount: number;
  pocketVolumeA3: number;
  druggabilityScore: number;
  classification: string;
  composition: Record<string, number>;
  hydrophobicPct: number;
  polarPct: number;
  chargedPct: number;
  scoreBreakdown: {
    volume: number; hydrophobicity: number; polarity: number;
    depth: number; charge: number;
  };
  residues: Array<{
    chain: string; resno: number; resname: string;
    min_dist_A: number; category: string;
  }>;
  createdAt: number;
}

export interface ScreeningViz {
  pdbId: string;
  ligand: string;
  pocketScore: number;
  fragmentSet: string;
  rankedHits: Array<{
    name: string; smiles: string; mw: number; logp: number;
    hbondDonors: number; hbondAcceptors: number;
    affinityKcal: number; ki_uM: number; score: number; rationale: string;
  }>;
  createdAt: number;
}

export interface PocketDetectionViz {
  pdbId: string;
  pockets: Array<{
    id: number;
    center: [number, number, number];
    volume: number;
    depth: number;
    druggabilityScore: number;
    classification: string;
    residueCount: number;
    composition: Record<string, number>;
    topResidues: Array<{ chain: string; resno: number; resname: string }>;
  }>;
  createdAt: number;
}

export interface AlignmentResult {
  id: string;
  refId: string;
  mobileId: string;
  method: string;
  rmsd?: number;
  tmScore?: number;
  alignedResidues?: number;
  totalResidues?: number;
  identity?: number;
  transform?: number[][];
  detail?: string;
  timestamp: number;
}

let toastFn: ((msg: string, kind?: "default" | "success" | "error" | "info") => void) | null = null;
export function registerToast(fn: typeof toastFn) {
  toastFn = fn;
}

/** Curated color palette for structure list items. */
export const STRUCTURE_PALETTE = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#ef4444", // red
  "#84cc16", // lime
];

function nextStructureColor(existing: LoadedStructure[]): string {
  const used = new Set(existing.map((s) => s.color));
  for (const c of STRUCTURE_PALETTE) if (!used.has(c)) return c;
  return STRUCTURE_PALETTE[existing.length % STRUCTURE_PALETTE.length];
}

export const useAppStore = create<AppState>((set, get) => ({
  viewer: null,
  plugin: null,
  ready: false,
  setViewer: (v) => {
    if (typeof window !== "undefined" && v?.plugin) {
      (window as any).__molstarPlugin = v.plugin;
    }
    set({
      viewer: v,
      plugin: v?.plugin ?? null,
      ready: !!v,
    });
  },

  structures: [],
  activeStructureId: null,
  addStructure: (s) =>
    set((state) => {
      // Replace if same id exists
      const filtered = state.structures.filter((x) => x.id !== s.id);
      // Auto-assign color and default style if not provided
      const struct: LoadedStructure = {
        ...s,
        color: s.color ?? nextStructureColor(filtered),
        style: s.style ?? { ...DEFAULT_STYLE, singleColor: s.color ?? nextStructureColor(filtered) },
      };
      const structures = [...filtered, struct];
      // Auto-activate the first structure if none is active
      const activeStructureId =
        state.activeStructureId && structures.some((x) => x.id === state.activeStructureId)
          ? state.activeStructureId
          : structures[0]?.id ?? null;
      return { structures, activeStructureId };
    }),
  removeStructure: (id) =>
    set((state) => {
      const structures = state.structures.filter((x) => x.id !== id);
      const activeStructureId =
        state.activeStructureId === id
          ? structures[0]?.id ?? null
          : state.activeStructureId;
      // Also drop the file cache entry + alignments involving this structure
      const structureFileCache = { ...state.structureFileCache };
      delete structureFileCache[id];
      const alignmentHistory = state.alignmentHistory.filter(
        (a) => a.refId !== id && a.mobileId !== id
      );
      return { structures, activeStructureId, structureFileCache, alignmentHistory };
    }),
  clearStructures: () => set({ structures: [], activeStructureId: null, structureFileCache: {} }),
  setActiveStructure: (id) => set({ activeStructureId: id }),
  renameStructure: (id, label) =>
    set((state) => ({
      structures: state.structures.map((s) =>
        s.id === id ? { ...s, label } : s
      ),
    })),
  updateStructureStyle: (id, patch) =>
    set((state) => ({
      structures: state.structures.map((s) =>
        s.id === id
          ? { ...s, style: { ...DEFAULT_STYLE, ...s.style, ...patch } }
          : s
      ),
    })),
  updateStructureMetadata: (id, metadata) =>
    set((state) => ({
      structures: state.structures.map((s) =>
        s.id === id ? { ...s, metadata: { ...s.metadata, ...metadata } } : s
      ),
    })),
  setStructureAlignment: (id, rmsd, tmScore, transform) =>
    set((state) => ({
      structures: state.structures.map((s) =>
        s.id === id ? { ...s, alignRmsd: rmsd, alignTmScore: tmScore, transform } : s
      ),
    })),
  structureFileCache: {},
  setStructureFileCache: (id, content, format) =>
    set((state) => ({
      structureFileCache: { ...state.structureFileCache, [id]: { content, format } },
    })),

  leftPanelTab: "tools",
  setLeftPanelTab: (t) => set({ leftPanelTab: t }),
  rightPanelTab: "chat",
  setRightPanelTab: (t) => set({ rightPanelTab: t }),
  viewerBgDark: false,
  setViewerBgDark: (dark) => set({ viewerBgDark: dark }),

  messages: loadFromStorage<ChatMessage>(STORAGE_KEY_MESSAGES),
  addMessage: (m) =>
    set((state) => {
      const messages = [...state.messages, m];
      saveMessagesToStorage(messages);
      return { messages };
    }),
  updateMessage: (id, patch) =>
    set((state) => {
      const messages = state.messages.map((m) =>
        m.id === id ? { ...m, ...patch } : m
      );
      if (!patch.pending) saveMessagesToStorage(messages);
      return { messages };
    }),
  clearChat: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY_MESSAGES);
    }
    set({ messages: [] });
  },

  reports: loadFromStorage<AnalysisReport>(STORAGE_KEY_REPORTS),
  addReport: (r) =>
    set((state) => {
      const reports = [r, ...state.reports];
      saveReportsToStorage(reports);
      return { reports };
    }),
  removeReport: (id) =>
    set((state) => {
      const reports = state.reports.filter((r) => r.id !== id);
      saveReportsToStorage(reports);
      return { reports };
    }),

  lastSnapshot: null,
  setLastSnapshot: (s) => set({ lastSnapshot: s }),

  commandLog: [],
  logCommand: (entry) =>
    set((state) => ({
      commandLog: [
        { ts: Date.now(), ...entry },
        ...state.commandLog,
      ].slice(0, 50),
    })),

  lastAlignment: null,
  setLastAlignment: (a) => set({ lastAlignment: a }),
  alignmentHistory: [],
  addAlignmentToHistory: (a) =>
    set((state) => ({
      alignmentHistory: [...state.alignmentHistory, a].slice(-20),
    })),
  clearAlignmentHistory: () => set({ alignmentHistory: [] }),

  measureMode: "off",
  setMeasureMode: (m) => set({ measureMode: m }),
  measurements: [],
  addMeasurement: (m) =>
    set((state) => ({
      measurements: [
        { id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, ...m, ts: Date.now() },
        ...state.measurements,
      ].slice(0, 50),
    })),
  removeMeasurement: (id) =>
    set((state) => ({ measurements: state.measurements.filter((m) => m.id !== id) })),
  clearMeasurements: () => set({ measurements: [] }),

  // Advanced visualization state
  electrostaticViz: null,
  setElectrostaticViz: (v) => set({ electrostaticViz: v }),
  druggabilityViz: null,
  setDruggabilityViz: (v) => set({ druggabilityViz: v }),
  screeningViz: null,
  setScreeningViz: (v) => set({ screeningViz: v }),
  pocketDetectionViz: null,
  setPocketDetectionViz: (v) => set({ pocketDetectionViz: v }),

  saveSession: () => {
    const s = get();
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      structures: s.structures,
      measurements: s.measurements,
      alignmentHistory: s.alignmentHistory,
      reports: s.reports,
      structureFileCache: s.structureFileCache,
    };
    return JSON.stringify(payload, null, 2);
  },
  loadSession: (data) => {
    if (!data || typeof data !== "object") {
      get().toast("会话数据格式错误", "error");
      return;
    }
    const d = data as {
      structures?: LoadedStructure[];
      measurements?: AppState["measurements"];
      alignmentHistory?: AlignmentResult[];
      reports?: AnalysisReport[];
      structureFileCache?: Record<string, { content: string; format: "pdb" | "cif" }>;
    };
    set({
      structures: Array.isArray(d.structures) ? d.structures : [],
      measurements: Array.isArray(d.measurements) ? d.measurements : [],
      alignmentHistory: Array.isArray(d.alignmentHistory) ? d.alignmentHistory : [],
      reports: Array.isArray(d.reports) ? d.reports : [],
      structureFileCache:
        d.structureFileCache && typeof d.structureFileCache === "object"
          ? d.structureFileCache
          : {},
      activeStructureId:
        Array.isArray(d.structures) && d.structures.length > 0
          ? d.structures[0].id
          : null,
    });
    get().toast(
      `会话已加载: ${d.structures?.length ?? 0} 个结构, ${d.reports?.length ?? 0} 份报告`,
      "success"
    );
  },

  toast: (msg, kind = "default") => {
    if (toastFn) toastFn(msg, kind);
    else console.log(`[toast:${kind}] ${msg}`);
  },
}));

// Expose store on window for debugging (wrapped to avoid Turbopack issues)
try { if (typeof window !== "undefined") (window as any).__molcraftStore = useAppStore; } catch {}

/** Convenience selector: returns the currently-active LoadedStructure (or null). */
export function selectActiveStructure(state: AppState): LoadedStructure | null {
  if (!state.activeStructureId) return state.structures[0] ?? null;
  return state.structures.find((s) => s.id === state.activeStructureId) ?? state.structures[0] ?? null;
}
