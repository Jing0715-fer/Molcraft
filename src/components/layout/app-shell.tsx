"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MessageSquare, FileText, Ruler, Triangle, X, Trash2, History } from "lucide-react";
import { TopBar } from "./top-bar";
import { UnifiedLeftPanel } from "./unified-left-panel";
import { ChatPanel } from "./chat-panel";
import { ReportsPanel } from "./reports-panel";
import { HistoryPanel } from "./history-panel";
import { MolstarViewer } from "@/components/molstar/molstar-viewer";
import { MeasureOverlay } from "@/components/molstar/measure-overlay";
import { disableFocusBehaviors, clearAllMeasurementsAndFocus, extractAtomInfoFromLoci } from "@/lib/molstar/measure";
import { useAppStore, selectActiveStructure, registerToast } from "@/lib/store";
import { toast as sonnerToast } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { useState, useEffect, useRef } from "react";
import { Microscope, FlaskConical, Activity } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileLayout } from "./mobile-layout";
import { useLang } from "@/lib/i18n";

interface StructureInfo {
  pdbId: string;
  title: string;
  methods: string[];
  resolution: number | null;
  molecularWeight: number | null;
  chainCount: number;
  ligands: Array<{ compId: string; name: string }>;
}

export function AppShell() {
  const rightPanelTab = useAppStore((s) => s.rightPanelTab);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const activeStructure = useAppStore(selectActiveStructure);
  const structures = useAppStore((s) => s.structures);
  const commandLog = useAppStore((s) => s.commandLog);
  const { t } = useLang();

  // Auto-fetch structure info when the *active* structure changes (multi-structure aware)
  const primaryId = activeStructure?.id;
  const [structureInfo, setStructureInfo] = useState<StructureInfo | null>(null);
  const lastFetchedId = useRef<string | null>(null);

  useEffect(() => {
    if (!primaryId || !/^[a-zA-Z0-9]{4}$/.test(primaryId)) {
      // Clear stale info when switching to a non-PDB or empty active structure.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStructureInfo(null);
      lastFetchedId.current = null;
      return;
    }
    if (lastFetchedId.current === primaryId) return;
    lastFetchedId.current = primaryId;
    let cancelled = false;
    fetch(`/api/analyze/metadata?id=${primaryId}&interfaces=0`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setStructureInfo({
          pdbId: primaryId.toUpperCase(),
          title: data.entry?.title ?? primaryId,
          methods: data.entry?.methods ?? [],
          resolution: data.entry?.resolution ?? null,
          molecularWeight: data.entry?.molecularWeight ?? null,
          chainCount: data.polymers?.length ?? 0,
          ligands: data.nonpolymers ?? [],
        });
      })
      .catch(() => {
        // ignore — overlay just won't show info
      });
    return () => {
      cancelled = true;
    };
  }, [primaryId]);

  // Wire the store's toast() to sonner.
  useEffect(() => {
    registerToast((msg, kind = "default") => {
      switch (kind) {
        case "success":
          sonnerToast.success(msg);
          break;
        case "error":
          sonnerToast.error(msg);
          break;
        case "info":
          sonnerToast.info(msg);
          break;
        default:
          sonnerToast(msg);
      }
    });
  }, []);

  const isMobile = useIsMobile();

  // Mobile: use bottom-nav sheet layout
  const viewerBlock = (
    <div className="relative h-full w-full">
      <MolstarViewer className="absolute inset-0" />
      <ViewerOverlay
        structures={structures}
        activeStructure={activeStructure}
        commandLog={commandLog}
        structureInfo={structureInfo}
      />
      <MeasureOverlay />
      <MeasureToolbar />
    </div>
  );

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background">
        <TopBar />

        {isMobile ? (
          <div className="flex-1 min-h-0">
            <MobileLayout>{viewerBlock}</MobileLayout>
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
            {/* Left: unified tools + analysis */}
            <ResizablePanel defaultSize={23} minSize={16} maxSize={40}>
              <UnifiedLeftPanel />
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Center: viewer */}
            <ResizablePanel defaultSize={52} minSize={30}>
              {viewerBlock}
            </ResizablePanel>

            <ResizableHandle withHandle />

            {/* Right: AI assistant / reports */}
            <ResizablePanel defaultSize={25} minSize={18} maxSize={42}>
              <Tabs
                value={rightPanelTab}
                onValueChange={(v) =>
                  setRightPanelTab(v as "chat" | "reports" | "history")
                }
                className="flex h-full flex-col"
              >
                <TabsList className="uni-tablist grid-cols-3">
                  <TabsTrigger value="chat" className="uni-tab">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {t("ai_assistant")}
                  </TabsTrigger>
                  <TabsTrigger value="history" className="uni-tab">
                    <History className="h-3.5 w-3.5" />
                    历史
                  </TabsTrigger>
                  <TabsTrigger value="reports" className="uni-tab">
                    <FileText className="h-3.5 w-3.5" />
                    {t("reports")}
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="chat" className="mt-0 flex-1 min-h-0">
                  <ChatPanel />
                </TabsContent>
                <TabsContent value="history" className="mt-0 flex-1 min-h-0">
                  <HistoryPanel />
                </TabsContent>
                <TabsContent value="reports" className="mt-0 flex-1 min-h-0">
                  <ReportsPanel />
                </TabsContent>
              </Tabs>
            </ResizablePanel>
          </ResizablePanelGroup>
        )}

        <Footer />
        <Toaster richColors closeButton position="top-right" />
      </div>
    </TooltipProvider>
  );
}

/** Click-to-measure toolbar — uses Molstar's interactivity selection system.
 *  When measure mode is active, we set granularity to "element" and listen
 *  for loci selects. Each click adds a loci to pending; when enough are
 *  collected we call measurement.addDistance/addAngle. */
function MeasureToolbar() {
  const viewer = useAppStore((s) => s.viewer);
  const measureMode = useAppStore((s) => s.measureMode);
  const setMeasureMode = useAppStore((s) => s.setMeasureMode);
  const measurements = useAppStore((s) => s.measurements);
  const addMeasurement = useAppStore((s) => s.addMeasurement);
  const removeMeasurement = useAppStore((s) => s.removeMeasurement);
  const clearMeasurements = useAppStore((s) => s.clearMeasurements);
  const addInteractionLine = useAppStore((s) => s.addInteractionLine);
  const clearInteractionLines = useAppStore((s) => s.clearInteractionLines);
  const structures = useAppStore((s) => s.structures);
  const toast = useAppStore((s) => s.toast);
  const { t } = useLang();
  const pendingRef = useRef<unknown[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  // Holds the cleanup function returned by disableFocusBehaviors (restores
  // clickFocus/clickCenterFocus props + removes the semi-transparent
  // ball-and-stick representation added for measure mode).
  const restoreFocusRef = useRef<(() => void) | null>(null);
  // Entry guard: entering measure mode (and disableFocusBehaviors) fires a
  // synthetic click event through behaviors.interaction.click. We ignore
  // click events for a short window after entering measure mode so the
  // toolbar starts at "0/2" instead of "1/2".
  const entryGuardUntilRef = useRef(0);

  // When measure mode changes, set Molstar interactivity granularity + disable
  // focus behavior + add a semi-transparent ball-and-stick representation so
  // the user can see individual atoms through the cartoon (借鉴 upload project).
  useEffect(() => {
    if (!viewer) return;
    const plugin = viewer.plugin;
    if (!plugin?.managers?.interactivity) return;

    if (measureMode !== "off") {
      // Set granularity to element so clicks resolve to individual atoms.
      plugin.managers.interactivity.setProps({ granularity: "element" });
      // Clear any previous HIGHLIGHTS only. Do NOT call lociSelects.deselectAll()
      // here — it fires a synthetic click event through the behaviors.interaction.click
      // observable, which our click subscriber picks up and adds to pendingRef,
      // causing the toolbar to show "1/2" immediately after entering measure
      // mode instead of the expected "0/2". Clearing highlights is enough.
      try { plugin.managers.interactivity.lociHighlights.clearHighlights(); } catch {}
      // Arm the entry guard: ignore click events for 500ms after entering
      // measure mode. disableFocusBehaviors + the granularity change can
      // each fire a synthetic click event with the currently-highlighted
      // loci, which would instantly bump pending to 1.
      entryGuardUntilRef.current = Date.now() + 500;
      // Clear pending. Resetting pendingCount here is necessary because
      // entering measure mode invalidates any half-collected measurement;
      // gated by length>0 to avoid a redundant render when already empty.
      if (pendingRef.current.length > 0) {
        pendingRef.current = [];
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPendingCount(0);
      }

      // Disable clickFocus / clickCenterFocus (prevents sidechain disappearing)
      // AND add a semi-transparent ball-and-stick overlay so atoms are visible.
      disableFocusBehaviors(plugin)
        .then((restore) => {
          restoreFocusRef.current = restore;
          try { plugin.canvas3d?.requestDraw?.(); } catch {}
        })
        .catch((e) => console.warn("Failed to disable focus behavior:", e));
    } else {
      // Exiting measure mode: restore focus behavior + remove the
      // semi-transparent ball-and-stick representation.
      const restore = restoreFocusRef.current;
      if (restore) {
        try { restore(); } catch (e) { console.warn("restore focus failed:", e); }
        restoreFocusRef.current = null;
      }
      // Also clear interaction overlay lines + any lingering measurements
      // so the viewer returns to a clean state.
      try { clearAllMeasurementsAndFocus(plugin); } catch {}
    }
  }, [viewer, measureMode]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      const restore = restoreFocusRef.current;
      if (restore) {
        try { restore(); } catch {}
        restoreFocusRef.current = null;
      }
    };
  }, []);

  // Subscribe to Molstar click events when in measure mode.
  // Molstar's click event is at plugin.behaviors.interaction.click (NOT plugin.events.interactivity.click).
  // The event payload is { current: { loci: StructureElement.Loci }, buttons, button, modifiers, page, position }.
  useEffect(() => {
    if (!viewer || measureMode === "off") return;
    const plugin = viewer.plugin as any;
    // Try both paths: behaviors.interaction.click (correct) and events.interactivity.click (fallback).
    const clickObs = plugin?.behaviors?.interaction?.click ?? plugin?.events?.interactivity?.click;
    if (!clickObs) return;

    const sub = clickObs.subscribe((evt: any) => {
      try {
        // Entry guard: ignore synthetic click events fired within 500ms of
        // entering measure mode (disableFocusBehaviors + granularity change
        // each fire one with the currently-highlighted loci).
        if (Date.now() < entryGuardUntilRef.current) return;
        // The loci is at evt.current.loci (behaviors.interaction.click format).
        const loci = evt?.current?.loci ?? evt?.state?.loci ?? evt?.current;
        if (!loci) return;
        // Check if loci is empty.
        const elements = (loci as any).elements;
        if (elements && elements.length === 0) return;

        // Do NOT call lociSelects.deselectAll() here — it was causing the
        // pending counter to reset because Molstar re-processes the deselection
        // as a new "empty click" event, which triggers our handler again.
        // Instead, just accumulate the loci.

        const newPending = [...pendingRef.current, loci];
        const needed = measureMode === "distance" ? 2 : 3;

        if (newPending.length < needed) {
          pendingRef.current = newPending;
          setPendingCount(newPending.length);
          // Highlight the clicked atom (visual feedback only, no selection).
          try { plugin.managers.interactivity.lociHighlights.highlightOnly({ loci }); } catch {}
          return;
        }

        // Complete the measurement. Extract atom info from each loci so we
        // can show residue/atom/distance in the list AND draw our own overlay
        // line (which can be removed individually — Molstar's native
        // addDistance can't be removed one-at-a-time).
        const atomInfos = newPending.map((l) => extractAtomInfoFromLoci(plugin, l));

        if (measureMode === "distance" && newPending.length === 2) {
          const [a0, a1] = atomInfos;
          // We do NOT call mm.addDistance here — Molstar's native measurement
          // manager has no per-item remove API, so lines would accumulate.
          // Instead we draw via our own overlay (interactionLines), which can
          // be removed individually via the list's X button.
          const dist =
            a0 && a1
              ? Math.sqrt((a0.x - a1.x) ** 2 + (a0.y - a1.y) ** 2 + (a0.z - a1.z) ** 2)
              : null;
          const lineId = `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          if (a0 && a1) {
            addInteractionLine({
              id: lineId,
              from: { x: a0.x, y: a0.y, z: a0.z, label: a0.label },
              to: { x: a1.x, y: a1.y, z: a1.z, label: a1.label },
              color: "#f59e0b",
              label: dist != null ? `${dist.toFixed(2)} Å` : "",
              dashed: false,
            });
          }
          const label =
            a0 && a1
              ? `${a0.resname ?? ""}${a0.resno ?? ""}${a0.chain ? `.${a0.chain}` : ""}/${a0.atomName ?? "?"} ↔ ${a1.resname ?? ""}${a1.resno ?? ""}${a1.chain ? `.${a1.chain}` : ""}/${a1.atomName ?? "?"}`
              : t("distance_measured");
          const detail = dist != null ? `${dist.toFixed(2)} Å` : t("shown_in_3d");
          addMeasurement({
            mode: "distance",
            label,
            detail,
            lineId: a0 && a1 ? lineId : undefined,
          });
          toast(t("distance_added"), "success");
        } else if (measureMode === "angle" && newPending.length === 3) {
          const [a0, a1, a2] = atomInfos;
          const label =
            a0 && a1 && a2
              ? `${a0.resname ?? ""}${a0.resno ?? ""}/${a0.atomName ?? "?"} · ${a1.resname ?? ""}${a1.resno ?? ""}/${a1.atomName ?? "?"} · ${a2.resname ?? ""}${a2.resno ?? ""}/${a2.atomName ?? "?"}`
              : t("angle_measured");
          // For angles, also draw overlay lines connecting the 3 atoms.
          const angleLineBase = `ml-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          if (a0 && a1 && a2) {
            addInteractionLine({
              id: `${angleLineBase}-1`,
              from: { x: a0.x, y: a0.y, z: a0.z, label: a0.label },
              to: { x: a1.x, y: a1.y, z: a1.z, label: a1.label },
              color: "#8b5cf6",
              dashed: false,
            });
            addInteractionLine({
              id: `${angleLineBase}-2`,
              from: { x: a1.x, y: a1.y, z: a1.z, label: a1.label },
              to: { x: a2.x, y: a2.y, z: a2.z, label: a2.label },
              color: "#8b5cf6",
              dashed: false,
            });
          }
          addMeasurement({
            mode: "angle",
            label,
            detail: t("shown_in_3d"),
          });
          toast(t("angle_added"), "success");
        }
        pendingRef.current = [];
        setPendingCount(0);
        // Clear highlights after measurement is done.
        try { plugin.managers.interactivity.lociHighlights.clearHighlights(); } catch {}
      } catch (err) {
        console.warn("Measurement click failed:", err);
        pendingRef.current = [];
        setPendingCount(0);
      }
    });

    return () => {
      try { sub.unsubscribe(); } catch {}
    };
  }, [viewer, measureMode, addMeasurement, toast]);

  // Cleanup on unmount or mode change.
  useEffect(() => {
    if (measureMode === "off" && viewer) {
      const plugin = viewer.plugin as any;
      try {
        plugin?.managers?.interactivity?.lociSelects?.deselectAll();
        plugin?.managers?.interactivity?.lociHighlights?.clearHighlights();
      } catch {}
    }
  }, [measureMode, viewer]);

  if (structures.length === 0) return null;

  const needed = measureMode === "distance" ? 2 : measureMode === "angle" ? 3 : 0;

  const resetPending = () => {
    pendingRef.current = [];
    setPendingCount(0);
    if (viewer) {
      const plugin = viewer.plugin as any;
      // Only clear highlights — deselectAll() fires a synthetic click event
      // that the subscriber picks up, instantly bumping pending to 1.
      try {
        plugin?.managers?.interactivity?.lociHighlights?.clearHighlights();
      } catch {}
    }
  };

  return (
    <>
      {/* Measure mode toolbar (bottom-center) */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 rounded-full border border-border/60 bg-card/95 backdrop-blur px-1 py-1 shadow-sm">
        <button
          type="button"
          onClick={() => { setMeasureMode(measureMode === "distance" ? "off" : "distance"); resetPending(); }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            measureMode === "distance"
              ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
          title={t("distance") + " — click 2 atoms"}
        >
          <Ruler className="h-3 w-3" /> {t("distance")}
        </button>
        <button
          type="button"
          onClick={() => { setMeasureMode(measureMode === "angle" ? "off" : "angle"); resetPending(); }}
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
            measureMode === "angle"
              ? "bg-violet-500/20 text-violet-700 dark:text-violet-300"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
          }`}
          title={t("angle") + " — click 3 atoms"}
        >
          <Triangle className="h-3 w-3" /> {t("angle")}
        </button>
        {measureMode !== "off" && (
          <>
            <div className="h-4 w-px bg-border/60 mx-0.5" />
            <span className="text-[10px] text-muted-foreground px-1.5 tabular-nums">
              {pendingCount}/{needed}
            </span>
            {pendingCount > 0 && (
              <button
                type="button"
                onClick={resetPending}
                className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                title={t("reset_selection")}
              >
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              onClick={() => { setMeasureMode("off"); resetPending(); }}
              className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground"
              title={t("exit_measure")}
            >
              <X className="h-3 w-3" />
            </button>
          </>
        )}
      </div>

      {/* Measurements panel (bottom-left) */}
      {measurements.length > 0 && (
        <div className="absolute bottom-2 left-2 z-20 max-w-[260px]">
          <div className="rounded-md border border-border/60 bg-card/95 backdrop-blur shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-border/40">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t("measurements")} ({measurements.length})
              </span>
              <button
                type="button"
                onClick={() => {
                  clearMeasurements();
                  clearInteractionLines();
                  if (viewer) {
                    try { viewer.plugin.managers.structure.measurement.clear(); } catch {}
                  }
                  toast(t("clear_all_measurements"), "info");
                }}
                className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                title={t("clear_all_measurements")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-40 overflow-y-auto scrollbar-thin">
              {measurements.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-2 px-2.5 py-1.5 border-b border-border/30 last:border-0 hover:bg-muted/30"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      m.mode === "distance" ? "bg-amber-500" : "bg-violet-500"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-mono font-semibold">
                      {m.label}
                    </div>
                    <div className="text-[9px] text-muted-foreground truncate">
                      {m.detail}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeMeasurement(m.id)}
                    className="p-0.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive"
                    title="移除测量"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ViewerOverlay({
  structures,
  activeStructure,
  commandLog,
  structureInfo,
}: {
  structures: Array<{ id: string; label: string }>;
  activeStructure: { id: string; label: string } | null;
  commandLog: Array<{ ts: number; type: string; ok: boolean; detail?: string }>;
  structureInfo: StructureInfo | null;
}) {
  return (
    <>
      {/* Top-left overlay: structure info card */}
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex w-72 flex-col gap-1.5">
        {structureInfo && (
          <div className="pointer-events-auto overflow-hidden rounded-lg border bg-background/85 shadow-sm backdrop-blur">
            {/* Header */}
            <div className="flex items-center gap-1.5 border-b bg-primary/5 px-2.5 py-1.5">
              <Microscope className="h-3.5 w-3.5 text-primary" />
              <span className="font-mono text-xs font-semibold tracking-wide">
                {structureInfo.pdbId}
              </span>
              <span className="ml-auto rounded bg-emerald-500/15 px-1.5 py-0 text-[9px] font-medium text-emerald-700">
                {structureInfo.methods[0]?.slice(0, 2) ?? "?"}
              </span>
            </div>
            {/* Title (truncated) */}
            <div className="px-2.5 pt-1.5 text-[11px] leading-tight text-foreground">
              {structureInfo.title.length > 60
                ? structureInfo.title.slice(0, 60) + "…"
                : structureInfo.title}
            </div>
            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-1 px-2.5 py-2 text-[10px]">
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">分辨率</div>
                <div className="font-mono font-medium text-foreground">
                  {structureInfo.resolution
                    ? `${structureInfo.resolution}Å`
                    : "—"}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">链数</div>
                <div className="font-mono font-medium text-foreground">
                  {structureInfo.chainCount}
                </div>
              </div>
              <div>
                <div className="text-[9px] uppercase text-muted-foreground">分子量</div>
                <div className="font-mono font-medium text-foreground">
                  {structureInfo.molecularWeight
                    ? `${structureInfo.molecularWeight}kDa`
                    : "—"}
                </div>
              </div>
            </div>
            {/* Ligands */}
            {structureInfo.ligands.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 border-t bg-amber-500/5 px-2.5 py-1.5">
                <FlaskConical className="h-3 w-3 text-amber-600" />
                <span className="text-[9px] uppercase text-muted-foreground">配体</span>
                {structureInfo.ligands.slice(0, 3).map((l) => (
                  <span
                    key={l.compId}
                    className="rounded bg-amber-500/15 px-1 py-0 font-mono text-[10px] text-amber-700"
                  >
                    {l.compId}
                  </span>
                ))}
                {structureInfo.ligands.length > 3 && (
                  <span className="text-[9px] text-muted-foreground">
                    +{structureInfo.ligands.length - 3}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
        {!structureInfo && structures.length > 0 && (
          <div className="pointer-events-auto rounded-md bg-background/80 px-2 py-1 text-[11px] font-medium shadow-sm backdrop-blur">
            <span className="text-muted-foreground">当前: </span>
            <span className="font-mono text-foreground">{activeStructure?.label ?? structures[0]?.label}</span>
          </div>
        )}
      </div>

      {/* Top-right overlay: chain legend (when structure loaded) */}
      {structureInfo && (
        <div className="pointer-events-none absolute right-3 top-3 z-10">
          <div className="pointer-events-auto rounded-md bg-background/80 px-2.5 py-1.5 text-[10px] shadow-sm backdrop-blur">
            <div className="flex items-center gap-1.5">
              <Activity className="h-3 w-3 text-primary" />
              <span className="font-medium uppercase tracking-wide text-muted-foreground">
                已加载
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Bottom-left overlay: recent command log */}
      {commandLog.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-xs">
          <div className="rounded-md bg-background/85 px-2 py-1.5 text-[10px] shadow-sm backdrop-blur">
            <div className="mb-0.5 font-medium uppercase tracking-wide text-muted-foreground">
              最近指令
            </div>
            <div className="max-h-24 overflow-y-auto scrollbar-thin">
              {commandLog.slice(0, 5).map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 py-0.5">
                  <span className={c.ok ? "text-emerald-600" : "text-destructive"}>
                    {c.ok ? "✓" : "✗"}
                  </span>
                  <span className="font-mono text-[10px]">{c.type}</span>
                  {c.detail && (
                    <span className="truncate text-muted-foreground">
                      {c.detail.length > 40 ? c.detail.slice(0, 40) + "…" : c.detail}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bottom-right overlay: hint */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10">
        <div className="rounded-md bg-background/80 px-2.5 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
          <span className="font-medium text-foreground">提示</span>
          {" · "}
          鼠标拖动旋转 · 滚轮缩放 · 右键平移
        </div>
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t bg-card/60 px-3 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>MolCraft AI · Molstar 5.11</span>
        <span className="hidden sm:inline">·</span>
        <span className="hidden sm:inline">
          自然语言驱动 · 测量 · 互作分析 · 结构比对 · 图文报告
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="hidden md:inline">Powered by Z.ai GLM</span>
      </div>
    </footer>
  );
}
