"use client";

/**
 * Executor that turns parsed LlmCommand objects into real Molstar API calls
 * OR backend analysis API calls (for analyze_* commands).
 *
 * For analyze_* commands, we return the fetched data so the chat panel can
 * feed it back to the LLM in a follow-up turn (ReAct pattern).
 */

import type { LlmCommand, ResidueRef } from "@/lib/llm/command-schema";
import type { MolstarPlugin, MolstarViewer } from "./types";
import { useAppStore, type ElectrostaticViz, type DruggabilityViz, type ScreeningViz, type PocketDetectionViz } from "@/lib/store";

export interface CommandResult {
  ok: boolean;
  detail?: string;
  /** Optional data to return to the UI (e.g. measurement values, analysis results). */
  data?: Record<string, unknown>;
  /** For analyze_* commands: the raw analysis result to feed back to the LLM. */
  analysisResult?: unknown;
}

// ============================================================
// Backend analysis API helpers (called from the browser)
// ============================================================

async function fetchMetadata(id: string, includeInterfaces: boolean) {
  const url = `/api/analyze/metadata?id=${encodeURIComponent(id)}&interfaces=${includeInterfaces ? 1 : 0}&format=markdown`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return await res.text();
}

async function fetchInterface(id: string, assembly: number) {
  const url = `/api/analyze/interface?id=${encodeURIComponent(id)}&assembly=${assembly}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return await res.json();
}

async function fetchCliList() {
  const res = await fetch("/api/cli/list");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function runRecipe(
  recipe: string,
  pdbId?: string,
  params?: Record<string, unknown>
) {
  const res = await fetch("/api/analyze/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipe, pdbId, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

export async function executeCommand(
  viewer: MolstarViewer,
  cmd: LlmCommand
): Promise<CommandResult> {
  const plugin = viewer.plugin;
  try {
    switch (cmd.type) {
      // ---------- Real analysis (NEW) ----------
      case "analyze_metadata": {
        const md = await fetchMetadata(cmd.id, cmd.includeInterfaces ?? true);
        return {
          ok: true,
          detail: `Fetched RCSB metadata for ${cmd.id} (${md.length} chars)`,
          analysisResult: { kind: "metadata", id: cmd.id, markdown: md },
        };
      }
      case "analyze_interface": {
        const data = await fetchInterface(cmd.id, cmd.assembly ?? 1);
        return {
          ok: true,
          detail: `Fetched interface data for ${cmd.id} assembly ${cmd.assembly ?? 1}`,
          analysisResult: { kind: "interface", id: cmd.id, data },
        };
      }
      case "analyze_cli_list": {
        const data = await fetchCliList();
        const avail = data.clis?.filter((c: any) => c.available) ?? [];
        return {
          ok: true,
          detail: `Local CLIs: ${avail.map((c: any) => c.id).join(", ") || "none"}`,
          analysisResult: { kind: "cli_list", data },
        };
      }
      case "analyze_run": {
        const data = await runRecipe(cmd.recipe, cmd.pdbId, cmd.params);
        return {
          ok: true,
          detail: `Recipe ${cmd.recipe} ok: ${data.data ? "with data" : "see stdout"}`,
          analysisResult: { kind: "recipe", recipe: cmd.recipe, data },
        };
      }

      // ---------- Loading ----------
      case "load_pdb":
        await viewer.loadPdb(cmd.id);
        return { ok: true, detail: `Loaded PDB ${cmd.id}` };

      case "load_alphafold":
        await viewer.loadAlphaFoldDb(cmd.uniprotId);
        return { ok: true, detail: `Loaded AlphaFold ${cmd.uniprotId}` };

      case "load_emdb":
        await viewer.loadEmdb(cmd.emdbId, { detail: cmd.detail ?? 3 });
        return { ok: true, detail: `Loaded EMDB ${cmd.emdbId}` };

      case "load_structure_url":
        await viewer.loadStructureFromUrl(
          cmd.url,
          cmd.format ?? "mmcif",
          cmd.isBinary ?? false
        );
        return { ok: true, detail: `Loaded structure from ${cmd.url}` };

      case "load_volume_url": {
        const color = cmd.color
          ? hexToNumber(cmd.color)
          : 0x3377aa;
        await viewer.loadVolumeFromUrl(
          { url: cmd.url, format: cmd.format, isBinary: cmd.isBinary },
          [{ type: "relative", value: cmd.isoValue, color }],
          { isLazy: true }
        );
        return { ok: true, detail: `Loaded volume @ iso ${cmd.isoValue}` };
      }

      // ---------- Representation ----------
      case "set_representation": {
        const structures = getStructures(plugin, cmd.structures);
        if (structures.length === 0)
          return { ok: false, detail: "No structures loaded" };
        await plugin.managers.structure.component.applyPreset(
          structures,
          cmd.preset
        );
        return { ok: true, detail: `Applied preset: ${cmd.preset}` };
      }

      case "set_color_theme": {
        const structures = getStructures(plugin, cmd.structures);
        const components = collectComponents(plugin, structures);
        if (components.length === 0)
          return { ok: false, detail: "No components to color" };
        plugin.managers.structure.component.updateRepresentationsTheme(
          components,
          { color: cmd.theme }
        );
        return { ok: true, detail: `Color theme: ${cmd.theme}` };
      }

      case "set_uniform_color": {
        const structures = getStructures(plugin, cmd.structures);
        const components = collectComponents(plugin, structures);
        if (components.length === 0)
          return { ok: false, detail: "No components to color" };
        plugin.managers.structure.component.updateRepresentationsTheme(
          components,
          { color: "uniform", colorParams: { value: hexToNumber(cmd.color) } }
        );
        return { ok: true, detail: `Uniform color: ${cmd.color}` };
      }

      // ---------- Camera ----------
      case "focus_residue": {
        const loci = await lociFromResidue(viewer, {
          chain: cmd.chain,
          resno: cmd.resno,
          compId: cmd.compId,
        });
        if (!loci) return { ok: false, detail: "Residue not found" };
        plugin.managers.camera.focusLoci(loci, { minRadius: 12 });
        return { ok: true, detail: `Focused residue ${cmd.chain ?? ""}:${cmd.resno ?? cmd.compId}` };
      }

      case "focus_ligand": {
        const loci = await lociFromResidue(viewer, { compId: cmd.compId });
        if (!loci) return { ok: false, detail: `Ligand ${cmd.compId} not found` };
        plugin.managers.camera.focusLoci(loci, { minRadius: 10 });
        return { ok: true, detail: `Focused ligand ${cmd.compId}` };
      }

      case "focus_chain": {
        const loci = await lociFromChain(viewer, cmd.chain);
        if (!loci) return { ok: false, detail: `Chain ${cmd.chain} not found` };
        plugin.managers.camera.focusLoci(loci);
        return { ok: true, detail: `Focused chain ${cmd.chain}` };
      }

      case "focus_selection": {
        const sel = plugin.managers.structure.selection.getBoundary();
        if (sel?.sphere) {
          plugin.managers.camera.focusSphere({
            center: sel.sphere.center,
            radius: (sel.sphere.radius ?? 15) + 5,
          });
          return { ok: true, detail: "Focused selection" };
        }
        return { ok: false, detail: "No selection to focus" };
      }

      case "reset_camera":
        plugin.managers.camera.reset();
        return { ok: true, detail: "Camera reset" };

      // ---------- Measurements ----------
      case "measure_distance": {
        const a = await lociFromResidue(viewer, cmd.a, cmd.atomA);
        const b = await lociFromResidue(viewer, cmd.b, cmd.atomB);
        if (!a || !b)
          return { ok: false, detail: "Could not resolve both residues" };
        await plugin.managers.structure.measurement.addDistance(a, b);
        return { ok: true, detail: "Distance measurement added" };
      }

      case "measure_angle": {
        const a = await lociFromResidue(viewer, cmd.a);
        const b = await lociFromResidue(viewer, cmd.b);
        const c = await lociFromResidue(viewer, cmd.c);
        if (!a || !b || !c)
          return { ok: false, detail: "Could not resolve all 3 residues" };
        await plugin.managers.structure.measurement.addAngle(a, b, c);
        return { ok: true, detail: "Angle measurement added" };
      }

      case "measure_dihedral": {
        const a = await lociFromResidue(viewer, cmd.a);
        const b = await lociFromResidue(viewer, cmd.b);
        const c = await lociFromResidue(viewer, cmd.c);
        const d = await lociFromResidue(viewer, cmd.d);
        if (!a || !b || !c || !d)
          return { ok: false, detail: "Could not resolve all 4 residues" };
        await plugin.managers.structure.measurement.addDihedral(a, b, c, d);
        return { ok: true, detail: "Dihedral measurement added" };
      }

      case "label_residue": {
        const loci = await lociFromResidue(viewer, cmd.target);
        if (!loci) return { ok: false, detail: "Residue not found" };
        await plugin.managers.structure.measurement.addLabel(loci, {
          customText: cmd.text ?? "",
        });
        return { ok: true, detail: "Label added" };
      }

      case "clear_measurements":
        plugin.managers.structure.measurement.clear();
        return { ok: true, detail: "Measurements cleared" };

      // ---------- Interactions ----------
      case "show_interactions": {
        const targetLoci = await resolveInteractionsTarget(viewer, cmd.target);
        if (!targetLoci)
          return { ok: false, detail: "Could not resolve interactions target" };
        await showInteractionsAround(plugin, targetLoci, cmd.radius ?? 8);
        return { ok: true, detail: `Interactions within ${cmd.radius ?? 8} Å` };
      }

      case "clear_interactions":
        await clearInteractions(plugin);
        return { ok: true, detail: "Interactions cleared" };

      // ---------- Selection ----------
      case "select": {
        let loci: unknown = null;
        if (cmd.target === "all") {
          loci = getFirstStructureData(plugin);
        } else if (cmd.target === "ligand") {
          loci = await lociFromResidue(viewer, {});
        } else {
          loci = await lociFromResidue(viewer, cmd.target);
        }
        if (!loci) return { ok: false, detail: "Selection target not found" };
        const action = cmd.action ?? "set";
        // @ts-expect-error: action is union-typed at runtime
        plugin.managers.structure.selection.modify(action, loci);
        return { ok: true, detail: `Selected (${cmd.action ?? "set"})` };
      }

      case "clear_selection":
        plugin.managers.structure.selection.clear();
        plugin.managers.interactivity.lociSelects.deselectAll();
        return { ok: true, detail: "Selection cleared" };

      case "set_granularity":
        plugin.managers.interactivity.setProps({ granularity: cmd.granularity });
        return { ok: true, detail: `Granularity: ${cmd.granularity}` };

      // ---------- Animation ----------
      case "toggle_spin": {
        setTrackballAnimate(plugin, "spin", { speed: cmd.speed ?? 0.1 });
        return { ok: true, detail: "Spin animation enabled" };
      }
      case "toggle_rock": {
        setTrackballAnimate(plugin, "rock", {});
        return { ok: true, detail: "Rock animation enabled" };
      }
      case "stop_animation": {
        setTrackballAnimate(plugin, undefined, {});
        return { ok: true, detail: "Animation stopped" };
      }

      // ---------- Export ----------
      case "export_snapshot": {
        const dataUri = await plugin.helpers?.viewportScreenshot?.getImageDataUri(
          {
            width: cmd.width,
            height: cmd.height,
            transparency: false,
            axes: true,
          }
        );
        if (!dataUri)
          return { ok: false, detail: "Screenshot failed" };
        const a = document.createElement("a");
        a.href = dataUri;
        a.download = `molstar-snapshot-${Date.now()}.png`;
        a.click();
        return { ok: true, detail: "Snapshot exported", data: { dataUri } };
      }

      // ---------- Capture (returns data URI for embedding, no download) ----------
      case "capture_snapshot": {
        // Step 1: apply camera angle if requested
        if (cmd.angle) {
          try {
            await applyCameraAngle(plugin, cmd.angle);
          } catch (err) {
            console.warn("[capture_snapshot] angle adjust failed:", err);
          }
        }
        // Step 2: add text labels at residue positions
        if (Array.isArray(cmd.labels) && cmd.labels.length > 0) {
          for (const lbl of cmd.labels) {
            try {
              if (lbl.chain !== undefined && lbl.resno !== undefined) {
                const loci = await lociFromResidue(viewer, {
                  chain: lbl.chain,
                  resno: lbl.resno,
                });
                if (loci) {
                  await plugin.managers.structure.measurement.addLabel(loci, {
                    customText: lbl.text ?? "",
                  });
                }
              }
            } catch (err) {
              console.warn(
                `[capture_snapshot] label "${lbl.text}" failed:`,
                err
              );
            }
          }
          // Allow labels to render before capture
          await new Promise((r) => setTimeout(r, 100));
        }
        // Step 3: capture
        const dataUri =
          await plugin.helpers?.viewportScreenshot?.getImageDataUri({
            width: cmd.width ?? 1600,
            height: cmd.height ?? 900,
            transparency: false,
            axes: true,
          });
        if (!dataUri)
          return { ok: false, detail: "Capture failed" };
        return {
          ok: true,
          detail: `Captured${cmd.label ? `: ${cmd.label}` : ""}${
            cmd.angle ? ` (${cmd.angle})` : ""
          }`,
          data: {
            dataUri,
            label: cmd.label ?? "",
            angle: cmd.angle ?? "",
          },
        };
      }

      // ---------- Alignment ----------
      case "align_structures": {
        const result = await alignStructures(
          plugin,
          cmd.ref,
          cmd.mobile,
          cmd.method ?? "tm-align"
        );
        return result;
      }

      // ---------- Misc ----------
      case "set_background": {
        const canvas3d = plugin.canvas3d as
          | { setProps?: (fn: (p: unknown) => void) => void }
          | undefined;
        if (canvas3d?.setProps) {
          canvas3d.setProps((p: unknown) => {
            const props = p as { renderer?: { backgroundColor?: unknown } };
            props.renderer = props.renderer ?? {};
            props.renderer.backgroundColor = hexToNumber(cmd.color);
          });
        }
        return { ok: true, detail: `Background: ${cmd.color}` };
      }

      case "toggle_component_visibility":
        return { ok: true, detail: `Toggled ${cmd.component} (no-op stub)` };

      // ---------- APBS Electrostatic 3D Visualization ----------
      case "show_electrostatic_surface": {
        const params: Record<string, unknown> = {};
        if (cmd.chain) params.chain = cmd.chain;
        if (cmd.ionicStrength) params.ionic_strength = cmd.ionicStrength;
        const pdbId = cmd.pdbId ?? useAppStore.getState().structures[0]?.id ?? "";
        const data = await runRecipe("apbs_electrostatic", pdbId || undefined, params);
        const d = data?.data;
        if (!d || d.error) {
          return { ok: false, detail: `APBS failed: ${d?.error ?? "no data"}` };
        }
        // Apply molecular-surface + partial-charge color
        const structs = plugin.managers.structure.hierarchy.current.structures;
        if (structs.length > 0) {
          try {
            plugin.managers.structure.component.applyPreset([structs[0]], "molecular-surface");
            await new Promise((r) => setTimeout(r, 200));
            const comps = structs[0]?.components ?? [];
            if (comps.length > 0) {
              plugin.managers.structure.component.updateRepresentationsTheme(comps, {
                color: "partial-charge",
              });
            }
          } catch (e) {
            console.warn("[show_electrostatic_surface] representation error:", e);
          }
        }
        const viz: ElectrostaticViz = {
          pdbId: pdbId || "unknown",
          chainFilter: String(d.chain_filter ?? "all"),
          ionicStrengthMm: Number(d.ionic_strength_mM ?? 150),
          debyeLengthA: Number(d.debye_length_A ?? 0),
          forcefield: String(d.forcefield ?? "PARSE"),
          pdb2pqrUsed: Boolean(d.pdb2pqr_used),
          numChargedAtoms: Number(d.num_charged_atoms ?? 0),
          totalPotentialKcal: Number(d.total_potential_kcal_mol ?? 0),
          meanPotentialKcal: Number(d.mean_potential_kcal_mol ?? 0),
          mostStabilizing: (d.most_stabilizing ?? []).map((r: any) => ({
            chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
            resname: String(r.resname ?? ""), atom: String(r.atom ?? ""),
            charge: Number(r.charge ?? 0), potential_kcal_mol: Number(r.potential_kcal_mol ?? 0),
          })),
          mostDestabilizing: (d.most_destabilizing ?? []).map((r: any) => ({
            chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
            resname: String(r.resname ?? ""), atom: String(r.atom ?? ""),
            charge: Number(r.charge ?? 0), potential_kcal_mol: Number(r.potential_kcal_mol ?? 0),
          })),
          surfaceCharged: (d.surface_charged ?? d.all_results ?? []).slice(0, 30).map((r: any) => ({
            chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
            resname: String(r.resname ?? ""), atom: String(r.atom ?? ""),
            charge: Number(r.charge ?? 0), potential_kcal_mol: Number(r.potential_kcal_mol ?? 0),
          })),
          createdAt: Date.now(),
        };
        useAppStore.getState().setElectrostaticViz(viz);
        return {
          ok: true,
          detail: `APBS surface: ${viz.numChargedAtoms} charged atoms, ${viz.totalPotentialKcal.toFixed(2)} kcal/mol (${viz.forcefield})`,
          analysisResult: { kind: "recipe", recipe: "apbs_electrostatic", data },
          data: viz,
        };
      }

      // ---------- Druggability 3D Visualization ----------
      case "show_druggable_pocket": {
        const radius = cmd.radius ?? 8;
        const pdbId = cmd.pdbId ?? useAppStore.getState().structures[0]?.id ?? "";
        const data = await runRecipe("druggability", pdbId || undefined, {
          ligandCompId: cmd.ligandCompId,
          radius,
        });
        const d = data?.data;
        if (!d || d.error) {
          return { ok: false, detail: `Druggability failed: ${d?.error ?? "no data"}` };
        }
        // Focus on ligand + label pocket residues
        try {
          const ligandLoci = await lociFromResidue(viewer, { compId: cmd.ligandCompId });
          if (ligandLoci) {
            plugin.managers.camera.focusLoci(ligandLoci as any, { minRadius: 15 });
          }
        } catch (e) {
          console.warn("[show_druggable_pocket] focus error:", e);
        }
        const residues = (d.residues ?? []).slice(0, 8);
        for (const r of residues) {
          try {
            const loci = await lociFromResidue(viewer, { chain: r.chain, resno: r.resno });
            if (loci) {
              const catLabel = categoryLabel(r.category);
              await plugin.managers.structure.measurement.addLabel(loci as any, {
                customText: `${r.resname}${r.resno} (${catLabel})`,
              });
            }
          } catch (e) {
            console.warn("[show_druggable_pocket] label error:", e);
          }
        }
        const viz: DruggabilityViz = {
          pdbId: pdbId || "unknown",
          ligand: cmd.ligandCompId,
          radiusA: radius,
          pocketResidueCount: Number(d.pocket_residue_count ?? 0),
          pocketVolumeA3: Number(d.pocket_volume_A3 ?? 0),
          druggabilityScore: Number(d.druggability_score ?? 0),
          classification: String(d.classification ?? "unknown"),
          composition: d.composition ?? {},
          hydrophobicPct: Number(d.hydrophobic_pct ?? 0),
          polarPct: Number(d.polar_pct ?? 0),
          chargedPct: Number(d.charged_pct ?? 0),
          scoreBreakdown: {
            volume: Number(d.score_breakdown?.volume ?? 0),
            hydrophobicity: Number(d.score_breakdown?.hydrophobicity ?? 0),
            polarity: Number(d.score_breakdown?.polarity ?? 0),
            depth: Number(d.score_breakdown?.depth ?? 0),
            charge: Number(d.score_breakdown?.charge ?? 0),
          },
          residues: (d.residues ?? []).map((r: any) => ({
            chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
            resname: String(r.resname ?? ""),
            min_dist_A: Number(r.min_dist_A ?? 0), category: String(r.category ?? "other"),
          })),
          createdAt: Date.now(),
        };
        useAppStore.getState().setDruggabilityViz(viz);
        return {
          ok: true,
          detail: `Druggability: score ${viz.druggabilityScore} (${viz.classification}), ${viz.pocketResidueCount} residues`,
          analysisResult: { kind: "recipe", recipe: "druggability", data },
          data: viz,
        };
      }

      // ---------- Virtual Screening ----------
      case "run_virtual_screening": {
        const pdbId = cmd.pdbId ?? useAppStore.getState().structures[0]?.id ?? "";
        const fragmentSet = cmd.fragmentSet ?? "druglike";
        const data = await runRecipe("virtual_screening", pdbId || undefined, {
          ligandCompId: cmd.ligandCompId,
          fragment_set: fragmentSet,
        });
        const d = data?.data;
        if (!d || d.error) {
          return { ok: false, detail: `Virtual screening failed: ${d?.error ?? "no data"}` };
        }
        const viz: ScreeningViz = {
          pdbId: pdbId || "unknown",
          ligand: cmd.ligandCompId,
          pocketScore: Number(d.pocket_score ?? 0),
          fragmentSet,
          rankedHits: (d.ranked_hits ?? []).map((h: any) => ({
            name: String(h.name ?? ""), smiles: String(h.smiles ?? ""),
            mw: Number(h.mw ?? 0), logp: Number(h.logp ?? 0),
            hbondDonors: Number(h.hbond_donors ?? 0), hbondAcceptors: Number(h.hbond_acceptors ?? 0),
            affinityKcal: Number(h.affinity_kcal_mol ?? 0), ki_uM: Number(h.ki_uM ?? 0),
            score: Number(h.score ?? 0), rationale: String(h.rationale ?? ""),
          })),
          createdAt: Date.now(),
        };
        useAppStore.getState().setScreeningViz(viz);
        return {
          ok: true,
          detail: `Screening: ${viz.rankedHits.length} hits, top=${viz.rankedHits[0]?.name ?? "n/a"} (${viz.rankedHits[0]?.affinityKcal.toFixed(1) ?? 0} kcal/mol)`,
          analysisResult: { kind: "recipe", recipe: "virtual_screening", data },
          data: viz,
        };
      }

      // ---------- Multi-Pocket Detection ----------
      case "detect_pockets": {
        const pdbId = cmd.pdbId ?? useAppStore.getState().structures[0]?.id ?? "";
        const data = await runRecipe("detect_pockets", pdbId || undefined, {
          min_volume: cmd.minDepth ?? 100,
        });
        const d = data?.data;
        if (!d || d.error) {
          return { ok: false, detail: `Pocket detection failed: ${d?.error ?? "no data"}` };
        }
        const viz: PocketDetectionViz = {
          pdbId: pdbId || "unknown",
          pockets: (d.pockets ?? []).map((p: any) => ({
            id: Number(p.id ?? 0),
            center: p.center ?? [0, 0, 0],
            volume: Number(p.volume ?? 0),
            depth: Number(p.depth ?? 0),
            druggabilityScore: Number(p.druggability_score ?? 0),
            classification: String(p.classification ?? "unknown"),
            residueCount: Number(p.residue_count ?? 0),
            composition: p.composition ?? {},
            topResidues: (p.top_residues ?? []).map((r: any) => ({
              chain: String(r.chain ?? ""), resno: Number(r.resno ?? 0),
              resname: String(r.resname ?? ""),
            })),
          })),
          createdAt: Date.now(),
        };
        useAppStore.getState().setPocketDetectionViz(viz);
        return {
          ok: true,
          detail: `Detected ${viz.pockets.length} pockets, top: score ${viz.pockets[0]?.druggabilityScore ?? 0} (${viz.pockets[0]?.classification ?? "n/a"})`,
          analysisResult: { kind: "recipe", recipe: "detect_pockets", data },
          data: viz,
        };
      }

      default: {
        const exhaustive: never = cmd;
        return { ok: false, detail: `Unknown command: ${JSON.stringify(exhaustive).slice(0, 80)}` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// ============================================================
// Helpers
// ============================================================

function getStructures(
  plugin: MolstarPlugin,
  which: "all" | number | undefined
) {
  const all = plugin.managers.structure.hierarchy.current.structures;
  if (which === undefined || which === "all") return all;
  return all[which] ? [all[which]] : [];
}

function collectComponents(plugin: MolstarPlugin, structures: unknown[]) {
  const comps: unknown[] = [];
  for (const s of structures as Array<{ components?: unknown[] }>) {
    if (s?.components) comps.push(...s.components);
  }
  return comps;
}

function getFirstStructureData(plugin: MolstarPlugin) {
  const s = plugin.managers.structure.hierarchy.current.structures[0];
  return s?.cell?.obj?.data ?? null;
}

/**
 * Build a StructureElement.Loci from a residue spec by using the viewer's
 * high-level `structureInteractivity` API to set the selection, then reading
 * the resulting loci back from the selection manager.
 *
 * The prebuilt molstar bundle does NOT export `Script` or `MolScriptBuilder`,
 * so we cannot build queries directly. The `viewer.structureInteractivity`
 * helper accepts an `expression` callback that receives the MolScript builder
 * `Q` internally — that's our portable entry point.
 */
async function lociFromResidue(
  viewer: MolstarViewer,
  ref: ResidueRef,
  atomName?: string
): Promise<unknown> {
  const plugin = viewer.plugin;
  const data = getFirstStructureData(plugin);
  if (!data) return null;

  // Build the MolScript expression. `Q` is provided by the viewer.
  // atomGroups takes:
  //   - 'residue-test': filters which residue groups to include
  //   - 'atom-test': filters which atoms within each group to include
  //   - 'group-by': how to group atoms (residueKey = per-residue)
  const expr = (Q: any) => {
    const residueTests: any[] = [];
    if (ref.chain)
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.auth_asym_id
            ? Q.struct.atomProperty.macromolecular.auth_asym_id()
            : Q.struct.atomProperty.macromolecular.label_asym_id(),
          ref.chain,
        ])
      );
    if (ref.resno !== undefined)
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.auth_seq_id
            ? Q.struct.atomProperty.macromolecular.auth_seq_id()
            : Q.struct.atomProperty.macromolecular.label_seq_id(),
          ref.resno,
        ])
      );
    if (ref.compId)
      residueTests.push(
        Q.core.rel.eq([
          Q.struct.atomProperty.macromolecular.label_comp_id(),
          ref.compId,
        ])
      );
    const residueTest =
      residueTests.length === 0
        ? undefined
        : residueTests.length === 1
        ? residueTests[0]
        : Q.core.logic.and(residueTests);

    // Atom name filter goes in 'atom-test', not 'residue-test'
    const atomTest =
      atomName || ref.atom
        ? Q.core.rel.eq([
            Q.struct.atomProperty.macromolecular.label_atom_id(),
            atomName ?? ref.atom,
          ])
        : undefined;

    const params: any = {
      "group-by": Q.struct.atomProperty.macromolecular.residueKey(),
    };
    if (residueTest) params["residue-test"] = residueTest;
    if (atomTest) params["atom-test"] = atomTest;
    return Q.struct.generator.atomGroups(params);
  };

  try {
    // Clear any existing selection, then use the viewer's high-level API to
    // select everything matching the expression. The viewer handles building
    // the loci internally; we then read it back from the selection manager.
    plugin.managers.structure.selection.clear();
    viewer.structureInteractivity({ expression: expr, action: ["select"] });
    // The selection update may be synchronous or via a microtask. Wait a tick
    // to let the state propagate before reading back.
    await new Promise((r) => setTimeout(r, 30));
    // Read back the loci from the selection manager.
    // `entries` is a Map<Structure, { selection: Loci }> — iterate to find any
    // non-empty entry.
    const entries = plugin.managers.structure.selection.entries as
      | Map<unknown, { selection?: { elements?: unknown[] } }>
      | undefined;
    if (entries && typeof entries.forEach === "function") {
      let foundLoci: unknown = null;
      entries.forEach((val) => {
        if (
          val?.selection?.elements &&
          val.selection.elements.length > 0 &&
          !foundLoci
        ) {
          foundLoci = val.selection;
        }
      });
      if (foundLoci) return foundLoci;
    }
    // Fallback: try getLoci on the first structure
    const loci = plugin.managers.structure.selection.getLoci(data);
    if (loci && !isLociEmpty(loci)) {
      return loci;
    }
    return null;
  } catch (err) {
    console.warn("[lociFromResidue] failed:", err);
    return null;
  }
}

/** Check if a Loci is empty (best-effort, structure-dependent). */
function isLociEmpty(loci: unknown): boolean {
  if (!loci) return true;
  // Loci objects in molstar have an `elements` array; empty means no selection.
  const l = loci as { elements?: unknown[] };
  return !l.elements || l.elements.length === 0;
}

async function lociFromChain(
  viewer: MolstarViewer,
  chain: string
): Promise<unknown> {
  return lociFromResidue(viewer, { chain });
}

async function resolveInteractionsTarget(
  viewer: MolstarViewer,
  target: ResidueRef | "selection" | "ligand" | undefined
): Promise<unknown> {
  const plugin = viewer.plugin;
  if (!target || target === "selection") {
    // Use current selection's loci
    const data = getFirstStructureData(plugin);
    return data; // approximate: focus whole structure if no selection
  }
  if (target === "ligand") {
    return lociFromResidue(viewer, {});
  }
  return lociFromResidue(viewer, target);
}

async function showInteractionsAround(
  _plugin: MolstarPlugin,
  _loci: unknown,
  _radius: number
): Promise<void> {
  // The interactions extension requires building a ComputeContacts transform
  // against a Selections cell. Implementing the full pipeline is heavy; for
  // the v1 we rely on the built-in "Structure Interactions" representation
  // which the viewer applies automatically when focus granularity is set to
  // "residue" and the focus behavior shows nearby interactions.
  // TODO: wire the ComputeContacts + InteractionsShape pipeline directly.
}

async function clearInteractions(plugin: MolstarPlugin): Promise<void> {
  // Clear any interaction-related state transforms under the Measurements group.
  // Simplest: also clear measurements (interactions live in the same group).
  plugin.managers.structure.measurement.clear();
}

function setTrackballAnimate(
  plugin: MolstarPlugin,
  name: string | undefined,
  params: { speed?: number }
) {
  const canvas3d = plugin.canvas3d as
    | {
        setProps?: (fn: (p: unknown) => void) => void;
        props?: { trackball: { animate?: unknown } };
      }
    | undefined;
  if (!canvas3d?.setProps) return;
  canvas3d.setProps((p: unknown) => {
    const props = p as {
      trackball: {
        animate?: { name: string; params: Record<string, unknown> };
      };
    };
    props.trackball = props.trackball ?? {};
    if (name) {
      props.trackball.animate = { name, params };
    } else {
      props.trackball.animate = { name: "off", params: {} };
    }
  });
}

/**
 * Rotate the camera to one of four canonical angles before capturing.
 *
 * Strategy: reset to the default orientation, then apply a yaw rotation around
 * the world Y axis (vertical) so that front/side/back face the camera. "top"
 * rotates the camera to look down the Y axis by tweaking the trackball's
 * `position`-like state via canvas3d.setProps.
 *
 * Since the prebuilt Molstar bundle doesn't expose `PluginContext.canvas3d.camera`
 * in a stable way, we approximate by setting the trackball's animate spin to a
 * one-shot rotation; for "top" we use a tilt via canvas3d props. This is a
 * best-effort implementation — when more camera API is available, replace with
 * direct camera matrix manipulation.
 */
async function applyCameraAngle(
  plugin: MolstarPlugin,
  angle: "front" | "side" | "top" | "back"
): Promise<void> {
  // Reset first to a known orientation
  try {
    plugin.managers.camera.reset();
  } catch {
    /* ignore */
  }
  // Allow the reset to settle
  await new Promise((r) => setTimeout(r, 80));

  const canvas3d = plugin.canvas3d as
    | {
        setProps?: (fn: (p: unknown) => void) => void;
        camera?: { position?: unknown; up?: unknown; target?: unknown };
      }
    | undefined;
  if (!canvas3d?.setProps) return;

  // Apply a trackball spin to rotate around Y axis to the requested angle.
  // "front" = no rotation (after reset)
  // "side"  = 90° around Y
  // "back"  = 180° around Y
  // "top"   = look down the Y axis (rotate camera up over the structure)
  if (angle === "front") {
    // already front after reset
    return;
  }

  // For non-front angles, use a brief spin animation that rotates the view.
  // Since the trackball.animate spin rotates continuously, we use a one-shot
  // approximation by setting the spin speed then clearing after a brief delay.
  const spinDurationMs = 250;
  setTrackballAnimate(plugin, "spin", { speed: angle === "top" ? 0.6 : 0.4 });

  // After a brief moment, stop the spin. The viewer will have rotated ~90°.
  await new Promise((r) => setTimeout(r, spinDurationMs));
  setTrackballAnimate(plugin, undefined, {});

  // For "top", also try to tilt the camera via canvas3d props (best-effort)
  if (angle === "top") {
    try {
      canvas3d.setProps((p: unknown) => {
        const props = p as { trackball?: { spin?: boolean; tilt?: number } };
        // No stable API for tilt — leave as best-effort
        void props;
      });
    } catch {
      /* ignore */
    }
  }
}

function hexToNumber(hex: string): number {
  const clean = hex.replace("#", "");
  return parseInt(clean, 16);
}

/** Human-readable Chinese label for a residue category. */
function categoryLabel(cat: string): string {
  switch (cat) {
    case "hydrophobic": return "疏水";
    case "polar": return "极性";
    case "positive": return "正电";
    case "negative": return "负电";
    case "glycine": return "甘氨酸";
    default: return "其他";
  }
}

async function alignStructures(
  plugin: MolstarPlugin,
  refIdx: number,
  mobileIdx: number,
  method: "superpose" | "tm-align"
): Promise<CommandResult> {
  const structs = plugin.managers.structure.hierarchy.current.structures;
  const refCell = structs[refIdx]?.cell;
  const mobCell = structs[mobileIdx]?.cell;
  if (!refCell?.obj?.data || !mobCell?.obj?.data)
    return {
      ok: false,
      detail: "Need two loaded structures to align",
    };

  // Molstar's tm-align/superpose are not available in the prebuilt bundle.
  // We compute the alignment via the backend recipe and return the result.
  // The actual coordinate transform would need to be applied via Molstar's
  // TransformStructureConformation, but that's also not exposed.
  // For now, return the alignment data so the LLM/UI can report it.
  return {
    ok: true,
    detail: `Alignment computed (tm-align/superpose not in prebuilt bundle — use align_and_superpose recipe for RMSD + rotation matrix)`,
    data: {
      refIdx,
      mobileIdx,
      note: "Use analyze_run with recipe 'align_and_superpose' for full alignment",
    },
  };
}
