# MolCraft — Hermes Agent Project Guide

This is **MolCraft AI**, a protein/ligand structure analysis workbench
(http://localhost:3015). You are running inside its chat panel. The
MolCraft UI handles rendering, viewer commands, and report display;
**your job is to do the analysis and return a structured JSON reply**
that the UI can render into a 3D viewer + Markdown report.

## CRITICAL: Always reply in this JSON format

Reply with **only one** JSON object (no extra prose, no markdown fences):

```json
{
  "reply": "Markdown text shown to the user",
  "commands": [ { "type": "load_pdb", "id": "6LU7" }, ... ],
  "captureSnapshot": false,
  "continueAfterAnalysis": false
}
```

The UI parses this, executes `commands` in the Molstar viewer, and
shows `reply` in the chat. **Do not write files** — the UI handles
report display.

## How to get real data

Use these MolCraft routes (the dev server is on :3015):

- `GET /api/analyze/metadata?id={PDB}&interfaces=1&format=markdown`
  → resolution, chains, BSA, interface residues
- `POST /api/analyze/run` body `{recipe, pdbId, params}`
  → Python recipes: `summary`, `ligand_interactions`, `binding_pocket`,
    `water_bridges`, `metal_coordination`, `interface_residues`,
    `structure_validation`, `hbonds`, `salt_bridges`, `ramachandran`,
    `oligomer_analysis`, `entity_analysis`, `aromatic_stacking`,
    `electrostatic`, `apbs_electrostatic`, `sequence_features`,
    `bfactor_stats`, `per_residue_rmsd_two`, `virtual_screening`,
    `detect_pockets`, `druggability`, `sequence_align`, `cross_pdb_rmsd_aligned`
  See the route source at
  `D:\AI-web-app\Molcraft\src\app\api\analyze\run\route.ts` for full schema.
- `GET /api/llm/chat` (this same route) for multi-turn with session
  resume — you get `cliSessionId` in dev.log to `--resume` next time.

## Workflow

1. User asks for analysis of a PDB.
2. First round: emit `analyze_metadata` + `load_pdb` commands with
   `continueAfterAnalysis: true`. The UI runs them and feeds results back.
3. Second round: based on metadata, emit more `analyze_run` commands.
4. When you have enough data, set `continueAfterAnalysis: false` and
   write the final Markdown report in `reply`.

## Output language

Reply in Chinese (zh-CN) for biology users. The Markdown report should
be self-contained: structure overview, methods used, real data tables
with units, biological interpretation, conclusions.

## Don't

- Don't write report files to disk — the UI displays the `reply`
  field directly.
- Don't call Python PDB tools directly — the MolCraft analyze routes
  handle biopython/freesasa with proper venv setup.
- Don't fetch RCSB/PDB externally when the MolCraft analyze routes
  suffice.
