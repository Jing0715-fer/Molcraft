"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dna,
  Crosshair,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { fetchPolymerEntity } from "@/lib/rcsb-client";
import { executeCommand } from "@/lib/molstar/commands";

// Standard amino acid 3-letter → 1-letter + color (Lesk color scheme)
const AA_COLORS: Record<string, { one: string; color: string; name: string }> = {
  ALA: { one: "A", color: "#9999ff", name: "Alanine" },
  ARG: { one: "R", color: "#ff6666", name: "Arginine" },
  ASN: { one: "N", color: "#66ccff", name: "Asparagine" },
  ASP: { one: "D", color: "#ff9999", name: "Aspartate" },
  CYS: { one: "C", color: "#ffff66", name: "Cysteine" },
  GLN: { one: "Q", color: "#66ffcc", name: "Glutamine" },
  GLU: { one: "E", color: "#ff9966", name: "Glutamate" },
  GLY: { one: "G", color: "#cccccc", name: "Glycine" },
  HIS: { one: "H", color: "#66ffff", name: "Histidine" },
  ILE: { one: "I", color: "#66ff99", name: "Isoleucine" },
  LEU: { one: "L", color: "#99cc66", name: "Leucine" },
  LYS: { one: "K", color: "#ff6699", name: "Lysine" },
  MET: { one: "M", color: "#ffcc66", name: "Methionine" },
  PHE: { one: "F", color: "#66ccff", name: "Phenylalanine" },
  PRO: { one: "P", color: "#ffcc99", name: "Proline" },
  SER: { one: "S", color: "#ff9966", name: "Serine" },
  THR: { one: "T", color: "#ccff66", name: "Threonine" },
  TRP: { one: "W", color: "#9966ff", name: "Tryptophan" },
  TYR: { one: "Y", color: "#ffff66", name: "Tyrosine" },
  VAL: { one: "V", color: "#99ff99", name: "Valine" },
};

// Nucleotide colors
const NT_COLORS: Record<string, { one: string; color: string; name: string }> = {
  DA: { one: "A", color: "#a0d8ef", name: "Adenine" },
  DC: { one: "C", color: "#f8b86b", name: "Cytosine" },
  DG: { one: "G", color: "#95d094", name: "Guanine" },
  DT: { one: "T", color: "#f29879", name: "Thymine" },
  A: { one: "A", color: "#a0d8ef", name: "Adenine" },
  C: { one: "C", color: "#f8b86b", name: "Cytosine" },
  G: { one: "G", color: "#95d094", name: "Guanine" },
  U: { one: "U", color: "#f29879", name: "Uracil" },
};

// Chothia CDR definitions for antibodies (heavy + light chain, by Kabat numbering)
interface CdrRegion {
  name: string;
  start: number;
  end: number;
  chain: "H" | "L" | "any";
  color: string;
}

// Chothia CDR definitions (approximate, by residue index within chain)
const CDR_DEFINITIONS: CdrRegion[] = [
  // Heavy chain CDRs (Chothia)
  { name: "H-CDR1", start: 26, end: 35, chain: "H", color: "#ef4444" },
  { name: "H-CDR2", start: 50, end: 65, chain: "H", color: "#f97316" },
  { name: "H-CDR3", start: 95, end: 102, chain: "H", color: "#eab308" },
  // Light chain CDRs (Chothia)
  { name: "L-CDR1", start: 24, end: 34, chain: "L", color: "#10b981" },
  { name: "L-CDR2", start: 50, end: 56, chain: "L", color: "#06b6d4" },
  { name: "L-CDR3", start: 89, end: 97, chain: "L", color: "#8b5cf6" },
];

interface ChainSequenceData {
  entityId: string;
  authChain: string;
  labelChain: string;
  sequence: string; // 1-letter codes
  description: string;
  length: number;
  organism: string | null;
  isHeavy: boolean;
  isLight: boolean;
}

export function SequenceViewer() {
  const structures = useAppStore((s) => s.structures);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [chains, setChains] = useState<ChainSequenceData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCdr, setShowCdr] = useState(true);
  const [selectedResidues, setSelectedResidues] = useState<
    Record<string, Set<number>>
  >({});
  const [hoveredResidue, setHoveredResidue] = useState<{
    chain: string;
    resno: number;
    name: string;
  } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const primaryStructure = structures[0];

  const loadSequences = useCallback(async () => {
    if (!primaryStructure) {
      setChains([]);
      return;
    }
    if (!/^[a-zA-Z0-9]{4}$/.test(primaryStructure.id)) {
      setError("序列查看器仅支持 PDB ID（4 字符）");
      setChains([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Fetch entry to get polymer entity IDs
      const entryRes = await fetch(
        `/api/analyze/metadata?id=${primaryStructure.id}&interfaces=0`
      );
      if (!entryRes.ok) throw new Error(`HTTP ${entryRes.status}`);
      const entryData = await entryRes.json();
      const polymerEntityIds: string[] =
        entryData.polymers?.map((p: { entityId: string }) => p.entityId) ?? [];

      const chainData: ChainSequenceData[] = [];
      for (const eid of polymerEntityIds) {
        try {
          const p = await fetchPolymerEntity(primaryStructure.id, eid);
          const isHeavy =
            /heavy|vh\b|fab.*heavy/i.test(p.description) ||
            p.authChains.some((c) => c === "H");
          const isLight =
            /light|vl\b|fab.*light/i.test(p.description) ||
            p.authChains.some((c) => c === "L");
          chainData.push({
            entityId: eid,
            authChain: p.authChains.join(",") || p.chains.join(","),
            labelChain: p.chains.join(","),
            sequence: p.sequence,
            description: p.description,
            length: p.sequenceLength,
            organism: p.organism,
            isHeavy,
            isLight,
          });
        } catch (err) {
          console.warn(`Failed to fetch polymer ${eid}:`, err);
        }
      }
      // Sort: Heavy first, then Light, then others
      chainData.sort((a, b) => {
        if (a.isHeavy && !b.isHeavy) return -1;
        if (!a.isHeavy && b.isHeavy) return 1;
        if (a.isLight && !b.isLight) return -1;
        if (!a.isLight && b.isLight) return 1;
        return a.authChain.localeCompare(b.authChain);
      });
      setChains(chainData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`序列加载失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [primaryStructure, toast]);

  useEffect(() => {
    loadSequences();
  }, [loadSequences]);

  const handleResidueClick = useCallback(
    async (chain: string, resno: number, residueName: string) => {
      if (!viewer) return;
      // Toggle selection
      setSelectedResidues((prev) => {
        const next = { ...prev };
        const set = new Set(next[chain] ?? []);
        if (set.has(resno)) set.delete(resno);
        else set.add(resno);
        next[chain] = set;
        return next;
      });
      // Focus the residue in the viewer
      try {
        await executeCommand(viewer, {
          type: "focus_residue",
          chain,
          resno,
        });
        toast(`聚焦 ${chain} 链 ${residueName}${resno}`, "info");
      } catch (err) {
        toast(`聚焦失败: ${err}`, "error");
      }
    },
    [viewer, toast]
  );

  const handleSelectCdr = useCallback(
    async (chain: string, cdr: CdrRegion) => {
      if (!viewer) return;
      // Select all CDR residues
      setSelectedResidues((prev) => {
        const next = { ...prev };
        const set = new Set(next[chain] ?? []);
        for (let i = cdr.start; i <= cdr.end; i++) set.add(i);
        next[chain] = set;
        return next;
      });
      // Focus the CDR region
      try {
        await executeCommand(viewer, {
          type: "focus_residue",
          chain,
          resno: Math.round((cdr.start + cdr.end) / 2),
        });
        toast(`选中 ${cdr.name} (${chain} 链 ${cdr.start}-${cdr.end})`, "success");
      } catch (err) {
        toast(`聚焦失败: ${err}`, "error");
      }
    },
    [viewer, toast]
  );

  const clearSelection = useCallback(() => {
    setSelectedResidues({});
    if (viewer) {
      executeCommand(viewer, { type: "clear_selection" });
    }
  }, [viewer]);

  const selectedCount = useMemo(
    () =>
      Object.values(selectedResidues).reduce(
        (sum, set) => sum + set.size,
        0
      ),
    [selectedResidues]
  );

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b px-3">
        <div className="flex items-center gap-2">
          <Dna className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">序列查看器</span>
          {chains.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {chains.length} 链
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={`h-7 w-7 ${showCdr ? "text-primary" : ""}`}
                  onClick={() => setShowCdr((v) => !v)}
                  title="显示/隐藏 CDR 区域"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>切换 CDR 区域标注</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={loadSequences}
            disabled={loading}
            title="重新加载序列"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
      </div>

      {/* Status bar */}
      {primaryStructure && (
        <div className="flex shrink-0 items-center justify-between border-b bg-accent/20 px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="font-mono">{primaryStructure.id.toUpperCase()}</span>
          {selectedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
              onClick={clearSelection}
            >
              清除 {selectedCount} 个选择
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      <ScrollArea className="flex-1 min-h-0 scrollbar-thin" ref={scrollRef as never}>
        <div className="p-3">
          {loading && (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {!loading && !error && chains.length === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {primaryStructure
                ? "无聚合物实体"
                : "加载一个 PDB 结构以查看序列"}
            </div>
          )}

          {chains.map((chain) => (
            <ChainStrip
              key={chain.entityId}
              chain={chain}
              showCdr={showCdr}
              selectedResidues={selectedResidues[chain.authChain] ?? new Set()}
              hoveredResidue={hoveredResidue}
              onResidueClick={handleResidueClick}
              onResidueHover={setHoveredResidue}
              onSelectCdr={handleSelectCdr}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Hover info */}
      {hoveredResidue && (
        <div className="shrink-0 border-t bg-accent/20 px-3 py-1.5 text-[10px]">
          <span className="font-mono text-foreground">
            {hoveredResidue.chain}:{hoveredResidue.name}
            {hoveredResidue.resno}
          </span>
          <span className="ml-2 text-muted-foreground">
            {AA_COLORS[hoveredResidue.name]?.name ??
              NT_COLORS[hoveredResidue.name]?.name ??
              hoveredResidue.name}
          </span>
        </div>
      )}
    </div>
  );
}

interface ChainStripProps {
  chain: ChainSequenceData;
  showCdr: boolean;
  selectedResidues: Set<number>;
  hoveredResidue: { chain: string; resno: number; name: string } | null;
  onResidueClick: (chain: string, resno: number, name: string) => void;
  onResidueHover: (
    residue: { chain: string; resno: number; name: string } | null
  ) => void;
  onSelectCdr: (chain: string, cdr: CdrRegion) => void;
}

function ChainStrip({
  chain,
  showCdr,
  selectedResidues,
  hoveredResidue,
  onResidueClick,
  onResidueHover,
  onSelectCdr,
}: ChainStripProps) {
  // Parse sequence into residue array (1-letter → we don't have 3-letter per
  // residue from the API, so we infer from the 1-letter code for AAs).
  const residues = useMemo(() => {
    return chain.sequence.split("").map((one, i) => {
      const resno = i + 1; // 1-based within entity
      // Reverse-lookup 3-letter from 1-letter
      let three = one;
      let color = "#e5e7eb";
      let name = "Unknown";
      for (const [t3, info] of Object.entries(AA_COLORS)) {
        if (info.one === one) {
          three = t3;
          color = info.color;
          name = info.name;
          break;
        }
      }
      for (const [t3, info] of Object.entries(NT_COLORS)) {
        if (info.one === one) {
          three = t3;
          color = info.color;
          name = info.name;
          break;
        }
      }
      return { resno, one, three, color, name, index: i };
    });
  }, [chain.sequence]);

  // Determine chain type for CDR annotation
  const chainType: "H" | "L" | null = chain.isHeavy
    ? "H"
    : chain.isLight
    ? "L"
    : null;

  // CDR regions for this chain
  const cdrRegions = chainType
    ? CDR_DEFINITIONS.filter((c) => c.chain === chainType)
    : [];

  // Determine the auth chain (first one if multiple)
  const authChain = chain.authChain.split(",")[0];

  // Render in chunks of 10 for readability
  const chunks = useMemo(() => {
    const result: Array<Array<typeof residues[0] & { position: number }>> = [];
    for (let i = 0; i < residues.length; i += 10) {
      const chunk = residues.slice(i, i + 10).map((r, j) => ({
        ...r,
        position: i + j + 1,
      }));
      result.push(chunk);
    }
    return result;
  }, [residues]);

  return (
    <div className="mb-4 rounded-lg border bg-background p-3">
      {/* Chain header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className="font-mono text-xs"
            style={{
              backgroundColor: chain.isHeavy
                ? "#fef3c7"
                : chain.isLight
                ? "#dbeafe"
                : undefined,
            }}
          >
            链 {chain.authChain}
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            {chain.description}
          </span>
        </div>
        <span className="font-mono text-[10px] text-muted-foreground">
          {chain.length} aa
        </span>
      </div>

      {/* CDR legend */}
      {showCdr && cdrRegions.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {cdrRegions.map((cdr) => (
            <button
              key={cdr.name}
              onClick={() => onSelectCdr(authChain, cdr)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium transition hover:opacity-80"
              style={{ backgroundColor: cdr.color + "30", color: cdr.color }}
              title={`${cdr.name}: 残基 ${cdr.start}-${cdr.end}`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: cdr.color }}
              />
              {cdr.name}
            </button>
          ))}
        </div>
      )}

      {/* Sequence strip */}
      <div className="overflow-x-auto scrollbar-thin">
        <div className="flex flex-col gap-0.5 font-mono text-[10px]">
          {chunks.map((chunk, chunkIdx) => (
            <div key={chunkIdx} className="flex items-stretch gap-0">
              {/* Position label */}
              <div className="flex w-10 shrink-0 items-center justify-end pr-2 text-muted-foreground">
                {chunk[0].position}
              </div>
              {/* Residues */}
              <div className="flex gap-0.5">
                {chunk.map((res) => {
                  const isSelected = selectedResidues.has(res.resno);
                  const isHovered =
                    hoveredResidue?.chain === authChain &&
                    hoveredResidue?.resno === res.resno;
                  const inCdr = cdrRegions.find(
                    (c) => res.resno >= c.start && res.resno <= c.end
                  );
                  return (
                    <TooltipProvider key={res.resno} delayDuration={150}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            onClick={() =>
                              onResidueClick(authChain, res.resno, res.three)
                            }
                            onMouseEnter={() =>
                              onResidueHover({
                                chain: authChain,
                                resno: res.resno,
                                name: res.three,
                              })
                            }
                            onMouseLeave={() => onResidueHover(null)}
                            className={`grid h-7 w-7 shrink-0 place-items-center rounded text-[10px] font-semibold transition ${
                              isSelected
                                ? "ring-2 ring-foreground ring-offset-1"
                                : isHovered
                                ? "scale-110 ring-1 ring-foreground/40"
                                : ""
                            }`}
                            style={{
                              backgroundColor: res.color,
                              color: getContrastColor(res.color),
                              boxShadow: inCdr
                                ? `inset 0 -2px 0 ${inCdr.color}`
                                : undefined,
                            }}
                            title={`${res.three} ${res.resno} — ${res.name}`}
                          >
                            {res.one}
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <div className="font-mono">
                            {authChain}:{res.three}
                            {res.resno}
                          </div>
                          <div className="text-muted-foreground">{res.name}</div>
                          {inCdr && (
                            <div
                              className="font-medium"
                              style={{ color: inCdr.color }}
                            >
                              {inCdr.name}
                            </div>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Chain footer */}
      {chain.organism && (
        <div className="mt-2 text-[10px] text-muted-foreground">
          来源: {chain.organism}
        </div>
      )}
    </div>
  );
}

/** Pick black or white text color for a given background hex color. */
function getContrastColor(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "#000000";
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.55 ? "#000000" : "#ffffff";
}
