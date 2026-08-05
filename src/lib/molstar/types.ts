/**
 * Type definitions for the Molstar viewer integration.
 *
 * The prebuilt `molstar` bundle (loaded via /molstar.js) exposes a global
 * `window.molstar` object whose public surface mirrors `lib/apps/viewer/`.
 * We declare only the subset we actually use so the rest stays `any`-free
 * without dragging in the full (heavy) TypeScript definitions.
 */

export interface MolstarGlobal {
  Viewer: MolstarViewerConstructor;
  lib?: {
    plugin?: {
      PluginContext?: unknown;
      PluginConfig?: unknown;
      StateTransforms?: unknown;
      StateActions?: unknown;
      DefaultPluginUISpec?: unknown;
    };
    structure?: unknown;
  };
  presets?: unknown;
  version?: string;
}

export interface MolstarViewerConstructor {
  create(
    elementOrId: string | HTMLElement,
    options?: Partial<MolstarViewerOptions>
  ): Promise<MolstarViewer>;
}

export interface MolstarViewerOptions {
  customFormats: [string, unknown][];
  extensions: string[];
  disabledExtensions: string[];
  layoutIsExpanded: boolean;
  layoutShowControls: boolean;
  layoutShowRemoteState: boolean;
  layoutControlsDisplay: string;
  layoutShowSequence: boolean;
  layoutShowLog: boolean;
  layoutShowLeftPanel: boolean;
  collapseLeftPanel: boolean;
  collapseRightPanel: boolean;
  disableAntialiasing?: boolean;
  pixelScale?: number;
  pickScale?: number;
  transparency?: "blended" | "wboit" | "dpoit";
  preferWebgl1?: boolean;
  allowMajorPerformanceCaveat?: boolean;
  powerPreference?: WebGLPowerPreference;
  resolutionMode?: "auto" | "scaled" | "native";
  illumination?: boolean;
  viewportShowReset?: boolean;
  viewportShowScreenshotControls?: boolean;
  viewportShowControls?: boolean;
  viewportShowExpand?: boolean;
  viewportShowToggleFullscreen?: boolean;
  viewportShowSettings?: boolean;
  viewportShowSelectionMode?: boolean;
  viewportShowAnimation?: boolean;
  viewportShowTrajectoryControls?: boolean;
  viewportFocusBehavior?: "default" | "secondary-zoom" | "disabled";
  viewportBackgroundColor?: string;
  pluginStateServer?: string;
  volumeStreamingServer?: string;
  volumeStreamingDisabled?: boolean;
  pdbProvider?: "rcsb" | "pdbe" | "pdbj";
  emdbProvider?: "pdbe" | "rcsb";
  saccharideCompIdMapType?: string;
  config?: [unknown, unknown][];
}

/** Subset of the Viewer class API we depend on. */
export interface MolstarViewer {
  plugin: MolstarPlugin;
  handleResize(): void;
  loadPdb(pdb: string, options?: unknown): Promise<void>;
  loadPdbIhm(pdbIhm: string): Promise<void>;
  loadEmdb(emdb: string, options?: { detail?: number }): Promise<void>;
  loadAlphaFoldDb(afdb: string): Promise<void>;
  loadModelArchive(id: string): Promise<void>;
  loadStructureFromUrl(
    url: string,
    format?: string,
    isBinary?: boolean,
    options?: { label?: string }
  ): Promise<void>;
  loadStructureFromData(
    data: string | number[],
    format: string,
    options?: { dataLabel?: string }
  ): Promise<void>;
  loadVolumeFromUrl(
    payload: { url: string; format: string; isBinary: boolean },
    isovalues: VolumeIsovalue[],
    options?: { entryId?: string | string[]; isLazy?: boolean }
  ): Promise<void>;
  loadSnapshotFromUrl(url: string, type: "molj" | "molx"): Promise<void>;
  loadFiles(files: File[]): Promise<void>;
  structureInteractivity(options: StructureInteractivityOptions): void;
  dispose(): void;
}

export interface VolumeIsovalue {
  type: "relative" | "absolute";
  value: number;
  color?: number;
  volumeIndex?: number;
}

export interface StructureInteractivityOptions {
  expression?: (Q: unknown) => unknown;
  elements?: Array<Record<string, unknown>>;
  action?: Array<"select" | "highlight" | "focus" | "clear">;
  focusOptions?: { minRadius?: number; durationMs?: number };
}

/** Subset of PluginUIContext we use. */
export interface MolstarPlugin {
  managers: {
    structure: {
      hierarchy: {
        current: {
          structures: Array<{
            cell?: { obj?: { data?: unknown } };
            components?: Array<unknown>;
          }>;
          selection: { structures: unknown[] };
        };
        applyPreset(structures: unknown, preset: string): Promise<void>;
        remove(refs: unknown): Promise<void>;
        updateCurrent(structureDef: unknown): Promise<void>;
        add(structure: unknown): Promise<void>;
      };
      component: {
        applyPreset(refs: unknown, preset: string): Promise<void>;
        updateRepresentationsTheme(
          components: unknown,
          theme: { color?: string; colorParams?: unknown }
        ): void;
        addRepresentation(component: unknown, params: unknown): Promise<void>;
        removeRepresentations(components: unknown): Promise<void>;
        modifyBySelection(
          component: unknown,
          modifier: (state: unknown) => void,
          loci: unknown
        ): Promise<void>;
        state: { options: Record<string, unknown> };
      };
      selection: {
        modify(
          op: "add" | "remove" | "intersect" | "set",
          loci: unknown
        ): void;
        clear(): void;
        entries: unknown;
        getLoci(structure: unknown): unknown;
        getBoundary(): { sphere?: { center?: unknown; radius?: number } };
      };
      measurement: MolstarMeasurementManager;
      focus?: unknown;
    };
    interactivity: {
      lociHighlights: {
        highlight(opts: { loci: unknown }, applyGranularity?: boolean): void;
        highlightOnly(opts: { loci: unknown }): void;
        clearHighlights(): void;
      };
      lociSelects: {
        select(opts: { loci: unknown }, applyGranularity?: boolean): void;
        deselectAll(): void;
      };
      setProps(props: { granularity?: string }): void;
    };
    camera: {
      focusLoci(loci: unknown, options?: unknown): void;
      focusSphere(opts: { center: unknown; radius: number }): void;
      reset(): void;
    };
    animation: {
      play(anim: unknown, params?: unknown): void;
      stop(): void;
      clear(): void;
      state: unknown;
    };
    snapshots?: {
      add(opts?: unknown): Promise<unknown>;
      replace(id: string, opts?: unknown): Promise<unknown>;
      remove(id: string): Promise<unknown>;
      apply(id: string): Promise<void>;
      clear(): Promise<void>;
      downloadToFile(type: "molj" | "molx"): Promise<void>;
      openFile(file: File): Promise<void>;
      openUrl(url: string, type: "molj" | "molx"): Promise<void>;
    };
    lociLabels?: {
      getLabel(loci: unknown): string;
    };
  };
  helpers?: {
    viewportScreenshot?: {
      getImageDataUri(opts?: {
        width?: number;
        height?: number;
        transparency?: boolean;
        axes?: boolean;
      }): Promise<string | undefined>;
      getCanvas?(): unknown;
    };
    camera?: { focusLoci?(loci: unknown, options?: unknown): void };
    substructureParent?: { get(structure: unknown): unknown };
  };
  state: {
    data: {
      build(): MolstarStateBuilder;
      applyAction(action: unknown, params: unknown): Promise<unknown>;
      selectQ(query: (state: unknown) => unknown[]): unknown[];
      transaction(fn: () => Promise<void>): Promise<void>;
    };
    behaviors: unknown;
    snapshots: unknown;
  };
  builders: {
    data: {
      download(opts: { url: string; isBinary?: boolean }, state?: unknown): unknown;
      rawData(opts: { data: unknown; label?: string }, state?: unknown): unknown;
    };
    structure: {
      parseTrajectory(data: unknown, format: string): unknown;
      createModel(trajectory: unknown, index?: number): unknown;
      createStructure(model: unknown, def?: unknown): unknown;
      tryCreateComponentFromExpression(
        structure: unknown,
        expression: unknown,
        label: string
      ): unknown;
      representation: {
        addRepresentation(
          component: unknown,
          params: {
            type: string;
            typeParams?: Record<string, unknown>;
            color?: string;
            colorParams?: unknown;
          }
        ): unknown;
        applyPreset(structure: unknown, preset: string): unknown;
      };
      hierarchy: { applyPreset(trajectory: unknown, preset: string): unknown };
    };
    volume: {
      parse(data: unknown, format: string, opts?: { entryId?: string }): unknown;
      createRepresentation(volume: unknown, params: unknown): unknown;
    };
  };
  build(): MolstarStateBuilder;
  runTask<T>(task: Promise<T>): Promise<T>;
  dataTransaction(fn: () => Promise<void>): Promise<void>;
  clear(): Promise<void>;
  dispose(): void;
  canvas3d?: {
    props: {
      trackball: {
        animate?: { name: string; params: { speed?: number; axis?: unknown } };
      };
      [k: string]: unknown;
    };
  };
  events?: {
    interactivity?: {
      click?: { subscribe(cb: (v: unknown) => void): { unsubscribe(): void } };
      hover?: { subscribe(cb: (v: unknown) => void): { unsubscribe(): void } };
    };
  };
}

export interface MolstarStateBuilder {
  toRoot(): MolstarStateBuilder;
  to(ref: unknown): MolstarStateBuilder;
  apply(
    transform: unknown,
    params?: unknown,
    opts?: unknown
  ): MolstarStateBuilder & { selector: unknown };
  update(transform: unknown, fn: (old: unknown) => unknown): MolstarStateBuilder;
  insert(transform: unknown, params?: unknown): MolstarStateBuilder;
  commit(opts?: { revertOnError?: boolean; canUndo?: boolean }): Promise<void>;
  selector: unknown;
}

export interface MolstarMeasurementManager {
  addDistance(a: unknown, b: unknown, options?: unknown): Promise<unknown>;
  addAngle(a: unknown, b: unknown, c: unknown, options?: unknown): Promise<unknown>;
  addDihedral(
    a: unknown,
    b: unknown,
    c: unknown,
    d: unknown,
    options?: unknown
  ): Promise<unknown>;
  addLabel(a: unknown, options?: unknown): Promise<unknown>;
  addOrientation(a: unknown, options?: unknown): Promise<unknown>;
  addPlane(a: unknown, options?: unknown): Promise<unknown>;
  setOptions(opts: { distanceUnitLabel?: string; textColor?: unknown }): void;
  clear(): void;
  state: unknown;
  behaviors?: {
    state?: { subscribe(cb: (v: unknown) => void): { unsubscribe(): void } };
  };
  events?: {
    changed?: { subscribe(cb: () => void): { unsubscribe(): void } };
  };
}

declare global {
  interface Window {
    molstar?: MolstarGlobal;
  }
}
