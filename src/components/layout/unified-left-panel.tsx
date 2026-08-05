"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Palette,
  Ruler,
  Zap,
  GitCompareArrows,
  Download,
  Layers,
  Eye,
  EyeOff,
  X,
  Activity,
  Box,
  Check,
  ChevronRight,
  AlignLeft,
  Network,
  BarChart3,
  Grid3x3,
  CircleDashed,
  Link2,
  Spline,
  Sigma,
  Droplets,
  Atom,
  ShieldCheck,
  Target,
  Fingerprint,
  Boxes,
  Pill,
  FlaskConical,
  SunMedium,
  LayoutDashboard,
  GitCompare,
  Search,
  Pencil,
  Info,
  Triangle,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import type { AlignmentResult } from "@/lib/store";
import { parsePdb, kabsch, matchCAAtoms, matchCABySequence, applyTransformToPdb } from "@/lib/structure-utils";
import type { KabschResult } from "@/lib/structure-utils";
import { executeCommand } from "@/lib/molstar/commands";
import { useLang } from "@/lib/i18n";
import {
  REPRESENTATION_PRESETS,
  COLOR_THEMES,
} from "@/lib/molstar/presets";
import type { LlmCommand, ResidueRef } from "@/lib/llm/command-schema";

/** Color dots for structure list items (PyMOL-style) */
const STRUCTURE_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
];

/** Unified left panel — single row of tabs, PyMOL-style structure list with inline controls. */
export function UnifiedLeftPanel() {
  const [tab, setTab] = useState("structures");
  const { t } = useLang();
  const structures = useAppStore((s) => s.structures);
  const activeStructureId = useAppStore((s) => s.activeStructureId);
  const setActiveStructure = useAppStore((s) => s.setActiveStructure);

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Active structure banner — compact */}
      {structures.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-accent/20 px-3 py-1.5">
          <Activity className="h-3 w-3 text-primary" />
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            当前分析
          </span>
          <Badge variant="secondary" className="ml-auto font-mono text-[10px]">
            {activeStructureId
              ? structures.find((s) => s.id === activeStructureId)?.label ?? "—"
              : structures[0]?.label ?? "—"}
          </Badge>
        </div>
      )}

      {/* Tab row */}
      <div className="flex shrink-0 items-center border-b bg-card">
        <TabButton
          active={tab === "structures"}
          onClick={() => setTab("structures")}
          icon={<Layers className="h-3 w-3" />}
          label={t("structures")}
          badge={structures.length > 0 ? structures.length : undefined}
        />
        <TabButton
          active={tab === "measure"}
          onClick={() => setTab("measure")}
          icon={<Ruler className="h-3 w-3" />}
          label={t("measure")}
        />
        <TabButton
          active={tab === "analysis"}
          onClick={() => setTab("analysis")}
          icon={<Activity className="h-3 w-3" />}
          label={t("analysis")}
        />
        <TabButton
          active={tab === "volume"}
          onClick={() => setTab("volume")}
          icon={<Box className="h-3 w-3" />}
          label={t("volume")}
        />
        <TabButton
          active={tab === "export"}
          onClick={() => setTab("export")}
          icon={<Download className="h-3 w-3" />}
          label={t("export")}
        />
      </div>

      <ScrollArea className="flex-1 min-h-0 scrollbar-thin">
        {tab === "structures" && <StructuresTab />}
        {tab === "measure" && <MeasureTab />}
        {tab === "analysis" && <AnalysisTab />}
        {tab === "volume" && <VolumeTab />}
        {tab === "export" && <ExportTab />}
      </ScrollArea>
    </div>
  );
}

/** Compact tab button */
function TabButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-1 py-2 text-[10px] font-medium transition ${
        active
          ? "border-primary text-primary"
          : "border-transparent text-muted-foreground hover:bg-accent/30 hover:text-foreground"
      }`}
    >
      {icon}
      <span className="hidden xl:inline">{label}</span>
      {badge !== undefined && (
        <span className="ml-0.5 rounded-full bg-primary/10 px-1 text-[9px] text-primary">
          {badge}
        </span>
      )}
    </button>
  );
}

// ============================================================
// Command runner hook
// ============================================================

function useRunCommand() {
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);
  const [busy, setBusy] = useState(false);
  const run = async (cmd: LlmCommand) => {
    if (!viewer) { toast("查看器尚未就绪", "error"); return null; }
    setBusy(true);
    try {
      const res = await executeCommand(viewer, cmd);
      logCommand({ type: cmd.type, ok: res.ok, detail: res.detail });
      if (res.ok) toast(res.detail ?? "完成", "success");
      else toast(res.detail ?? "失败", "error");
      return res;
    } finally { setBusy(false); }
  };
  return { run, busy };
}

// ============================================================
// Structures tab — PyMOL-style structure list with inline controls
// ============================================================

function StructuresTab() {
  const { t } = useLang();
  const structures = useAppStore((s) => s.structures);
  const removeStructure = useAppStore((s) => s.removeStructure);
  const addStructure = useAppStore((s) => s.addStructure);
  const renameStructure = useAppStore((s) => s.renameStructure);
  const setStructureAlignment = useAppStore((s) => s.setStructureAlignment);
  const activeStructureId = useAppStore((s) => s.activeStructureId);
  const setActiveStructure = useAppStore((s) => s.setActiveStructure);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);
  const setLastAlignment = useAppStore((s) => s.setLastAlignment);
  const addAlignmentToHistory = useAppStore((s) => s.addAlignmentToHistory);
  const alignmentHistory = useAppStore((s) => s.alignmentHistory);
  const clearAlignmentHistory = useAppStore((s) => s.clearAlignmentHistory);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const [hiddenStructures, setHiddenStructures] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [aligning, setAligning] = useState(false);

  // Auto-open the active structure's panel when it changes.
  useEffect(() => {
    if (activeStructureId) setOpenId(activeStructureId);
  }, [activeStructureId]);

  const toggleVisibility = async (id: string) => {
    if (!viewer) return;
    try {
      const plugin = viewer.plugin;
      const structs = plugin.managers.structure.hierarchy.current.structures;
      const structIdx = structures.findIndex((s) => s.id === id);
      if (structIdx < 0 || structIdx >= structs.length) {
        toast(`结构 ${id} 未找到`, "error");
        return;
      }
      const target = structs[structIdx];
      plugin.managers.structure.hierarchy.toggleVisibility([target]);
      const isHidden = hiddenStructures.has(id);
      setHiddenStructures((prev) => {
        const next = new Set(prev);
        if (isHidden) next.delete(id);
        else next.add(id);
        return next;
      });
      toast(`${id} ${isHidden ? "已显示" : "已隐藏"}`, "info");
    } catch (err) {
      toast(`操作失败: ${err}`, "error");
    }
  };

  const closeStructure = async (id: string) => {
    if (!viewer) return;
    try {
      const plugin = viewer.plugin;
      const structs = plugin.managers.structure.hierarchy.current.structures;
      const structIdx = structures.findIndex((s) => s.id === id);
      if (structIdx >= 0 && structIdx < structs.length) {
        plugin.managers.structure.hierarchy.remove([structs[structIdx]]);
      }
      removeStructure(id);
      toast(`已关闭结构 ${id}`, "success");
    } catch (err) {
      toast(`关闭失败: ${err}`, "error");
    }
  };

  /** Client-side alignment using Kabsch superposition (借鉴 upload project).
   *  Works with ANY structures that have pdbText — PDB IDs AND uploaded files. */
  const handleAlign = async (refId: string, mobileId: string) => {
    if (!viewer) return;
    setAligning(true);
    toast(`正在比对 ${mobileId} → ${refId}...`, "info");

    try {
      const refStruct = structures.find((s) => s.id === refId);
      const mobStruct = structures.find((s) => s.id === mobileId);
      if (!refStruct || !mobStruct || refId === mobileId) {
        toast("无效的比对目标", "error");
        return;
      }

      if (!refStruct.pdbText || !mobStruct.pdbText) {
        toast("缺少 PDB 文本数据。请重新加载结构。", "error");
        return;
      }

      // Parse both structures client-side.
      const refParsed = parsePdb(refStruct.pdbText);
      const mobParsed = parsePdb(mobStruct.pdbText);

      // Try all chain-pair combinations and pick the best (lowest RMSD).
      const refChains = [...new Set(refParsed.ca.map((a) => a.chain))];
      const mobChains = [...new Set(mobParsed.ca.map((a) => a.chain))];

      let bestResult: { kabsch: KabschResult; count: number; method: string; refChain?: string; mobChain?: string } | null = null;
      let bestRmsd = Infinity;

      for (const rc of refChains) {
        for (const mc of mobChains) {
          // First try matching by (chain, resSeq).
          let { refCoords, mobCoords, count } = matchCAAtoms(refParsed.ca, mobParsed.ca, rc, mc);
          let method = "residue-number";

          // If residue-number match is poor (RMSD > 5Å or < 3 pairs), try sequence alignment.
          let needSeqFallback = count < 3;
          if (count >= 3) {
            const check = kabsch(refCoords, mobCoords);
            if (check && check.rmsd > 5.0) needSeqFallback = true;
          }

          if (needSeqFallback) {
            const seqResult = matchCABySequence(refParsed.ca, mobParsed.ca, rc, mc);
            if (seqResult.count >= 3) {
              const seqK = kabsch(seqResult.refCoords, seqResult.mobCoords);
              if (seqK) {
                const rnK = count >= 3 ? kabsch(refCoords, mobCoords) : null;
                if (!rnK || seqK.rmsd < rnK.rmsd || seqResult.count > count) {
                  refCoords = seqResult.refCoords;
                  mobCoords = seqResult.mobCoords;
                  count = seqResult.count;
                  method = "sequence";
                }
              }
            }
          }

          if (count >= 3) {
            const k = kabsch(refCoords, mobCoords);
            if (k && k.rmsd < bestRmsd) {
              bestRmsd = k.rmsd;
              bestResult = { kabsch: k, count, method, refChain: rc, mobChain: mc };
            }
          }
        }
      }

      if (!bestResult) {
        toast("比对失败 — 少于 3 个共同 Cα 原子。请尝试选择特定链。", "error");
        return;
      }

      const { kabsch: k, count, method, refChain, mobChain } = bestResult;

      // Apply the transform to the mobile PDB text.
      const transformedPdb = applyTransformToPdb(mobStruct.pdbText, k.transform);

      // Load the transformed PDB into the Molstar viewer.
      const alignedLabel = `${mobStruct.label}_aligned`;
      try {
        // Hide the original mobile structure.
        const mobIdx = structures.findIndex((s) => s.id === mobileId);
        try {
          const plugin = viewer.plugin;
          const structs = plugin.managers.structure.hierarchy.current.structures;
          const mobCell = structs[mobIdx];
          if (mobCell) {
            plugin.managers.structure.hierarchy.toggleVisibility([mobCell]);
            setHiddenStructures((prev) => new Set(prev).add(mobStruct.id));
          }
        } catch (e) {
          console.warn("Could not hide original mobile structure:", e);
        }

        // Load the transformed PDB from data (not URL — client-side).
        await viewer.loadStructureFromData(transformedPdb, "pdb", { dataLabel: alignedLabel });
        addStructure({
          id: alignedLabel,
          label: alignedLabel,
          source: "url",
          loadedAt: Date.now(),
          pdbText: transformedPdb,
        });
        toast(`已加载叠合后的 ${mobStruct.label}`, "success");
      } catch (e) {
        console.warn("Could not load aligned PDB into viewer:", e);
        toast(`叠合计算成功，但加载到查看器失败: ${e}`, "error");
      }

      const chainInfo = refChain && mobChain ? ` (chains ${refChain}→${mobChain})` : "";
      const result: AlignmentResult = {
        id: `aln-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        refId,
        mobileId,
        method: method === "sequence" ? "sequence-alignment + Kabsch" : "residue-number + Kabsch",
        rmsd: k.rmsd,
        tmScore: k.tmScore,
        alignedResidues: count,
        transform: k.transform,
        detail: `RMSD ${k.rmsd.toFixed(2)}Å · TM ${k.tmScore.toFixed(3)} · ${count} Cα${chainInfo}`,
        timestamp: Date.now(),
      };
      setLastAlignment(result);
      addAlignmentToHistory(result);
      setStructureAlignment(mobileId, k.rmsd, k.tmScore, k.transform);
      logCommand({
        type: "align_structures",
        ok: true,
        detail: `${mobileId} → ${refId}: ${result.detail}`,
      });
      toast(`比对完成: ${result.detail}`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logCommand({ type: "align_structures", ok: false, detail: msg });
      toast(`比对失败: ${msg}`, "error");
    } finally {
      setAligning(false);
    }
  };

  if (structures.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-3 py-2.5 border-b border-border/60 flex items-center justify-between shrink-0">
          <div>
            <h3 className="text-xs font-semibold tracking-tight">{t("structures")}</h3>
            <p className="text-[10px] text-muted-foreground">
              0 {t("structures_count")}
            </p>
          </div>
        </div>
        <div className="text-center py-10 px-3">
          <div className="mx-auto mb-2 h-10 w-10 rounded-full bg-muted/50 flex items-center justify-center">
            <Activity className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="text-xs font-medium text-foreground/80">{t("no_structures_yet")}</p>
          <p className="text-[11px] text-muted-foreground mt-1">
            {t("no_structures_hint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2.5 border-b border-border/60 flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-xs font-semibold tracking-tight">{t("structures")}</h3>
          <p className="text-[10px] text-muted-foreground">
            {structures.length} {t("structures_count")}
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[10px] text-muted-foreground hover:text-destructive"
          onClick={() => {
            if (structures.length > 0 && confirm(t("clear_all") + "?")) {
              structures.forEach((s) => closeStructure(s.id));
            }
          }}
        >
          {t("clear_all")}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1.5">
          {aligning && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2 text-[10px]">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                正在计算叠合…
              </div>
            </div>
          )}
          {structures.map((s, i) => (
            <StructureCard
              key={s.id}
              structure={s}
              index={i}
              isActive={activeStructureId === s.id || (!activeStructureId && i === 0)}
              isOpen={openId === s.id}
              isHidden={hiddenStructures.has(s.id)}
              structures={structures}
              onSelect={() => setActiveStructure(s.id)}
              onToggleOpen={() => setOpenId(openId === s.id ? null : s.id)}
              onToggleVisible={() => toggleVisibility(s.id)}
              onRemove={() => closeStructure(s.id)}
              onRename={(label) => renameStructure(s.id, label)}
              onAlign={handleAlign}
              aligning={aligning}
            />
          ))}

          {/* Alignment history */}
          {alignmentHistory.length > 0 && (
            <AlignmentHistoryPanel
              history={alignmentHistory}
              onClear={clearAlignmentHistory}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Card-based structure item with tabs (借鉴 upload project) */
function StructureCard({
  structure,
  index,
  isActive,
  isOpen,
  isHidden,
  structures,
  onSelect,
  onToggleOpen,
  onToggleVisible,
  onRemove,
  onRename,
  onAlign,
  aligning,
}: {
  structure: { id: string; label: string; source: string; loadedAt: number; color?: string; style?: { representation: string; colorScheme: string; opacity: number; singleColor: string }; metadata?: { chains?: string[]; numAtoms?: number; numResidues?: number; method?: string; resolution?: number | null; title?: string }; alignRmsd?: number; alignTmScore?: number };
  index: number;
  isActive: boolean;
  isOpen: boolean;
  isHidden: boolean;
  structures: Array<{ id: string; label: string }>;
  onSelect: () => void;
  onToggleOpen: () => void;
  onToggleVisible: () => void;
  onRemove: () => void;
  onRename: (label: string) => void;
  onAlign: (refId: string, mobileId: string) => void;
  aligning: boolean;
}) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(structure.label);
  const [tab, setTab] = useState<"info" | "style" | "align">("info");
  const [alignTarget, setAlignTarget] = useState<string>("");

  // Display the current structure label when not editing.
  const displayName = editing ? name : structure.label;

  const saveName = () => {
    onRename(name.trim() || structure.label);
    setEditing(false);
  };

  const others = structures.filter((s) => s.id !== structure.id);

  return (
    <div
      className={`rounded-lg border bg-card transition-all overflow-hidden ${
        isActive
          ? "border-primary/60 ring-1 ring-primary/20 shadow-sm"
          : "border-border/60 hover:border-border"
      } ${isHidden ? "opacity-55" : ""}`}
    >
      {/* Compact header row */}
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button
          type="button"
          onClick={onSelect}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
          title="设为分析对象"
        >
          <span
            className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-black/10"
            style={{ backgroundColor: structure.color ?? STRUCTURE_COLORS[index % STRUCTURE_COLORS.length] }}
          />
          <span className="text-[10px] font-mono text-muted-foreground w-5 shrink-0">
            {String(index + 1).padStart(2, "0")}
          </span>
          {editing ? (
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName();
                if (e.key === "Escape") {
                  setName(structure.label);
                  setEditing(false);
                }
              }}
              className="h-6 text-xs px-1 py-0"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="text-xs font-medium truncate">{displayName}</span>
          )}
        </button>

        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
          title={isHidden ? "显示" : "隐藏"}
        >
          {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setName(structure.label); setEditing(true); }}
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
          title="重命名"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          title="关闭结构"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleOpen(); }}
          className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
          title={isOpen ? "折叠" : "展开"}
        >
          <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`} />
        </button>
      </div>

      {/* Badges row */}
      <div className="flex flex-wrap items-center gap-1 px-2 pb-1.5">
        <Badge variant="outline" className="text-[9px] h-4 px-1 uppercase">
          {structure.source}
        </Badge>
        {structure.metadata?.method && (
          <Badge variant="secondary" className="text-[9px] h-4 px-1">
            {structure.metadata.method}
          </Badge>
        )}
        {structure.metadata?.chains && structure.metadata.chains.length > 0 && (
          <Badge variant="secondary" className="text-[9px] h-4 px-1">
            {structure.metadata.chains.length} chain{structure.metadata.chains.length > 1 ? "s" : ""}
          </Badge>
        )}
        {structure.metadata?.numResidues !== undefined && (
          <Badge variant="secondary" className="text-[9px] h-4 px-1">
            {structure.metadata.numResidues} res
          </Badge>
        )}
        {structure.alignRmsd !== undefined && (
          <Badge className="text-[9px] h-4 px-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15">
            RMSD {structure.alignRmsd.toFixed(2)}Å
          </Badge>
        )}
        {structure.alignTmScore !== undefined && (
          <Badge
            className={`text-[9px] h-4 px-1 ${
              structure.alignTmScore >= 0.5
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                : structure.alignTmScore >= 0.3
                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                : "bg-rose-500/15 text-rose-700 dark:text-rose-300"
            }`}
            title="TM-score (0–1, >0.5 = same fold)"
          >
            TM {structure.alignTmScore.toFixed(3)}
          </Badge>
        )}
      </div>

      {/* Expanded panel — tabbed */}
      {isOpen && (
        <div className="border-t border-border/50 bg-muted/20">
          <div className="flex items-center gap-0.5 px-2 pt-1.5">
            <CardTabButton active={tab === "info"} onClick={() => setTab("info")} icon={<Info className="h-3 w-3" />} label={t("info")} />
            <CardTabButton active={tab === "style"} onClick={() => setTab("style")} icon={<Palette className="h-3 w-3" />} label={t("style")} />
            <CardTabButton active={tab === "align"} onClick={() => setTab("align")} icon={<GitCompareArrows className="h-3 w-3" />} label={t("align")} />
          </div>
          <div className="p-2.5">
            {tab === "info" && <CardInfoPanel structure={structure} />}
            {tab === "style" && <CardStylePanel structure={structure} />}
            {tab === "align" && (
              <CardAlignPanel
                structure={structure}
                others={others}
                alignTarget={alignTarget}
                setAlignTarget={setAlignTarget}
                onAlign={onAlign}
                aligning={aligning}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CardTabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
        active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function CardInfoPanel({ structure }: { structure: { id: string; label: string; source: string; metadata?: { chains?: string[]; numAtoms?: number; numResidues?: number; method?: string; resolution?: number | null; title?: string } } }) {
  const { t } = useLang();
  const m = structure.metadata;
  return (
    <div className="space-y-0.5">
      {m?.title && (
        <p className="text-[11px] leading-snug text-foreground/80 mb-1.5 line-clamp-3">
          {m.title}
        </p>
      )}
      <div className="flex items-center justify-between gap-2 py-0.5">
        <span className="text-[11px] text-muted-foreground">{t("source")}</span>
        <span className="text-[11px] font-medium text-right">{structure.source}: {structure.id}</span>
      </div>
      {m?.method && (
        <div className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-[11px] text-muted-foreground">{t("method")}</span>
          <span className="text-[11px] font-medium text-right">{m.method}</span>
        </div>
      )}
      {m?.resolution != null && (
        <div className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-[11px] text-muted-foreground">{t("resolution")}</span>
          <span className="text-[11px] font-medium text-right">{m.resolution.toFixed(2)} Å</span>
        </div>
      )}
      {m?.chains && m.chains.length > 0 && (
        <div className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-[11px] text-muted-foreground">{t("chains")}</span>
          <span className="text-[11px] font-medium text-right">{m.chains.join(", ")}</span>
        </div>
      )}
      {m?.numResidues !== undefined && (
        <div className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-[11px] text-muted-foreground">{t("residues")}</span>
          <span className="text-[11px] font-medium text-right">{m.numResidues.toLocaleString()}</span>
        </div>
      )}
      {m?.numAtoms !== undefined && (
        <div className="flex items-center justify-between gap-2 py-0.5">
          <span className="text-[11px] text-muted-foreground">{t("atoms")}</span>
          <span className="text-[11px] font-medium text-right">{m.numAtoms.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}

function CardStylePanel({ structure }: { structure: { id: string; color?: string; style?: { representation: string; colorScheme: string; opacity: number; singleColor: string } } }) {
  const updateStyle = useAppStore((s) => s.updateStructureStyle);
  const { t } = useLang();
  const style = structure.style ?? { representation: "cartoon", colorScheme: "spectrum", opacity: 1, singleColor: structure.color ?? "#6366f1" };

  return (
    <div className="space-y-2.5">
      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{t("representation")}</Label>
        <Select
          value={style.representation}
          onValueChange={(v) => {
            updateStyle(structure.id, { representation: v as any });
            // Apply to Molstar viewer
            applyStyleToViewer(structure.id, v as any, style.colorScheme, style.opacity, style.singleColor);
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cartoon">Cartoon</SelectItem>
            <SelectItem value="stick">Stick</SelectItem>
            <SelectItem value="line">Line</SelectItem>
            <SelectItem value="sphere">Sphere</SelectItem>
            <SelectItem value="surface">Surface</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label className="text-[11px] text-muted-foreground">{t("color_scheme")}</Label>
        <Select
          value={style.colorScheme}
          onValueChange={(v) => {
            updateStyle(structure.id, { colorScheme: v as any });
            applyStyleToViewer(structure.id, style.representation as any, v as any, style.opacity, style.singleColor);
          }}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spectrum">Spectrum (rainbow)</SelectItem>
            <SelectItem value="chain">By chain</SelectItem>
            <SelectItem value="secondary">By secondary structure</SelectItem>
            <SelectItem value="residue">By residue type</SelectItem>
            <SelectItem value="bfactor">By B-factor</SelectItem>
            <SelectItem value="charge">By charge (electrostatic)</SelectItem>
            <SelectItem value="element">By element</SelectItem>
            <SelectItem value="single">Single color</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {style.colorScheme === "single" && (
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground">Color</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={style.singleColor}
              onChange={(e) => {
                updateStyle(structure.id, { singleColor: e.target.value });
                applyStyleToViewer(structure.id, style.representation as any, "single", style.opacity, e.target.value);
              }}
              className="h-8 w-10 rounded border border-border/60 cursor-pointer bg-transparent"
            />
            <Input
              value={style.singleColor}
              onChange={(e) => {
                updateStyle(structure.id, { singleColor: e.target.value });
              }}
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] text-muted-foreground">Opacity</Label>
          <span className="text-[11px] font-mono">{Math.round(style.opacity * 100)}%</span>
        </div>
        <Slider
          value={[style.opacity]}
          min={0.2}
          max={1}
          step={0.05}
          onValueChange={([v]) => {
            updateStyle(structure.id, { opacity: v });
            applyStyleToViewer(structure.id, style.representation as any, style.colorScheme as any, v, style.singleColor);
          }}
        />
      </div>

      <Button
        size="sm"
        variant="outline"
        className="w-full h-7 text-[11px]"
        onClick={() => {
          const defaults = { representation: "cartoon" as const, colorScheme: "spectrum" as const, opacity: 1, singleColor: structure.color ?? "#6366f1" };
          updateStyle(structure.id, defaults);
          applyStyleToViewer(structure.id, "cartoon", "spectrum", 1, defaults.singleColor);
        }}
      >
        Reset to defaults
      </Button>
    </div>
  );
}

/** Apply style changes to the Molstar viewer for a specific structure. */
function applyStyleToViewer(
  structureId: string,
  representation: string,
  colorScheme: string,
  opacity: number,
  singleColor: string,
) {
  const store = useAppStore.getState();
  const viewer = store.viewer;
  if (!viewer) return;
  const structures = store.structures;
  const structIdx = structures.findIndex((s) => s.id === structureId);
  if (structIdx < 0) return;

  const plugin = viewer.plugin as any;
  const hierarchyStructs = plugin.managers.structure.hierarchy.current.structures;
  if (structIdx >= hierarchyStructs.length) return;
  const target = hierarchyStructs[structIdx];

  // Map our representation names to Molstar preset names.
  const presetMap: Record<string, string> = {
    cartoon: "polymer-cartoon",
    stick: "atomic-detail",
    line: "polymer-cartoon", // fallback — Molstar doesn't have a pure "line" preset
    sphere: "coarse-surface",
    surface: "molecular-surface",
  };
  const molPreset = presetMap[representation] || "polymer-and-ligand";

  // Apply representation preset.
  try {
    plugin.managers.structure.component.applyPreset([target], molPreset);
  } catch (e) {
    console.warn("Failed to apply preset:", e);
  }

  // Apply color theme.
  const colorMap: Record<string, string> = {
    chain: "chain",
    element: "element-symbol",
    secondary: "secondary-structure",
    single: "uniform",
    spectrum: "sequence-id",
    bfactor: "uncertainty",
    residue: "residue-name",
    charge: "partial-charge",
  };
  const molColor = colorMap[colorScheme] || "chain";

  // Get components for this structure.
  const components = target.components || [];
  if (components.length > 0) {
    try {
      if (colorScheme === "single") {
        const hex = singleColor.replace("#", "");
        const num = parseInt(hex, 16);
        plugin.managers.structure.component.updateRepresentationsTheme(components, {
          color: "uniform",
          colorParams: { value: num },
        });
      } else {
        plugin.managers.structure.component.updateRepresentationsTheme(components, {
          color: molColor,
        });
      }
      // Apply opacity if needed.
      if (opacity < 1) {
        for (const comp of components) {
          const reprs = (comp as any).representations || [];
          for (const repr of reprs) {
            try {
              plugin.managers.structure.component.updateRepresentationsTheme([comp], {
                transparency: { alpha: opacity },
              });
            } catch {}
          }
        }
      }
    } catch (e) {
      console.warn("Failed to apply color theme:", e);
    }
  }
}

function CardAlignPanel({
  structure,
  others,
  alignTarget,
  setAlignTarget,
  onAlign,
  aligning,
}: {
  structure: { id: string; label: string };
  others: Array<{ id: string; label: string }>;
  alignTarget: string;
  setAlignTarget: (v: string) => void;
  onAlign: (refId: string, mobileId: string) => void;
  aligning: boolean;
}) {
  const { t } = useLang();
  return (
    <div className="space-y-2">
      {others.length === 0 ? (
        <p className="text-[11px] text-muted-foreground py-2 text-center">
          {t("need_other_structure")}
        </p>
      ) : (
        <>
          <div className="space-y-1">
            <Label className="text-[11px] text-muted-foreground">
              {t("align_to_reference")}
            </Label>
            <Select value={alignTarget} onValueChange={setAlignTarget}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder={t("select_reference")} />
              </SelectTrigger>
              <SelectContent>
                {others.map((o) => (
                  <SelectItem key={o.id} value={o.id} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-md bg-muted/40 border border-border/50 px-2 py-1.5">
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {t("align_description")}
            </p>
          </div>
          <Button
            size="sm"
            className="w-full h-8 text-xs"
            disabled={!alignTarget || aligning}
            onClick={() => onAlign(alignTarget, structure.id)}
          >
            {aligning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
            {t("run_alignment")}
          </Button>
        </>
      )}
    </div>
  );
}

/** Alignment history panel (借鉴 upload project) */
function AlignmentHistoryPanel({
  history,
  onClear,
}: {
  history: AlignmentResult[];
  onClear: () => void;
}) {
  const { t } = useLang();
  return (
    <div className="rounded-md border border-border/50 bg-card p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {t("alignment_history")} ({history.length})
        </span>
        <button
          onClick={onClear}
          className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
          title={t("clear_history")}
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="max-h-32 overflow-y-auto scrollbar-thin space-y-0.5">
        {history.slice().reverse().map((a) => (
          <div
            key={a.id}
            className="flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2 py-1.5"
          >
            <GitCompareArrows className="h-3 w-3 text-emerald-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] truncate">
                <span className="font-medium">{a.mobileId}</span>
                <span className="text-muted-foreground"> → </span>
                <span className="font-medium">{a.refId}</span>
              </div>
              <div className="text-[9px] text-muted-foreground font-mono flex flex-wrap gap-x-2">
                {a.rmsd !== undefined && <span>RMSD {a.rmsd.toFixed(2)}Å</span>}
                {a.tmScore !== undefined && (
                  <span className={a.tmScore >= 0.5 ? "text-emerald-600" : a.tmScore >= 0.3 ? "text-amber-600" : "text-rose-600"}>
                    TM {a.tmScore.toFixed(3)}
                  </span>
                )}
                {a.alignedResidues !== undefined && <span>{a.alignedResidues} Cα</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Compact alignment result banner — shows after a successful alignment */
function AlignmentResultBanner() {
  const lastAlignment = useAppStore((s) => s.lastAlignment);
  const setLastAlignment = useAppStore((s) => s.setLastAlignment);
  if (!lastAlignment) return null;

  const rmsdNum = typeof lastAlignment.rmsd === "number" ? lastAlignment.rmsd : null;
  const quality = rmsdNum === null
    ? { label: "—", color: "#6b7280", bg: "#6b728020" }
    : rmsdNum < 1.5
    ? { label: "优秀", color: "#059669", bg: "#05966920" }
    : rmsdNum < 3
    ? { label: "良好", color: "#10b981", bg: "#10b98120" }
    : rmsdNum < 6
    ? { label: "一般", color: "#f59e0b", bg: "#f59e0b20" }
    : { label: "差异大", color: "#ef4444", bg: "#ef444420" };

  return (
    <div
      className="rounded-md border p-2.5"
      style={{
        borderColor: quality.color + "60",
        background: `linear-gradient(135deg, ${quality.bg} 0%, transparent 70%)`,
      }}
    >
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold" style={{ color: quality.color }}>
        <GitCompareArrows className="h-3.5 w-3.5" />
        叠合结果
        <Badge
          variant="outline"
          className="ml-auto px-1.5 py-0 text-[9px] font-semibold"
          style={{ color: quality.color, borderColor: quality.color + "60", backgroundColor: quality.bg }}
        >
          {quality.label}
        </Badge>
        <button
          onClick={() => setLastAlignment(null)}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="space-y-0.5 text-[10px]">
        <div className="flex justify-between">
          <span className="text-muted-foreground">参考 → 移动:</span>
          <span className="font-mono">{lastAlignment.refId} → {lastAlignment.mobileId}</span>
        </div>
        {lastAlignment.rmsd !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">RMSD:</span>
            <span className="font-mono font-bold" style={{ color: quality.color }}>
              {typeof lastAlignment.rmsd === "number"
                ? lastAlignment.rmsd.toFixed(3)
                : lastAlignment.rmsd} Å
            </span>
          </div>
        )}
        {lastAlignment.tmScore !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">TM-score:</span>
            <span className="font-mono font-bold">
              {lastAlignment.tmScore.toFixed(3)}
            </span>
          </div>
        )}
        {lastAlignment.alignedResidues !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">叠合残基:</span>
            <span className="font-mono">
              {lastAlignment.alignedResidues}
              {lastAlignment.totalResidues ? ` / ${lastAlignment.totalResidues}` : ""}
            </span>
          </div>
        )}
        {lastAlignment.identity !== undefined && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">序列相同度:</span>
            <span className="font-mono">
              {(lastAlignment.identity * 100).toFixed(1)}%
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">方法:</span>
          <span className="font-mono text-[9px]">{lastAlignment.method}</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Measure tab
// ============================================================

function ResidueInput({ label, value, onChange }: { label: string; value: ResidueRef; onChange: (v: ResidueRef) => void; }) {
  return (
    <div className="rounded-md border p-1.5">
      <div className="mb-1 text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="grid grid-cols-3 gap-1">
        <Input value={value.chain ?? ""} onChange={(e) => onChange({ ...value, chain: e.target.value || undefined })} placeholder="A" className="h-7 text-xs" />
        <Input type="number" value={value.resno ?? ""} onChange={(e) => onChange({ ...value, resno: e.target.value ? Number(e.target.value) : undefined })} placeholder="145" className="h-7 text-xs" />
        <Input value={value.atom ?? ""} onChange={(e) => onChange({ ...value, atom: e.target.value || undefined })} placeholder="CA" className="h-7 text-xs" />
      </div>
    </div>
  );
}

function MeasureTab() {
  const { run, busy } = useRunCommand();
  const [a, setA] = useState<ResidueRef>({ chain: "A", resno: 30, atom: "CA" });
  const [b, setB] = useState<ResidueRef>({ chain: "A", resno: 50, atom: "CA" });
  const [labelTarget, setLabelTarget] = useState<ResidueRef>({ chain: "A", resno: 30 });
  return (
    <div className="space-y-2 p-2">
      <ResidueInput label="原子 A" value={a} onChange={setA} />
      <ResidueInput label="原子 B" value={b} onChange={setB} />
      <Button size="sm" className="h-7 w-full text-[11px]" disabled={busy} onClick={() => run({ type: "measure_distance", a, b })}>测量距离</Button>
      <ResidueInput label="标签" value={labelTarget} onChange={setLabelTarget} />
      <Button size="sm" variant="secondary" className="h-7 w-full text-[11px]" disabled={busy} onClick={() => run({ type: "label_residue", target: labelTarget })}>添加标签</Button>
      <Button size="sm" variant="destructive" className="h-7 w-full text-[11px]" onClick={() => run({ type: "clear_measurements" })}>清除测量</Button>
    </div>
  );
}

// ============================================================
// Volume tab
// ============================================================

const VOLUME_COLORS = [
  { name: "Cyan", value: 0x3377aa },
  { name: "Green", value: 0x33bb33 },
  { name: "Red", value: 0xbb3333 },
];

function VolumeTab() {
  const { run, busy } = useRunCommand();
  const [emdbId, setEmdbId] = useState("");
  const [detail, setDetail] = useState(3);
  const [isoValue, setIsoValue] = useState(0.05);
  const [colorIdx, setColorIdx] = useState(0);
  return (
    <div className="space-y-2 p-2">
      <div>
        <Label className="text-[10px]">EMDB ID</Label>
        <div className="flex gap-1">
          <Input value={emdbId} onChange={(e) => setEmdbId(e.target.value)} placeholder="EMD-30210" className="h-7 flex-1 text-xs" />
          <Button size="sm" className="h-7 text-[11px]" disabled={busy || !emdbId.trim()} onClick={() => {
            const id = emdbId.trim().toUpperCase().replace(/^EMD-?/i, "");
            run({ type: "load_volume_url", url: `https://www.ebi.ac.uk/pdbe/densities/em/emd-${id.toLowerCase()}/cell?detail=${detail}`, format: "dscif", isBinary: true, isoValue, color: `#${VOLUME_COLORS[colorIdx].value.toString(16).padStart(6, "0")}` });
          }}>加载</Button>
        </div>
      </div>
      <div><div className="flex justify-between"><Label className="text-[10px]">Detail</Label><span className="font-mono text-[10px]">{detail}</span></div><Slider value={[detail]} min={0} max={6} step={1} onValueChange={(v) => setDetail(v[0])} /></div>
      <div><div className="flex justify-between"><Label className="text-[10px]">Iso</Label><span className="font-mono text-[10px]">{isoValue.toFixed(2)}</span></div><Slider value={[isoValue]} min={0.01} max={2} step={0.01} onValueChange={(v) => setIsoValue(v[0])} /></div>
      <div className="grid grid-cols-3 gap-1">{VOLUME_COLORS.map((c, i) => (<button key={c.name} onClick={() => setColorIdx(i)} className={`aspect-square rounded border-2 ${colorIdx === i ? "border-foreground" : "border-transparent"}`} style={{ backgroundColor: `#${c.value.toString(16).padStart(6, "0")}` }} />))}</div>
    </div>
  );
}

// ============================================================
// Export tab
// ============================================================

function ExportTab() {
  const { run, busy } = useRunCommand();
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  return (
    <div className="space-y-2 p-2">
      <div className="grid grid-cols-2 gap-1">
        <div><Label className="text-[10px]">宽</Label><Input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} className="h-7 text-xs" /></div>
        <div><Label className="text-[10px]">高</Label><Input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} className="h-7 text-xs" /></div>
      </div>
      <div className="grid grid-cols-3 gap-1">
        {[{ l: "720p", w: 1280, h: 720 }, { l: "1080p", w: 1920, h: 1080 }, { l: "4K", w: 3840, h: 2160 }].map((p) => (
          <Button key={p.l} size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => { setWidth(p.w); setHeight(p.h); }}>{p.l}</Button>
        ))}
      </div>
      <Button size="sm" className="h-7 w-full text-[11px]" disabled={busy} onClick={() => run({ type: "export_snapshot", width, height })}>下载 PNG</Button>
      <Separator />
      <Button size="sm" variant="secondary" className="h-7 w-full text-[11px]" onClick={async () => { if (viewer) { try { await viewer.plugin.managers.snapshots?.downloadToFile("molj"); } catch (e) { toast(`保存失败: ${e}`, "error"); } } }}>保存会话 (molj)</Button>
    </div>
  );
}

// ============================================================
// Analysis tab — compact card-based with structure selector
// ============================================================

function AnalysisTab() {
  return (
    <div className="space-y-2 p-2">
      <ActiveStructureSelector />
      <InteractionVizCard />
      <AnalysisChartsGrid />
    </div>
  );
}

/** Compact active-structure selector — lets the user pick which loaded
 *  structure the analysis should target (multi-structure support). */
function ActiveStructureSelector() {
  const structures = useAppStore((s) => s.structures);
  const activeStructureId = useAppStore((s) => s.activeStructureId);
  const setActiveStructure = useAppStore((s) => s.setActiveStructure);

  if (structures.length === 0) return null;
  if (structures.length === 1) {
    return (
      <div className="rounded-md border bg-muted/30 p-1.5 text-[10px]">
        <span className="text-muted-foreground">分析对象: </span>
        <span className="font-mono font-semibold">{structures[0].label}</span>
      </div>
    );
  }
  return (
    <div className="rounded-md border bg-muted/30 p-1.5">
      <Label className="mb-1 block text-[9px] text-muted-foreground">分析对象</Label>
      <div className="flex flex-wrap gap-1">
        {structures.map((s, i) => {
          const isActive = activeStructureId === s.id || (!activeStructureId && i === 0);
          return (
            <button
              key={s.id}
              onClick={() => setActiveStructure(s.id)}
              className={`flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] transition ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-background hover:bg-accent"
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: STRUCTURE_COLORS[i % STRUCTURE_COLORS.length] }}
              />
              {s.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InteractionVizCard() {
  const { run, busy } = useRunCommand();
  const [target, setTarget] = useState<ResidueRef>({ chain: "A", resno: 145 });
  const [radius, setRadius] = useState(8);
  return (
    <div className="rounded-lg border bg-card p-2">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold">
        <Zap className="h-3.5 w-3.5 text-primary" />
        3D 互作可视化
      </div>
      <div className="space-y-1.5">
        <ResidueInput label="中心残基" value={target} onChange={setTarget} />
        <div>
          <div className="flex justify-between"><Label className="text-[10px]">半径 (Å)</Label><span className="font-mono text-[10px]">{radius.toFixed(1)}</span></div>
          <Slider value={[radius]} min={3} max={20} step={0.5} onValueChange={(v) => setRadius(v[0])} />
        </div>
        <div className="grid grid-cols-2 gap-1">
          <Button size="sm" className="h-7 text-[10px]" disabled={busy} onClick={() => run({ type: "show_interactions", target, radius })}>显示互作</Button>
          <Button size="sm" variant="destructive" className="h-7 text-[10px]" onClick={() => run({ type: "clear_interactions" })}>清除</Button>
        </div>
      </div>
    </div>
  );
}

/** Lazy-loaded analysis charts grid — user clicks a tile to open the chart in a
 *  Popover, avoiding a very long scrolling list. Charts are grouped into
 *  five categories with search/filter and collapsible sections. */
function AnalysisChartsGrid() {
  const [openChart, setOpenChart] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());

  const categories: Array<{
    title: string;
    color: string;
    charts: Array<{ id: string; label: string; desc: string; icon: React.ReactNode }>;
  }> = [
    {
      title: "概览",
      color: "text-primary",
      charts: [
        { id: "overview", label: "结构概览仪表盘", desc: "8项分析汇总一屏,含质量/二级结构/SASA等", icon: <LayoutDashboard className="h-3.5 w-3.5" /> },
        { id: "comparison", label: "结构比较仪表盘", desc: "2-4个结构并列对比13项指标,★标记最优值", icon: <GitCompare className="h-3.5 w-3.5" /> },
      ],
    },
    {
      title: "几何分析",
      color: "text-emerald-600",
      charts: [
        { id: "rama", label: "Ramachandran", desc: "φ/ψ二面角分布,评估构象合理性", icon: <Activity className="h-3.5 w-3.5" /> },
        { id: "bfactor", label: "B-factor", desc: "原子热运动/模型置信度分布", icon: <BarChart3 className="h-3.5 w-3.5" /> },
        { id: "ss", label: "二级结构", desc: "α-螺旋/β-折叠/转角/卷曲比例", icon: <Spline className="h-3.5 w-3.5" /> },
        { id: "seqalign", label: "序列比对", desc: "两条链的Needleman-Wunsch全局比对", icon: <AlignLeft className="h-3.5 w-3.5" /> },
        { id: "rmsd", label: "RMSD 矩阵", desc: "多个PDB的CA原子两两Kabsch叠合RMSD", icon: <Grid3x3 className="h-3.5 w-3.5" /> },
      ],
    },
    {
      title: "相互作用",
      color: "text-sky-600",
      charts: [
        { id: "disulfide", label: "二硫键", desc: "CYS-CYS SG-SG <2.5Å共价交联", icon: <Link2 className="h-3.5 w-3.5" /> },
        { id: "aromatic", label: "芳香堆积", desc: "π-π堆积+阳离子-π (PHE/TYR/TRP/HIS)", icon: <Sigma className="h-3.5 w-3.5" /> },
        { id: "water", label: "水桥", desc: "蛋白-水-蛋白氢键网络 (HOH中介)", icon: <Droplets className="h-3.5 w-3.5" /> },
        { id: "metal", label: "金属配位", desc: "Zn/Mg/Ca/Fe等金属离子的配位几何", icon: <Atom className="h-3.5 w-3.5" /> },
        { id: "contactmap", label: "接触图谱", desc: "链间CA-CA距离矩阵热图", icon: <Grid3x3 className="h-3.5 w-3.5" /> },
        { id: "interaction", label: "互作网络", desc: "氢键/盐桥/疏水接触力导向网络图", icon: <Network className="h-3.5 w-3.5" /> },
      ],
    },
    {
      title: "配体与组装",
      color: "text-amber-600",
      charts: [
        { id: "pocket", label: "结合口袋", desc: "配体周围残基+体积估算+分类", icon: <Target className="h-3.5 w-3.5" /> },
        { id: "ligand", label: "配体指纹", desc: "原子级接触指纹(H键/疏水/芳香/离子)", icon: <Fingerprint className="h-3.5 w-3.5" /> },
        { id: "oligomer", label: "寡聚体", desc: "寡聚类型+链间界面+对称性分析", icon: <Boxes className="h-3.5 w-3.5" /> },
      ],
    },
    {
      title: "药物发现",
      color: "text-pink-600",
      charts: [
        { id: "druggability", label: "可药性", desc: "口袋评分+疏水/极性/电荷分布+3D高亮", icon: <Pill className="h-3.5 w-3.5" /> },
        { id: "apbs_surface", label: "APBS 静电表面", desc: "pdb2pqr电荷+Debye-Hückel静电势+3D着色", icon: <Zap className="h-3.5 w-3.5" /> },
        { id: "screening", label: "虚拟筛选", desc: "片段库打分+亲和力ΔG预测+Ki排序", icon: <FlaskConical className="h-3.5 w-3.5" /> },
        { id: "detect_pockets", label: "多口袋检测", desc: "网格法自动检测表面凹陷+可药性排序", icon: <Target className="h-3.5 w-3.5" /> },
      ],
    },
    {
      title: "质量评估",
      color: "text-violet-600",
      charts: [
        { id: "sasa", label: "SASA", desc: "溶剂可及表面积(freesasa计算)", icon: <CircleDashed className="h-3.5 w-3.5" /> },
        { id: "surface", label: "表面残基", desc: "表面暴露vs内部buried残基分类", icon: <SunMedium className="h-3.5 w-3.5" /> },
        { id: "electrostatic", label: "静电势", desc: "残基净电荷+库仑相互作用能", icon: <Zap className="h-3.5 w-3.5" /> },
        { id: "validation", label: "结构验证", desc: "碰撞/拉氏异常/缺侧链综合评分", icon: <ShieldCheck className="h-3.5 w-3.5" /> },
      ],
    },
  ];

  const totalCharts = categories.reduce((sum, cat) => sum + cat.charts.length, 0);

  const toggleCollapse = (title: string) => {
    setCollapsedCats((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  };

  const filteredCategories = searchQuery.trim()
    ? categories
        .map((cat) => ({
          ...cat,
          charts: cat.charts.filter((c) =>
            c.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
            c.id.toLowerCase().includes(searchQuery.toLowerCase())
          ),
        }))
        .filter((cat) => cat.charts.length > 0)
    : categories;

  return (
    <div className="space-y-2">
      {/* Search + count */}
      <div className="flex items-center gap-2">
        <Label className="text-[9px] text-muted-foreground shrink-0">分析图表</Label>
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-1.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索图表…"
            className="h-6 pl-6 text-[10px]"
          />
        </div>
        <Badge variant="outline" className="shrink-0 text-[9px]">
          {totalCharts}
        </Badge>
      </div>

      {filteredCategories.length === 0 && searchQuery && (
        <div className="rounded-md border border-dashed p-3 text-center text-[10px] text-muted-foreground">
          未找到匹配的图表
        </div>
      )}

      {filteredCategories.map((cat) => {
        const isCollapsed = collapsedCats.has(cat.title) && !searchQuery;
        return (
          <div key={cat.title}>
            <button
              onClick={() => toggleCollapse(cat.title)}
              className={`mb-1 flex w-full items-center gap-1 text-[9px] font-medium uppercase tracking-wide ${cat.color} ${
                searchQuery ? "cursor-default" : "hover:opacity-80"
              }`}
            >
              {cat.title}
              <Badge variant="outline" className="ml-0.5 px-1 py-0 text-[8px] font-normal">
                {cat.charts.length}
              </Badge>
              {!searchQuery && (
                <ChevronRight
                  className={`ml-auto h-3 w-3 transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                />
              )}
            </button>
            {!isCollapsed && (
              <div className="grid grid-cols-2 gap-1">
                {cat.charts.map((c) => (
                  <TooltipProvider key={c.id} delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setOpenChart(openChart === c.id ? null : c.id)}
                          data-active={openChart === c.id}
                          className={`chart-tile flex items-center gap-1.5 rounded-md border p-1.5 text-[10px] ${
                            openChart === c.id
                              ? "border-primary bg-primary/5 text-primary"
                              : "hover:border-primary/50 hover:bg-accent/30"
                          }`}
                        >
                          {c.icon}
                          {c.label}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[200px] text-[10px]">
                        <div className="font-medium">{c.label}</div>
                        <div className="text-muted-foreground">{c.desc}</div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {openChart && (
        <div className="mt-2">
          <ChartLoader chartId={openChart} onClose={() => setOpenChart(null)} />
        </div>
      )}
    </div>
  );
}

import { RamachandranPlot } from "@/components/charts/ramachandran-plot";
import { BfactorChart } from "@/components/charts/bfactor-chart";
import { InteractionNetwork } from "@/components/charts/interaction-network";
import { SequenceAlignment } from "@/components/charts/sequence-alignment";
import { RmsdMatrix } from "@/components/charts/rmsd-matrix";
import { SasaChart } from "@/components/charts/sasa-chart";
import { DisulfideChart } from "@/components/charts/disulfide-chart";
import { SecondaryStructureChart } from "@/components/charts/secondary-structure-chart";
import { AromaticStackingChart } from "@/components/charts/aromatic-stacking-chart";
import { WaterBridgesChart } from "@/components/charts/water-bridges-chart";
import { MetalCoordinationChart } from "@/components/charts/metal-coordination-chart";
import { StructureValidationChart } from "@/components/charts/structure-validation-chart";
import { BindingPocketChart } from "@/components/charts/binding-pocket-chart";
import { OligomerAnalysisChart } from "@/components/charts/oligomer-analysis-chart";
import { LigandInteractionsChart } from "@/components/charts/ligand-interactions-chart";
import { ElectrostaticChart } from "@/components/charts/electrostatic-chart";
import { ContactMapChart } from "@/components/charts/contact-map-chart";
import { SurfaceResiduesChart } from "@/components/charts/surface-residues-chart";
import { StructureOverviewDashboard } from "@/components/charts/structure-overview-dashboard";
import { StructureComparisonDashboard } from "@/components/charts/structure-comparison-dashboard";
import { DruggabilityChart } from "@/components/charts/druggability-chart";
import { ApbsSurfaceChart } from "@/components/charts/apbs-surface-chart";
import { ScreeningChart } from "@/components/charts/screening-chart";
import { PocketDetectionChart } from "@/components/charts/pocket-detection-chart";

function ChartLoader({ chartId, onClose }: { chartId: string; onClose: () => void }) {
  return (
    <div className="relative rounded-lg border bg-card">
      <button
        onClick={onClose}
        className="absolute right-1.5 top-1.5 z-10 grid h-5 w-5 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
      {chartId === "overview" && <StructureOverviewDashboard />}
      {chartId === "comparison" && <StructureComparisonDashboard />}
      {chartId === "rama" && <RamachandranPlot />}
      {chartId === "bfactor" && <BfactorChart />}
      {chartId === "ss" && <SecondaryStructureChart />}
      {chartId === "sasa" && <SasaChart />}
      {chartId === "disulfide" && <DisulfideChart />}
      {chartId === "aromatic" && <AromaticStackingChart />}
      {chartId === "water" && <WaterBridgesChart />}
      {chartId === "metal" && <MetalCoordinationChart />}
      {chartId === "validation" && <StructureValidationChart />}
      {chartId === "pocket" && <BindingPocketChart />}
      {chartId === "ligand" && <LigandInteractionsChart />}
      {chartId === "oligomer" && <OligomerAnalysisChart />}
      {chartId === "electrostatic" && <ElectrostaticChart />}
      {chartId === "contactmap" && <ContactMapChart />}
      {chartId === "surface" && <SurfaceResiduesChart />}
      {chartId === "interaction" && <InteractionNetwork />}
      {chartId === "seqalign" && <SequenceAlignment />}
      {chartId === "rmsd" && <RmsdMatrix />}
      {chartId === "druggability" && <DruggabilityChart />}
      {chartId === "apbs_surface" && <ApbsSurfaceChart />}
      {chartId === "screening" && <ScreeningChart />}
      {chartId === "detect_pockets" && <PocketDetectionChart />}
    </div>
  );
}
