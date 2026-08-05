"use client";

import { useEffect, useRef } from "react";
import { useMolstarLoader } from "./use-molstar-loader";
import { useAppStore } from "@/lib/store";
import type { MolstarViewer } from "@/lib/molstar/types";

interface MolstarViewerProps {
  className?: string;
}

/**
 * Embeds the Molstar viewer. We use the high-level `Viewer.create` API from
 * the prebuilt bundle with a heavily customised options object that strips
 * most of the built-in chrome (we render our own toolbars around the canvas).
 *
 * The viewer instance is published into the global Zustand store so every
 * other panel (tools, chat) can call its imperative API.
 */
export function MolstarViewer({ className }: MolstarViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<MolstarViewer | null>(null);
  const { molstar, error } = useMolstarLoader();
  const setViewer = useAppStore((s) => s.setViewer);
  const toast = useAppStore((s) => s.toast);

  useEffect(() => {
    if (!molstar || !containerRef.current) return;
    if (viewerRef.current) return; // already created

    let disposed = false;
    const el = containerRef.current;

    molstar.Viewer.create(el, {
      // Strip the built-in UI chrome — we render our own panels.
      layoutIsExpanded: false,
      layoutShowControls: false,
      layoutShowRemoteState: "none" as unknown as boolean,
      layoutShowSequence: false,
      layoutShowLog: false,
      layoutShowLeftPanel: false,
      collapseLeftPanel: true,
      collapseRightPanel: true,
      // Viewport controls — keep just the essentials.
      viewportShowReset: true,
      viewportShowScreenshotControls: false,
      viewportShowControls: true,
      viewportShowExpand: false,
      viewportShowToggleFullscreen: true,
      viewportShowSettings: true,
      viewportShowSelectionMode: true,
      viewportShowAnimation: false,
      viewportShowTrajectoryControls: true,
      viewportFocusBehavior: "default",
      // Picking: enable atom-level picking so click-to-measure works.
      pickScale: 1,
      pickPadding: 1,
      // Rendering quality.
      disableAntialiasing: false,
      pixelScale: 1,
      transparency: "wboit",
      preferWebgl1: false,
      allowMajorPerformanceCaveat: false,
      powerPreference: "high-performance",
      resolutionMode: "auto",
      illumination: false,
      // Data sources.
      pdbProvider: "pdbe",
      emdbProvider: "pdbe",
      volumeStreamingServer: "https://www.ebi.ac.uk/pdbe/densities",
      volumeStreamingDisabled: false,
      // Enable the extensions we actually use.
      extensions: [
        "mp4-export",
        "backgrounds",
        "geo-export",
        "model-export",
        "assembly-symmetry",
        "rcsb-validation-report",
        "pdbe-structure-quality-report",
        "anvil-membrane-orientation",
        "ma-quality-assessment",
      ],
      disabledExtensions: [],
      viewportBackgroundColor: "#ffffff",
    })
      .then((viewer: MolstarViewer) => {
        if (disposed) {
          viewer.dispose();
          return;
        }
        viewerRef.current = viewer;
        setViewer(viewer);
        toast("Molstar 已就绪", "success");
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`Molstar 初始化失败: ${msg}`, "error");
      });

    // Resize observer to keep the canvas in sync with its container.
    const ro = new ResizeObserver(() => {
      viewerRef.current?.handleResize();
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      if (viewerRef.current) {
        try {
          viewerRef.current.dispose();
        } catch {
          // ignore
        }
        viewerRef.current = null;
      }
      // Don't clear the store viewer on cleanup — the next effect run
      // will set a new one. Clearing here causes race conditions with
      // HMR / Fast Refresh where the cleanup runs after the new viewer
      // is already set.
    };
  }, [molstar, setViewer, toast]);

  return (
    <div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <div className="viewer-backdrop absolute inset-0 -z-10" />
      <div
        ref={containerRef}
        className="absolute inset-0"
        style={{ minHeight: 0 }}
      />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            Molstar 加载失败: {error}
          </div>
        </div>
      )}
      {!molstar && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-muted-foreground">
            <div className="relative h-12 w-12">
              <div className="absolute inset-0 rounded-full border-2 border-primary/30" />
              <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin" />
            </div>
            <p className="text-sm">正在加载 Molstar 查看器…</p>
          </div>
        </div>
      )}
    </div>
  );
}
