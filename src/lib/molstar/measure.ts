/**
 * Measurement helpers for the Molstar integration.
 *
 * Solves three problems that the v1 MeasureToolbar had:
 *
 *  1. Click-to-measure broke because Molstar's default `clickCenterFocus`
 *     behavior hides sidechains (zooms into a single residue) and re-fires
 *     click events. `disableFocusBehaviors` snapshot-protects those props
 *     and reverts them on cleanup.
 *
 *  2. We need actual 3D coords of clicked atoms so we can compute
 *     distance/angle ourselves (defensive — Molstar's own measurement
 *     manager does this too, but having the numbers lets us show them in
 *     the side panel). `extractAtomInfoFromLoci` walks the loci shape
 *     without depending on the minified bundle's internal module names.
 *
 *  3. Water-bridge "聚焦并画线" needs to (a) show residue sidechains and
 *     (b) draw a distance line between the two protein atoms through the
 *     water molecule. `focusResidueSidechain` + `addDistanceWithCoords`
 *     handle that.
 */

import type { MolstarPlugin } from "./types";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

export interface AtomInfo {
  x: number;
  y: number;
  z: number;
  chain?: string;
  resno?: number;
  resname?: string;
  atomName?: string;
  element?: string;
  /** Human-readable label e.g. "ASP30.A/OD1" or just "atom" if all else fails. */
  label: string;
  /** Original loci (kept so we can hand it back to Molstar's measurement
   *  manager which needs loci, not just coords, to draw the native line). */
  loci?: unknown;
}

interface AtomInfoWithLoci extends AtomInfo {
  loci?: unknown;
}

// -----------------------------------------------------------------
// Helpers for walking the (minified) StructureElement.Loci shape
// -----------------------------------------------------------------

/**
 * Molstar's `OrderedSet<T>` has two implementations:
 *   - Interval: `{ min, max }` (contiguous)
 *   - SortedArray: `{ array: T[] }`
 * Both expose `getAt(i)`, but minified bundles sometimes lose the method.
 * This helper handles both shapes plus plain arrays.
 */
function orderedSetGetAt(set: unknown, i: number): number | null {
  if (set == null) return null;
  const s = set as {
    getAt?: (i: number) => number;
    min?: number;
    max?: number;
    array?: ArrayLike<number>;
    size?: number;
  };
  if (typeof s.getAt === "function") {
    try {
      const v = s.getAt(i);
      if (typeof v === "number") return v;
    } catch {
      /* fall through */
    }
  }
  // Interval shape
  if (typeof s.min === "number" && typeof s.max === "number") {
    if (s.max > s.min) return s.min + i;
  }
  // SortedArray shape
  if (s.array && typeof s.array.length === "number" && s.array.length > i) {
    return s.array[i];
  }
  // Plain array
  if (Array.isArray(set) && set.length > i) {
    return set[i] as number;
  }
  return null;
}

/** Get a value from a molstar `Column<T>`. Columns expose either `.value(i)`
 *  or direct indexed access depending on the storage layout. */
function columnValue<T = string>(
  col: unknown,
  i: number
): T | undefined {
  if (col == null) return undefined;
  const c = col as {
    value?: (i: number) => T;
    valueOrDefault?: (i: number, d: T) => T;
    array?: ArrayLike<T>;
    toArray?: () => T[];
  };
  if (typeof c.value === "function") {
    try {
      return c.value(i);
    } catch {
      /* fall through */
    }
  }
  if (typeof c.valueOrDefault === "function") {
    try {
      return c.valueOrDefault(i, undefined as unknown as T);
    } catch {
      /* fall through */
    }
  }
  if (c.array && typeof c.array.length === "number" && i < c.array.length) {
    return c.array[i];
  }
  return undefined;
}

/** Build a human label "RESNAMEresno.CHAIN/ATOMNAME". */
function buildAtomLabel(parts: {
  resname?: string;
  resno?: number;
  chain?: string;
  atomName?: string;
}): string {
  // Coerce all inputs to strings — Molstar's StructureProperties accessors
  // sometimes return Column/array view objects instead of primitive strings
  // in the minified bundle, which would otherwise stringify as "[object Object]".
  const coerce = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (typeof v === "number") return String(v);
    // Objects: try toString, then JSON, last resort empty.
    try {
      const s = String(v);
      if (s && s !== "[object Object]") return s;
    } catch {}
    return "";
  };
  const resname = coerce(parts.resname);
  const resnoRaw = typeof parts.resno === "number" ? parts.resno : undefined;
  const chain = coerce(parts.chain);
  const atomName = coerce(parts.atomName);

  const segs: string[] = [];
  if (resname) segs.push(resname);
  if (typeof resnoRaw === "number") segs.push(String(resnoRaw));
  const resPart = segs.join("");
  const chainPart = chain ? `.${chain}` : "";
  const atomPart = atomName ? `/${atomName}` : "";
  if (resPart || chain || atomName) return `${resPart}${chainPart}${atomPart}`;
  return "atom";
}

// -----------------------------------------------------------------
// Public API
// -----------------------------------------------------------------

/**
 * Extract representative atom info + 3D coords from a StructureElement.Loci
 * handed to us by `plugin.behaviors.interaction.click`.
 *
 * Returns null if the loci is empty or its shape is unrecognizable.
 */
export function extractAtomInfoFromLoci(
  plugin: MolstarPlugin,
  loci: unknown
): AtomInfo | null {
  if (!loci) return null;

  // Robust path: use the bundle's exposed `molstar.lib.loci.Loci.getCenter`
  // which returns a Vec3 (= [number, number, number]) for any loci kind.
  // This is far more reliable than walking the minified internal shape.
  let x: number | undefined;
  let y: number | undefined;
  let z: number | undefined;
  try {
    const bundle = (window as any).molstar;
    const Loci = bundle?.lib?.loci?.Loci;
    if (Loci && typeof Loci.getCenter === "function") {
      const center = Loci.getCenter(loci);
      if (center && typeof center[0] === "number") {
        x = center[0];
        y = center[1];
        z = center[2];
      }
    }
    // Fallback: try getBoundingSphere which returns { center: Vec3, radius }
    if (x == null && Loci && typeof Loci.getBoundingSphere === "function") {
      const sphere = Loci.getBoundingSphere(loci);
      const c = sphere?.center;
      if (c && typeof c[0] === "number") {
        x = c[0];
        y = c[1];
        z = c[2];
      }
    }
  } catch {
    /* fall through to internal walk */
  }

  // Walk the loci's elements for hierarchy info (residue/chain/atom names).
  // We use the bundle's StructureElement.Loci.getFirstLocation(loci) helper
  // which returns a fully-resolved StructureElement.Location (with structure,
  // unit, AND element all correctly set) — far more reliable than walking the
  // minified loci shape ourselves. From that Location, StructureProperties
  // accessors give us atom/residue/chain names + coords.
  let resname: string | undefined;
  let resno: number | undefined;
  let chain: string | undefined;
  let atomName: string | undefined;
  let element: string | undefined;

  try {
    const bundle = (window as any).molstar;
    const SP = bundle?.lib?.structure?.StructureProperties;
    const SE = bundle?.lib?.structure?.StructureElement;
    if (SP && SE?.Loci?.getFirstLocation) {
      const loc = SE.Loci.getFirstLocation(loci);
      if (loc) {
        try { atomName = SP.atom.label_atom_id(loc); } catch {}
        try { element = SP.atom.type_symbol(loc); } catch {}
        try { resname = SP.residue.auth_comp_id(loc) || SP.residue.label_comp_id(loc); } catch {}
        try {
          const authResno = SP.residue.auth_seq_id(loc);
          if (typeof authResno === "number") resno = authResno;
          else resno = SP.residue.label_seq_id(loc);
        } catch {}
        try { chain = SP.chain.auth_asym_id(loc) || SP.chain.label_asym_id(loc); } catch {}
        // Also fill coords from SP if Loci.getCenter didn't already.
        try {
          if (x == null) x = SP.atom.x(loc);
          if (y == null) y = SP.atom.y(loc);
          if (z == null) z = SP.atom.z(loc);
        } catch {}
      }
    }
  } catch {
    /* ignore — best-effort */
  }

  // If everything failed (no coords), bail.
  if (x == null || y == null || z == null) {
    return null;
  }

  // Use Molstar's label helper for a richer label if our walk failed.
  let label = buildAtomLabel({ resname, resno, chain, atomName });
  if (label === "atom") {
    // Try multiple label sources — the bundle exposes `lociLabels.getLabel`
    // and also `StructureElement.Loci` may have a toString/description.
    const tryLabel = (candidate: unknown): string | null => {
      if (typeof candidate !== "string") return null;
      const trimmed = candidate.replace(/\s+/g, " ").trim();
      // Skip empty, generic placeholders, and stringified objects
      // (lociLabels sometimes returns "[object Object]" for non-element loci kinds).
      if (!trimmed) return null;
      if (/^(atom|element|residue|chain|group|structure)$/i.test(trimmed)) return null;
      if (/^\[object object\]$/i.test(trimmed)) return null;
      if (/\[object object\]/i.test(trimmed)) return null;
      return trimmed;
    };
    try {
      const helper = plugin.managers.interactivity?.lociLabels;
      const lbl = tryLabel(helper?.getLabel?.(loci));
      if (lbl) label = lbl;
    } catch {
      /* ignore */
    }
    // Try the bundle's Loci module for a description.
    if (label === "atom") {
      try {
        const bundle = (window as any).molstar;
        const Loci = bundle?.lib?.loci?.Loci;
        // Some Loci kinds expose a `toString` or `description` helper.
        const desc = tryLabel((loci as any)?.toString?.());
        if (desc) label = desc;
      } catch {
        /* ignore */
      }
    }
    // Last resort: use the loci kind as a fallback so it's not just "atom".
    if (label === "atom") {
      const kind = (loci as any)?.kind;
      if (kind && typeof kind === "string") {
        // e.g. "element-loci" → "Atom", "group-loci" → "Group"
        const shortKind = kind.replace(/-loci$/i, "");
        if (shortKind === "element") label = "Atom";
        else if (shortKind === "group") label = "Group";
        else if (shortKind === "residue") label = "Residue";
        else if (shortKind === "chain") label = "Chain";
        else label = shortKind.charAt(0).toUpperCase() + shortKind.slice(1);
      }
    }
    // Final fallback: if still "atom" or empty, use the coordinates as a label.
    if (label === "atom" || !label) {
      label = `(${x!.toFixed(2)}, ${y!.toFixed(2)}, ${z!.toFixed(2)})`;
    }
  }

  return {
    x,
    y,
    z,
    chain,
    resno,
    resname,
    atomName,
    element,
    label,
    loci,
  };
}

/**
 * Disable clickFocus / clickCenterFocus / hoverHighlight during measure
 * mode (so clicks land in our pending-buffer instead of refocusing the
 * camera and hiding sidechains). Returns a restore function.
 */
export async function disableFocusBehaviors(plugin: MolstarPlugin): Promise<() => void> {
  const snapshots: Array<() => void> = [];

  try {
    const canvas3d = plugin.canvas3d as any;
    const interaction = canvas3d?.interaction;
    if (interaction) {
      // Snapshot the existing props (shallow clone of the subfields we touch).
      const prevProps = interaction.props ?? canvas3d?.props?.interaction ?? {};

      // Helper: clone a sub-prop so we don't mutate the original.
      const clickCenterFocus = prevProps.clickCenterFocus
        ? { ...prevProps.clickCenterFocus }
        : { isDisabled: false };
      const clickFocus = prevProps.clickFocus
        ? { ...prevProps.clickFocus }
        : { isDisabled: false };
      const hoverHighlight = prevProps.hoverHighlight
        ? { ...prevProps.hoverHighlight }
        : { isDisabled: false };
      const click = prevProps.click ? { ...prevProps.click } : {};

      // Disable.
      clickCenterFocus.isDisabled = true;
      clickFocus.isDisabled = true;
      hoverHighlight.isDisabled = true;
      if ("centerLoci" in click) click.centerLoci = false;
      if ("focusLoci" in click) click.focusLoci = false;

      try {
        // Use canvas3d.setProps (the proper Molstar API) — it takes a function
        // that mutates the props draft. Falls back to direct mutation.
        if (typeof canvas3d.setProps === "function") {
          canvas3d.setProps((p: any) => {
            if (!p.interaction) p.interaction = {};
            p.interaction.clickCenterFocus = clickCenterFocus;
            p.interaction.clickFocus = clickFocus;
            p.interaction.hoverHighlight = hoverHighlight;
            if (Object.keys(click).length > 0) {
              p.interaction.click = { ...(p.interaction.click || {}), ...click };
            }
          });
        } else if (interaction.props) {
          // Direct mutation fallback
          interaction.props.clickCenterFocus = clickCenterFocus;
          interaction.props.clickFocus = clickFocus;
          interaction.props.hoverHighlight = hoverHighlight;
          if (Object.keys(click).length > 0) {
            interaction.props.click = { ...(interaction.props.click || {}), ...click };
          }
        }
      } catch (e) {
        console.warn("[disableFocusBehaviors] apply failed:", e);
      }

      snapshots.push(() => {
        try {
          if (typeof canvas3d.setProps === "function") {
            canvas3d.setProps((p: any) => {
              if (!p.interaction) p.interaction = {};
              p.interaction.clickCenterFocus = prevProps.clickCenterFocus ?? { isDisabled: false };
              p.interaction.clickFocus = prevProps.clickFocus ?? { isDisabled: false };
              p.interaction.hoverHighlight = prevProps.hoverHighlight ?? { isDisabled: false };
              if (prevProps.click) p.interaction.click = prevProps.click;
            });
          } else if (interaction.props) {
            interaction.props.clickCenterFocus = prevProps.clickCenterFocus ?? { isDisabled: false };
            interaction.props.clickFocus = prevProps.clickFocus ?? { isDisabled: false };
            interaction.props.hoverHighlight = prevProps.hoverHighlight ?? { isDisabled: false };
            if (prevProps.click) interaction.props.click = prevProps.click;
          }
        } catch (e) {
          console.warn("[disableFocusBehaviors] restore failed:", e);
        }
      });
    }
  } catch (e) {
    console.warn("[disableFocusBehaviors] canvas3d interaction snapshot failed:", e);
  }

  // CRITICAL: Intercept ALL focus manager methods that create/remove focus
  // representations (ball-and-stick sidechains).
  //
  // Molstar's default click behavior calls these methods which create
  // "structure-focus-target-sel" and "structure-focus-surr-sel" components.
  // This causes sidechains to appear/disappear on clicks, which conflicts
  // with our overlay-based measurement.
  //
  // We replace ALL loci-setting methods with no-ops during measure mode and
  // restore them on exit.
  try {
    const focusMgr = (plugin.managers.structure as any).focus;
    if (focusMgr) {
      // Save originals.
      const methodsToIntercept = [
        "toggleFromLoci",
        "setFromLoci",
        "addFromLoci",
        "extendFromLoci",
      ];
      for (const m of methodsToIntercept) {
        if (typeof focusMgr[m] === "function") {
          if (!focusMgr._prevFocusMethods) focusMgr._prevFocusMethods = {};
          focusMgr._prevFocusMethods[m] = focusMgr[m].bind(focusMgr);
          focusMgr[m] = () => {
            // No-op during measure mode.
          };
        }
      }
      snapshots.push(() => {
        try {
          if (focusMgr._prevFocusMethods) {
            for (const [m, fn] of Object.entries(focusMgr._prevFocusMethods)) {
              focusMgr[m] = fn;
            }
            delete focusMgr._prevFocusMethods;
          }
        } catch {
          /* ignore */
        }
      });
    }
    // Clear any existing focus representation so we start clean.
    if (focusMgr && typeof focusMgr.clear === "function") {
      focusMgr.clear();
    }
    // Also remove any existing focus components from the structure hierarchy.
    try {
      const structs = plugin.managers.structure.hierarchy.current.structures;
      for (const sr of structs) {
        const comps = sr?.components || [];
        const focusComps = comps.filter((c: any) =>
          c?.cell?.transform?.tags?.some((t: string) => /focus/.test(t))
        );
        if (focusComps.length > 0) {
          plugin.managers.structure.hierarchy.remove(focusComps);
        }
      }
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }

  // Save + set interactivity granularity to "element" so clicks resolve to
  // individual atoms.
  try {
    const inter = plugin.managers.interactivity as any;
    const prevGranularity = inter?.props?.granularity;
    inter?.setProps?.({ granularity: "element" });
    if (prevGranularity !== undefined) {
      snapshots.push(() => {
        try {
          inter?.setProps?.({ granularity: prevGranularity });
        } catch {
          /* ignore */
        }
      });
    }
  } catch (e) {
    console.warn("[disableFocusBehaviors] granularity set failed:", e);
  }

  // CRITICAL: Add a ball-and-stick representation to the polymer component
  // so that individual atoms (side chains) are visible during measure mode.
  // Without this, the user can only see the cartoon backbone and cannot
  // tell which atom they are clicking. The representation is removed on exit.
  try {
    const structs = plugin.managers.structure.hierarchy.current.structures;
    for (const sr of structs) {
      const polymer = (sr as any)?.components?.find(
        (c: any) => c?.cell?.transform?.tags?.includes("structure-component-static-polymer")
      );
      if (polymer?.cell) {
        // Add ball-and-stick with low opacity so cartoon is still visible underneath.
        const rep = await plugin.builders.structure.representation.addRepresentation(
          polymer.cell,
          {
            type: "ball-and-stick",
            typeParams: { alpha: 0.5 },
            colorTheme: { name: "element", params: {} },
          }
        );
        if (rep) {
          // Tag it so we can find and remove it later.
          try {
            (rep as any).cell.transform.tags = [
              "measure-mode-ball-and-stick",
            ];
          } catch {
            /* ignore */
          }
          // Track for removal.
          measureModeReps.push(rep);
        }
      }
    }
    // Remove the ball-and-stick reps on exit.
    snapshots.push(() => {
      try {
        const repsToRemove = measureModeReps.slice();
        measureModeReps.length = 0;
        for (const rep of repsToRemove) {
          try {
            const ref = (rep as any)?.ref || (rep as any)?.cell?.transform?.ref;
            if (ref) {
              plugin.state.data.build().delete(ref).commit();
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    });
  } catch (e) {
    console.warn("[disableFocusBehaviors] add ball-and-stick failed:", e);
  }

  return () => {
    for (const restore of snapshots) {
      try {
        restore();
      } catch (e) {
        console.warn("[disableFocusBehaviors] restore failed:", e);
      }
    }
  };
}

/**
 * Add a distance measurement between two atoms. If both `a.loci` and
 * `b.loci` are available (from the click handler), uses Molstar's native
 * measurement manager — that draws the line + label in 3D. Otherwise logs
 * a warning (custom line drawing is out of scope here).
 */
export async function addDistanceWithCoords(
  plugin: MolstarPlugin,
  a: AtomInfoWithLoci,
  b: AtomInfoWithLoci,
  options?: { customText?: string }
): Promise<void> {
  const mm = plugin.managers.structure.measurement as any;
  if (!mm) {
    console.warn("[addDistanceWithCoords] no measurement manager");
    return;
  }
  if (a.loci && b.loci) {
    try {
      await mm.addDistance(a.loci, b.loci, options ? { params: options } : undefined);
      return;
    } catch (e) {
      console.warn("[addDistanceWithCoords] native addDistance failed:", e);
    }
  }
  // Without loci we can't draw a native line — just log the coords for debugging.
  console.warn(
    "[addDistanceWithCoords] missing loci; cannot draw native line. Coords:",
    { a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z } }
  );
}

/**
 * Add an angle measurement between three atoms (same approach as distance).
 */
export async function addAngleWithCoords(
  plugin: MolstarPlugin,
  a: AtomInfoWithLoci,
  b: AtomInfoWithLoci,
  c: AtomInfoWithLoci
): Promise<void> {
  const mm = plugin.managers.structure.measurement as any;
  if (!mm) {
    console.warn("[addAngleWithCoords] no measurement manager");
    return;
  }
  if (a.loci && b.loci && c.loci) {
    try {
      await mm.addAngle(a.loci, b.loci, c.loci);
      return;
    } catch (e) {
      console.warn("[addAngleWithCoords] native addAngle failed:", e);
    }
  }
  console.warn("[addAngleWithCoords] missing loci; cannot draw native angle.");
}

/**
 * Focus a residue and (best-effort) reveal its sidechain. Uses the
 * `viewer.structureInteractivity` helper to select+focus, which both
 * highlights the residue in 3D and moves the camera to it.
 *
 * NOTE: This needs the MolstarViewer (not just the plugin) because
 * `structureInteractivity` is a viewer-level API. Callers should pass
 * the plugin via `viewer.plugin` and the viewer separately.
 */
export async function focusResidueSidechain(
  plugin: MolstarPlugin,
  viewer: { structureInteractivity(opts: unknown): void } | undefined,
  ref: { chain?: string; resno?: number; compId?: string }
): Promise<void> {
  if (!viewer) {
    console.warn("[focusResidueSidechain] viewer missing");
    return;
  }
  const expr = (Q: any) => {
    const residueTests: any[] = [];
    if (ref.chain) {
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.auth_asym_id
            ? Q.struct.atomProperty.macromolecular.auth_asym_id()
            : Q.struct.atomProperty.macromolecular.label_asym_id(),
          ref.chain,
        ])
      );
    }
    if (ref.resno !== undefined) {
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.auth_seq_id
            ? Q.struct.atomProperty.macromolecular.auth_seq_id()
            : Q.struct.atomProperty.macromolecular.label_seq_id(),
          ref.resno,
        ])
      );
    }
    if (ref.compId) {
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.label_comp_id(),
          ref.compId,
        ])
      );
    }
    const residueTest =
      residueTests.length === 0
        ? undefined
        : residueTests.length === 1
        ? residueTests[0]
        : Q.core.logic.and(residueTests);

    const params: any = {
      "group-by": Q.struct.atomProperty.macromolecular.residueKey(),
    };
    if (residueTest) params["residue-test"] = residueTest;
    return Q.struct.generator.atomGroups(params);
  };

  try {
    // `action: ["select", "focus"]` both selects the residue (so its atoms
    // get highlighted — effectively showing the sidechain region) and
    // focuses the camera on it. minRadius ensures we don't zoom too tight.
    viewer.structureInteractivity({
      expression: expr,
      action: ["select", "focus"],
      focusOptions: { minRadius: 8, durationMs: 250 },
    });
    // Give the focus animation a moment to kick in.
    await new Promise((r) => setTimeout(r, 50));
  } catch (e) {
    console.warn("[focusResidueSidechain] failed:", e);
  }
}

/**
 * Show a residue's sidechain as a ball-and-stick representation.
 *
 * Creates a Molstar structure component for the specified residue and adds
 * a ball-and-stick representation to it. The component is tagged so it can
 * be removed later via `clearSidechainComponents`.
 *
 * Also focuses the camera on the residue.
 */
export async function showResidueSidechain(
  plugin: MolstarPlugin,
  ref: { chain?: string; resno?: number; compId?: string }
): Promise<void> {
  try {
    const bundle = (window as any).molstar;
    const SE = bundle?.lib?.structure?.StructureElement;
    const SP = bundle?.lib?.structure?.StructureProperties;
    if (!SE || !SP) {
      console.warn("[showResidueSidechain] StructureElement/Properties not available");
      return;
    }

    const structs = plugin.managers.structure.hierarchy.current.structures;
    if (!structs.length) return;
    const sr = structs[0];
    const data = sr?.cell?.obj?.data;
    if (!data) return;

    // Find ALL elements matching the residue spec across all atomic units.
    const elementsByUnit = new Map();
    for (const unit of data.units) {
      if (unit.kind !== 0) continue; // atomic only
      const indices = [];
      for (let i = 0; i < unit.elements.length; i++) {
        const loc = SE.Location.create(data, unit, i);
        if (ref.chain) {
          const chainId = SP.chain.auth_asym_id(loc) || SP.chain.label_asym_id(loc);
          if (chainId !== ref.chain) continue;
        }
        if (ref.resno !== undefined) {
          const resno = SP.residue.auth_seq_id(loc);
          if (resno !== ref.resno) continue;
        }
        if (ref.compId) {
          const compId = SP.residue.label_comp_id(loc);
          if (compId !== ref.compId) continue;
        }
        indices.push(i);
      }
      if (indices.length > 0) {
        elementsByUnit.set(unit, indices);
      }
    }

    if (elementsByUnit.size === 0) {
      console.warn(`[showResidueSidechain] residue ${ref.chain}:${ref.resno} not found`);
      return;
    }

    // Build the elements array for the loci.
    const elements: Array<{ unit: unknown; indices: number[] }> = [];
    elementsByUnit.forEach((indices, unit) => {
      elements.push({ unit, indices });
    });

    // Create a StructureElement.Loci and convert to expression.
    const loci = new SE.Loci(data, elements);
    const expr = SE.Loci.toExpression(loci);

    // Create a component with a unique tag for later removal.
    const tag = `sidechain-${ref.chain ?? ""}${ref.resno ?? ref.compId ?? ""}-${Date.now()}`;
    const component = await plugin.builders.structure.tryCreateComponentFromExpression(
      sr.cell, expr, tag
    );

    if (!component) {
      console.warn("[showResidueSidechain] component creation returned undefined");
      return;
    }

    // Track the component for later removal.
    sidechainComponents.push(component);

    // Add ball-and-stick representation.
    try {
      await plugin.builders.structure.representation.addRepresentation(component, {
        type: "ball-and-stick",
        typeParams: {},
        colorTheme: { name: "element", params: {} },
      });
    } catch (e) {
      console.warn("[showResidueSidechain] addRepresentation failed:", e);
    }

    // NOTE: Do NOT call focusSphere here — the caller is responsible for
    // camera focus. Calling it here causes multiple competing camera
    // animations when multiple residues are shown (e.g. water bridge shows
    // 2 residues + water, each calling focusSphere → camera "locks" while
    // animating between conflicting targets).
  } catch (e) {
    console.warn("[showResidueSidechain] failed:", e);
  }
}

/** Show atoms (ball-and-stick) on the polymer component for interaction charts.
 *  This makes individual atoms visible so the user can see which atoms are
 *  involved in the interaction. Returns a cleanup function that removes
 *  the added representation.
 *
 *  Unlike measure mode (which adds to ALL structures), this only adds to the
 *  first structure (the active one). */
export async function showAtomsForInteraction(plugin: MolstarPlugin): Promise<() => void> {
  const addedReps: unknown[] = [];
  try {
    const structs = plugin.managers.structure.hierarchy.current.structures;
    for (const sr of structs) {
      const polymer = (sr as any)?.components?.find(
        (c: any) => c?.cell?.transform?.tags?.includes("structure-component-static-polymer")
      );
      if (polymer?.cell) {
        const rep = await plugin.builders.structure.representation.addRepresentation(
          polymer.cell,
          {
            type: "ball-and-stick",
            typeParams: { alpha: 0.5 },
            colorTheme: { name: "element", params: {} },
          }
        );
        if (rep) {
          try {
            (rep as any).cell.transform.tags = ["interaction-ball-and-stick"];
          } catch {
            /* ignore */
          }
          addedReps.push(rep);
        }
      }
    }
  } catch (e) {
    console.warn("[showAtomsForInteraction] failed:", e);
  }
  // Return cleanup function.
  return () => {
    for (const rep of addedReps) {
      try {
        const ref = (rep as any)?.ref || (rep as any)?.cell?.transform?.ref;
        if (ref) {
          plugin.state.data.build().delete(ref).commit();
        }
      } catch {
        /* ignore */
      }
    }
  };
}

/** Remove all sidechain components created by `showResidueSidechain`. */
export function clearSidechainComponents(plugin: MolstarPlugin): void {
  if (sidechainComponents.length === 0) return;
  try {
    plugin.managers.structure.hierarchy.remove(sidechainComponents);
  } catch (e) {
    console.warn("[clearSidechainComponents] failed:", e);
  }
  sidechainComponents.length = 0;
}

/** Clear all interaction-related state: sidechain components, measurements,
 *  interaction lines (caller must clear the store), focus representations,
 *  highlights, and selections.
 *
 *  This should be called by interaction charts before showing a new
 *  interaction to avoid stale overlays, "two different distances", and
 *  camera "locking" from competing focus representations. */
export function clearInteractionState(plugin: MolstarPlugin): void {
  // Clear sidechain components (ball-and-stick representations we created).
  clearSidechainComponents(plugin);
  // Remove any existing interaction-ball-and-stick reps from polymer components.
  try {
    const structs = plugin.managers.structure.hierarchy.current.structures;
    for (const sr of structs) {
      const polymer = (sr as any)?.components?.find(
        (c: any) => c?.cell?.transform?.tags?.includes("structure-component-static-polymer")
      );
      if (polymer?.representations) {
        const interactionReps = polymer.representations.filter(
          (r: any) => r?.cell?.transform?.tags?.includes("interaction-ball-and-stick")
        );
        for (const rep of interactionReps) {
          try {
            const ref = rep?.cell?.transform?.ref;
            if (ref) plugin.state.data.build().delete(ref).commit();
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  // Clear Molstar's native measurement manager (old distance/angle lines).
  try {
    plugin.managers.structure.measurement.clear();
  } catch {
    /* ignore */
  }
  // Clear the focus manager's referenceLoci — this removes Molstar's
  // built-in "focus representation" (which shows sidechains) and prevents
  // the camera from being locked by a stale focus target.
  try {
    const focusMgr = (plugin.managers.structure as any).focus;
    if (focusMgr && typeof focusMgr.clear === "function") {
      focusMgr.clear();
    }
  } catch {
    /* ignore */
  }
  // Clear highlights + selections.
  try {
    plugin.managers.interactivity.lociHighlights.clearHighlights();
  } catch {
    /* ignore */
  }
  // Request a redraw to make sure the canvas is responsive after clearing.
  try {
    plugin.canvas3d?.requestDraw?.();
  } catch {
    /* ignore */
  }
}

/** Module-level ref tracking sidechain components for cleanup. */
const sidechainComponents: unknown[] = [];

/** Module-level ref tracking measure-mode ball-and-stick reps for cleanup. */
const measureModeReps: unknown[] = [];

/**
 * Clear all measurements + reset focus + clear highlights/selections.
 * Used by the toolbar's "clear all" button.
 */
export function clearAllMeasurementsAndFocus(plugin: MolstarPlugin): void {
  try {
    plugin.managers.structure.measurement.clear();
  } catch {
    /* ignore */
  }
  try {
    plugin.managers.interactivity.lociHighlights.clearHighlights();
  } catch {
    /* ignore */
  }
  try {
    const focusMgr = (plugin.managers.structure as any).focus;
    if (focusMgr && typeof focusMgr.clear === "function") {
      focusMgr.clear();
    }
  } catch {
    /* ignore */
  }
  // Also clear sidechain components.
  clearSidechainComponents(plugin);
}
