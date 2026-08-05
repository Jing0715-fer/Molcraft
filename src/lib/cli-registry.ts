/**
 * Local bioinformatics CLI registry + probe + analysis recipes.
 *
 * Pattern adapted from https://github.com/Jing0717-fer/pdb-tracker-web-v4/
 * (src/lib/llm.ts `CLI_ADAPTERS`): each adapter declares a binary name and
 * smoke-test args; `probeCli` runs `which` + the smoke test and caches the
 * result for the lifetime of the process.
 *
 * Analysis recipes are Python scripts that use the probed CLIs (biopython,
 * freesasa, pdb-tools) to compute real structural data: distances, interface
 * residues, SASA/BSA, secondary structure, disulfide bonds, etc.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CliAdapter {
  id: string;
  label: string;
  category: "python" | "binary" | "pymol";
  bin: string;
  /** Smoke-test args — must exit 0 and ideally print a version string. */
  probeArgs: string[];
  /** A short description of what this tool does, shown in the UI. */
  description: string;
  /** Capabilities this tool provides (used by the LLM to know what it can ask for). */
  capabilities: string[];
}

export const CLI_ADAPTERS: CliAdapter[] = [
  {
    id: "biopython",
    label: "Biopython",
    category: "python",
    bin: "python3",
    probeArgs: ["-c", "import Bio; print(Bio.__version__)"],
    description: "Python 生物信息库 — PDB/mmCIF 解析、距离计算、DSSP、序列操作",
    capabilities: [
      "parse PDB / mmCIF file",
      "compute atom-atom / residue-residue distances",
      "extract chain / residue / atom lists",
      "run DSSP secondary structure assignment (if mkdssp binary available)",
      "interface residue detection by distance cutoff",
      "NeighborSearch for contact detection",
    ],
  },
  {
    id: "pdb-tools",
    label: "pdb-tools",
    category: "binary",
    bin: "pdb_tidy",
    probeArgs: [],
    description: "PDB 文件操作 CLI 套件 — pdb_tidy, pdb_selchain, pdb_reres, etc.",
    capabilities: [
      "select chains (pdb_selchain)",
      "renumber residues (pdb_reres)",
      "tidy PDB formatting (pdb_tidy)",
      "select residues by range (pdb_selres)",
      "extract ligands (pdb_selhetatm)",
    ],
  },
  {
    id: "freesasa",
    label: "FreeSASA",
    category: "python",
    bin: "python3",
    probeArgs: ["-c", "import freesasa; print('ok')"],
    description: "溶剂可及表面积 (SASA) 计算 — 单链 SASA、复合物 SASA、 buried SASA",
    capabilities: [
      "compute total / per-residue SASA",
      "compute per-chain SASA",
      "identify surface-exposed vs buried residues",
    ],
  },
  {
    id: "numpy",
    label: "NumPy",
    category: "python",
    bin: "python3",
    probeArgs: ["-c", "import numpy; print(numpy.__version__)"],
    description: "数值计算 — 用于坐标运算、距离矩阵、几何分析",
    capabilities: [
      "coordinate array operations",
      "distance matrix computation",
      "RMSD calculation",
    ],
  },
  {
    id: "pymol",
    label: "PyMOL",
    category: "pymol",
    bin: "pymol",
    probeArgs: ["-c", "-q"],
    description: "PyMOL 命令行 — 高级结构分析、脚本化测量、RMSD、interface residues",
    capabilities: [
      "interface residues (cmd.interfaceResidues)",
      "RMSD alignment (cmd.align, cmd.super)",
      "distance measurements (cmd.distance)",
      "secondary structure (cmd.dss)",
    ],
  },
  {
    id: "dssp",
    label: "DSSP / mkdssp",
    category: "binary",
    bin: "mkdssp",
    probeArgs: ["--version"],
    description: "二级结构分配 (DSSP 算法) — α-helix, β-sheet, loop, 3_10-helix",
    capabilities: [
      "assign secondary structure",
      "solvent accessible surface area per residue",
      "hydrogen bond detection",
    ],
  },
];

export interface CliProbeResult {
  id: string;
  label: string;
  category: string;
  available: boolean;
  version?: string;
  bin: string;
  description: string;
  capabilities: string[];
  error?: string;
}

// In-process cache so we don't re-probe on every request.
let cache: CliProbeResult[] | null = null;
let cacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 min

async function probeOne(adapter: CliAdapter): Promise<CliProbeResult> {
  const base: CliProbeResult = {
    id: adapter.id,
    label: adapter.label,
    category: adapter.category,
    available: false,
    bin: adapter.bin,
    description: adapter.description,
    capabilities: adapter.capabilities,
  };

  try {
    if (adapter.category === "binary") {
      try {
        await execFileAsync("which", [adapter.bin], { timeout: 3000 });
      } catch {
        return { ...base, error: "binary not in PATH" };
      }
      if (adapter.probeArgs.length > 0) {
        try {
          const { stdout } = await execFileAsync(adapter.bin, adapter.probeArgs, {
            timeout: 5000,
            maxBuffer: 1024 * 64,
          });
          const version = stdout.trim().split("\n")[0].slice(0, 80);
          return { ...base, available: true, version };
        } catch {
          return { ...base, available: true, version: "ok" };
        }
      }
      return { ...base, available: true };
    }

    if (adapter.category === "python") {
      const { stdout } = await execFileAsync(
        adapter.bin,
        adapter.probeArgs,
        { timeout: 5000, maxBuffer: 1024 * 64 }
      );
      const version = stdout.trim().split("\n")[0].slice(0, 80);
      return { ...base, available: true, version };
    }

    if (adapter.category === "pymol") {
      try {
        await execFileAsync("which", [adapter.bin], { timeout: 3000 });
        return { ...base, available: true, version: "ok" };
      } catch {
        return { ...base, error: "pymol not in PATH" };
      }
    }

    return base;
  } catch (err) {
    return {
      ...base,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function probeAllClis(force = false): Promise<CliProbeResult[]> {
  if (cache && !force && Date.now() - cacheTime < CACHE_TTL_MS) {
    return cache;
  }
  const results = await Promise.all(CLI_ADAPTERS.map(probeOne));
  cache = results;
  cacheTime = Date.now();
  return results;
}

// ============================================================
// Analysis Recipes — Python scripts that produce real structural data
// ============================================================

export interface AnalysisRecipe {
  id: string;
  label: string;
  description: string;
  /** Python libraries required (any must be available). */
  requires: string[];
  /** Parameter names the recipe accepts (besides the input file). */
  params: Array<{
    name: string;
    type: "string" | "number" | "string[]";
    required: boolean;
    description: string;
  }>;
  /** Returns a Python script body. `inputPath` is the local file path, `params` includes `__format__`. */
  buildScript: (inputPath: string, params: Record<string, unknown>) => string;
}

/**
 * Shared header for all recipes — picks the right Biopython parser based on
 * the file format (PDB or mmCIF) and exposes a `load_structure(path)` helper.
 */
const RECIPE_HEADER = `
import json, sys, os
def load_structure(path):
    fmt = path.rsplit('.', 1)[-1].lower()
    if fmt == 'cif':
        from Bio.PDB.MMCIFParser import MMCIFParser
        parser = MMCIFParser(QUIET=True)
    else:
        from Bio.PDB import PDBParser
        parser = PDBParser(QUIET=True)
    return parser.get_structure('s', path)
`;

export const ANALYSIS_RECIPES: AnalysisRecipe[] = [
  {
    id: "summary",
    label: "结构摘要",
    description: "输出结构基本统计：链数、残基数、原子数、配体列表",
    requires: ["biopython"],
    params: [],
    buildScript: (inputPath) => `${RECIPE_HEADER}
from collections import Counter
struct = load_structure("${inputPath}")
try:
    model = next(iter(struct))
except StopIteration:
    print(json.dumps({"error": "no models"})); raise SystemExit
chains = list(model)
residues = list(model.get_residues())
atoms = list(model.get_atoms())
het_res = [r for r in residues if r.id[0].strip() != "" and r.resname != "HOH"]
ligands = Counter(r.resname for r in het_res)
chain_summary = {}
for c in chains:
    cr = [r for r in c if r.id[0].strip() == ""]
    chain_summary[c.id] = {
        "residue_count": len(cr),
        "first_resno": cr[0].id[1] if cr else None,
        "last_resno": cr[-1].id[1] if cr else None,
        "atom_count": len(list(c.get_atoms())),
    }
print(json.dumps({
    "chain_count": len(chains),
    "chains": chain_summary,
    "total_residues": len(residues),
    "total_atoms": len(atoms),
    "ligands": dict(ligands),
    "has_hydrogens": any(a.element == "H" for a in atoms),
}, ensure_ascii=False, indent=2))
`,
  },
  {
    id: "distances",
    label: "原子/残基距离",
    description: "计算任意两个原子之间的距离 (Å)",
    requires: ["biopython"],
    params: [
      {
        name: "pairs",
        type: "string[]",
        required: true,
        description: '距离对，格式 "chain resno atom" 或 "chain resno" (取 CA)',
      },
    ],
    buildScript: (inputPath, params) => {
      const pairs = JSON.stringify(params.pairs ?? []);
      return `${RECIPE_HEADER}
pairs = json.loads('''${pairs}''')
struct = load_structure("${inputPath}")
def find_atom(struct, chain, resno, atom=None):
    for model in struct:
        if chain not in model:
            continue
        for res in model[chain]:
            if res.id[1] == resno:
                if atom:
                    if atom in res:
                        return res[atom]
                else:
                    if "CA" in res:
                        return res["CA"]
                    for a in res:
                        return a
    return None
results = []
for p in pairs:
    parts = p.split()
    if len(parts) < 2:
        results.append({"query": p, "error": "format: chain resno [atom]"})
        continue
    chain = parts[0]
    try:
        resno = int(parts[1])
    except ValueError:
        results.append({"query": p, "error": "resno must be int"})
        continue
    atom = parts[2] if len(parts) > 2 else None
    a = find_atom(struct, chain, resno, atom)
    if a:
        results.append({
            "query": p,
            "chain": chain, "resno": resno, "atom": atom or a.get_name(),
            "coord": [round(float(a.coord[0]),3), round(float(a.coord[1]),3), round(float(a.coord[2]),3)],
        })
    else:
        results.append({"query": p, "error": "atom not found"})
# Compute pairwise distances for all found atoms
found = [r for r in results if "coord" in r]
dists = []
for i in range(len(found)):
    for j in range(i+1, len(found)):
        ci = found[i]["coord"]; cj = found[j]["coord"]
        d = round(float(((ci[0]-cj[0])**2 + (ci[1]-cj[1])**2 + (ci[2]-cj[2])**2)**0.5), 3)
        dists.append({"a": found[i]["query"], "b": found[j]["query"], "distance_A": d})
print(json.dumps({"atoms": found, "distances": dists}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "interface_residues",
    label: "界面残基 (距离截断)",
    description: "通过距离截断检测两条链之间的界面残基和接触原子",
    requires: ["biopython"],
    params: [
      { name: "chain1", type: "string", required: true, description: "链 1 ID" },
      { name: "chain2", type: "string", required: true, description: "链 2 ID" },
      { name: "cutoff", type: "number", required: false, description: "距离截断 (Å)，默认 5.0" },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      const cutoff = Number(params.cutoff ?? 5.0);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
chain1 = "${chain1}"
chain2 = "${chain2}"
cutoff = ${cutoff}
model = next(iter(struct))
if chain1 not in model or chain2 not in model:
    print(json.dumps({"error": f"chain {chain1} or {chain2} not found", "available_chains": [c.id for c in model]}))
    raise SystemExit
atoms1 = list(model[chain1].get_atoms())
atoms2 = list(model[chain2].get_atoms())
ns = NeighborSearch(atoms1 + atoms2)
pairs = ns.search_all(cutoff, level="A")
cross = [(a, b) for (a, b) in pairs if a.get_parent().get_parent().id != b.get_parent().get_parent().id]
res1 = {}; res2 = {}
for a, b in cross:
    ra = a.get_parent(); rb = b.get_parent()
    ca = a.get_parent().get_parent().id; cb = b.get_parent().get_parent().id
    d = round(float(a - b), 2)
    if ca == chain1:
        res1.setdefault((ra.id[1], ra.resname), []).append({"atom": a.get_name(), "to_chain": cb, "to_res": rb.id[1], "to_name": rb.resname, "dist": d})
        res2.setdefault((rb.id[1], rb.resname), []).append({"atom": b.get_name(), "to_chain": ca, "to_res": ra.id[1], "to_name": ra.resname, "dist": d})
    else:
        res1.setdefault((rb.id[1], rb.resname), []).append({"atom": b.get_name(), "to_chain": ca, "to_res": ra.id[1], "to_name": ra.resname, "dist": d})
        res2.setdefault((ra.id[1], ra.resname), []).append({"atom": a.get_name(), "to_chain": cb, "to_res": rb.id[1], "to_name": rb.resname, "dist": d})
def summarize(d):
    out = []
    for (resno, name), contacts in sorted(d.items()):
        contacts.sort(key=lambda x: x["dist"])
        types = set()
        for c in contacts:
            an = c["atom"]
            if an.startswith(("N", "O")) or an in ("ND1","ND2","NE1","NE2","NZ","OD1","OD2","OE1","OE2","OG","OG1","OH","NH1","NH2"):
                types.add("polar/H-bond")
            elif an.startswith(("C", "S")) or an in ("SD","SG"):
                types.add("hydrophobic")
            else:
                types.add("other")
        out.append({
            "resno": int(resno), "name": name, "n_contacts": len(contacts),
            "min_dist": float(contacts[0]["dist"]), "contacts": contacts[:5],
            "contact_types": sorted(types),
        })
    return out
hbonds = 0
for (a, b) in cross:
    d = float(a - b)
    if d < 3.5:
        an = a.get_name(); bn = b.get_name()
        if (an.startswith(("N", "O")) and bn.startswith(("N", "O"))) or \\
           (an in ("ND1","ND2","NE1","NE2","NZ","OD1","OD2","OE1","OE2","OG","OG1","OH","NH1","NH2") and
            bn in ("ND1","ND2","NE1","NE2","NZ","OD1","OD2","OE1","OE2","OG","OG1","OH","NH1","NH2")):
            hbonds += 1
print(json.dumps({
    "chain1": chain1, "chain2": chain2, "cutoff": cutoff,
    "total_atom_pairs": len(cross),
    "potential_hbonds_lt_3_5A": hbonds,
    "chain1_interface_residues": summarize(res1),
    "chain2_interface_residues": summarize(res2),
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "sasa",
    label: "溶剂可及表面积 (SASA)",
    description: "计算每条链的 SASA 和总 SASA",
    requires: ["freesasa"],
    params: [],
    buildScript: (inputPath) => `
import json
import freesasa
freesasa.setVerbosity(freesasa.silent)
struct = freesasa.Structure("${inputPath}")
result = freesasa.calc(struct)
total = result.totalArea()
chain_areas = {}
residue_areas = result.residueAreas()
for cid in residue_areas:
    area = sum(r.total for r in residue_areas[cid].values())
    chain_areas[cid] = round(float(area), 2)
print(json.dumps({
    "total_sasa_A2": round(float(total), 2),
    "chain_sasa_A2": chain_areas,
    "n_chains": len(chain_areas),
}, ensure_ascii=False, indent=2))
`,
  },
  {
    id: "disulfide_bonds",
    label: "二硫键",
    description: "检测所有 CYS-CYS SG-SG 距离 < 2.5Å 的二硫键",
    requires: ["biopython"],
    params: [
      { name: "cutoff", type: "number", required: false, description: "距离截断 (Å)，默认 2.5" },
    ],
    buildScript: (inputPath, params) => {
      const cutoff = Number(params.cutoff ?? 2.5);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
cutoff = ${cutoff}
model = next(iter(struct))
sg_atoms = []
for res in model.get_residues():
    if res.resname == "CYS" and "SG" in res:
        sg_atoms.append(res["SG"])
ns = NeighborSearch(sg_atoms)
pairs = ns.search_all(cutoff, level="A")
bonds = []
for a, b in pairs:
    ra = a.get_parent(); rb = b.get_parent()
    ca = ra.get_parent().id; cb = rb.get_parent().id
    bonds.append({
        "chain1": ca, "resno1": int(ra.id[1]),
        "chain2": cb, "resno2": int(rb.id[1]),
        "distance_A": round(float(a - b), 3),
    })
print(json.dumps({"count": len(bonds), "bonds": bonds, "cutoff": cutoff}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "contact_map",
    label: "接触图 (链间)",
    description: "生成两条链之间所有残基-残基接触的简表 (距离 < cutoff)",
    requires: ["biopython"],
    params: [
      { name: "chain1", type: "string", required: true, description: "链 1 ID" },
      { name: "chain2", type: "string", required: true, description: "链 2 ID" },
      { name: "cutoff", type: "number", required: false, description: "距离截断 (Å)，默认 8.0" },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      const cutoff = Number(params.cutoff ?? 8.0);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
chain1 = "${chain1}"; chain2 = "${chain2}"; cutoff = ${cutoff}
model = next(iter(struct))
if chain1 not in model or chain2 not in model:
    print(json.dumps({"error": f"chain {chain1} or {chain2} not found", "available_chains": [c.id for c in model]}))
    raise SystemExit
# Use CA atoms only for a residue-level contact map
ca1 = [r["CA"] for r in model[chain1] if "CA" in r and r.id[0].strip() == ""]
ca2 = [r["CA"] for r in model[chain2] if "CA" in r and r.id[0].strip() == ""]
ns = NeighborSearch(ca1 + ca2)
pairs = ns.search_all(cutoff, level="A")
cross = [(a, b) for (a, b) in pairs if a.get_parent().get_parent().id != b.get_parent().get_parent().id]
contacts = []
for a, b in cross:
    ra = a.get_parent(); rb = b.get_parent()
    contacts.append({
        "res1": f"{ra.resname}{ra.id[1]}({a.get_parent().get_parent().id})",
        "res2": f"{rb.resname}{rb.id[1]}({b.get_parent().get_parent().id})",
        "ca_distance_A": round(float(a - b), 2),
    })
contacts.sort(key=lambda x: x["ca_distance_A"])
print(json.dumps({
    "chain1": chain1, "chain2": chain2, "cutoff": cutoff,
    "total_ca_contacts": len(contacts),
    "contacts": contacts[:50],  # top 50 closest
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "hbonds",
    label: "氢键检测 (H-bonds, Mills-Dean 几何标准)",
    description:
      "基于 Mills & Dean (1996) 几何标准检测氢键：考虑供体/受体原子类型、距离和角度。参考 ChimeraX 的实现。",
    requires: ["biopython", "numpy"],
    params: [
      { name: "chain1", type: "string", required: true, description: "链 1 ID" },
      { name: "chain2", type: "string", required: true, description: "链 2 ID" },
      {
        name: "distanceCutoff",
        type: "number",
        required: false,
        description: "距离容差 (Å)，加到 Mills-Dean 上限上，默认 0.4",
      },
      {
        name: "angleTolerance",
        type: "number",
        required: false,
        description: "角度容差 (度)，从下限减去，默认 20.0",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      const distTol = Number(params.distanceCutoff ?? 0.4);
      const angleTol = Number(params.angleTolerance ?? 20.0);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
import numpy as np
import math

struct = load_structure("${inputPath}")
chain1_id = "${chain1}"; chain2_id = "${chain2}"
dist_tolerance = ${distTol}  # added to distance upper bounds
angle_tolerance = ${angleTol}  # subtracted from angle lower bounds
model = next(iter(struct))
if chain1_id not in model or chain2_id not in model:
    print(json.dumps({"error": f"chain not found", "available": [c.id for c in model]}))
    raise SystemExit

# ============================================================
# Donor/Acceptor atom classification (ChimeraX-style)
# ============================================================

# Standard donor atoms (hydrogen-bearing N, O, S)
DONOR_ATOMS = {
    # Backbone
    'N': 'amide',       # backbone amide N (donor)
    'O': 'hydroxyl',    # could be carbonyl (acceptor) or hydroxyl (both)
    'OXT': 'carboxyl',  # terminal carboxyl
    # Sidechain donors
    'NZ': 'amine',      # LYS
    'NH1': 'guanidinium', 'NH2': 'guanidinium', 'NE': 'guanidinium',  # ARG
    'ND1': 'imidazole', 'NE2': 'imidazole',  # HIS
    'OG': 'hydroxyl', 'OG1': 'hydroxyl',     # SER, THR
    'OH': 'hydroxyl',                         # TYR
    'SG': 'thiol',                            # CYS
    'NE1': 'indole',                          # TRP
    # Nucleic acid
    'N6': 'amine', 'N4': 'amine', 'N2': 'amine',
    'O2': 'carbonyl', 'O4': 'hydroxyl', 'O6': 'carbonyl',
}

# Standard acceptor atoms (lone-pair bearing N, O, S)
ACCEPTOR_ATOMS = {
    'O': 'carbonyl',     # backbone carbonyl O (acceptor)
    'OXT': 'carboxyl',   # terminal carboxyl
    'OD1': 'carboxyl', 'OD2': 'carboxyl',  # ASP
    'OE1': 'carboxyl', 'OE2': 'carboxyl',  # GLU
    'OG': 'hydroxyl', 'OG1': 'hydroxyl',   # SER, THR (both donor & acceptor)
    'OH': 'hydroxyl',                       # TYR
    'ND1': 'imidazole', 'NE2': 'imidazole', # HIS (both)
    'N': 'amide',                           # backbone N can accept in some contexts
    'SG': 'thiol',                          # CYS (weak acceptor)
    # Nucleic acid
    'N7': 'ring', 'N3': 'ring',
    'O2': 'carbonyl', 'O4': 'hydroxyl', 'O6': 'carbonyl',
    'OP1': 'phosphate', 'OP2': 'phosphate', 'OP3': 'phosphate',
}

# Mills-Dean distance upper bounds (Å) by donor-acceptor type pair
# Simplified from Tables 5-8 in Mills & Dean (1996)
# Key: (donor_type, acceptor_type) → max distance
MD_DIST = {
    ('amide', 'carbonyl'): 3.5,    # N-H...O=C
    ('amide', 'carboxyl'): 3.5,
    ('amide', 'hydroxyl'): 3.5,
    ('amine', 'carbonyl'): 3.4,    # NZ-H...O
    ('amine', 'carboxyl'): 3.4,
    ('amine', 'hydroxyl'): 3.4,
    ('guanidinium', 'carboxyl'): 3.4,  # ARG...ASP/GLU
    ('guanidinium', 'carbonyl'): 3.4,
    ('imidazole', 'carbonyl'): 3.4,
    ('imidazole', 'carboxyl'): 3.4,
    ('hydroxyl', 'carbonyl'): 3.2,  # SER/THR/TYR...O
    ('hydroxyl', 'carboxyl'): 3.2,
    ('hydroxyl', 'hydroxyl'): 3.2,
    ('indole', 'carbonyl'): 3.4,
    ('thiol', 'carbonyl'): 3.5,
    ('thiol', 'carboxyl'): 3.5,
    ('carboxyl', 'carbonyl'): 3.3,
    ('carboxyl', 'hydroxyl'): 3.3,
    ('carboxyl', 'carboxyl'): 3.3,
    # Default fallback
    ('default', 'default'): 3.5,
}

# Angle criteria: minimum D-H...A angle (degrees)
# In absence of explicit H, we use the X-D...A angle where X is the
# atom bonded to the donor (e.g., C-N...O for backbone)
MD_ANGLE_MIN = {
    'amide': 120.0,       # backbone N
    'amine': 110.0,       # LYS NZ
    'guanidinium': 110.0, # ARG
    'imidazole': 110.0,   # HIS
    'hydroxyl': 90.0,     # SER/THR/TYR (relaxed due to rotatable H)
    'thiol': 90.0,        # CYS
    'indole': 110.0,      # TRP
    'carboxyl': 110.0,
    'default': 90.0,
}

def get_donor_type(atom_name, resname):
    if atom_name in DONOR_ATOMS:
        return DONOR_ATOMS[atom_name]
    if atom_name == 'N': return 'amide'
    if atom_name.startswith('O') and atom_name not in ('OD1','OD2','OE1','OE2','OXT'):
        return 'hydroxyl'
    return None

def get_acceptor_type(atom_name, resname):
    if atom_name in ACCEPTOR_ATOMS:
        return ACCEPTOR_ATOMS[atom_name]
    return None

def get_max_dist(donor_type, acceptor_type):
    return MD_DIST.get((donor_type, acceptor_type),
           MD_DIST.get((donor_type, 'default'),
           MD_DIST.get(('default', acceptor_type),
           MD_DIST[('default', 'default')])))

def get_min_angle(donor_type):
    return MD_ANGLE_MIN.get(donor_type, MD_ANGLE_MIN['default'])

def vec_sub(a, b):
    return np.array(a) - np.array(b)

def calc_angle(p1, p2, p3):
    """Angle at p2 formed by p1-p2-p3 (degrees)"""
    v1 = vec_sub(p1, p2)
    v2 = vec_sub(p3, p2)
    cos_a = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2) + 1e-10)
    cos_a = max(-1, min(1, cos_a))
    return math.degrees(math.acos(cos_a))

# ============================================================
# Collect potential donor and acceptor atoms from both chains
# ============================================================
chain1_atoms = list(model[chain1_id].get_atoms())
chain2_atoms = list(model[chain2_id].get_atoms())

# Build atom info: (atom, res, chain, is_donor, is_acceptor, donor_type, acceptor_type, bonded_atom)
def classify_atoms(atoms, chain_id):
    result = []
    for atom in atoms:
        name = atom.get_name()
        res = atom.get_parent()
        if res.id[0].strip() != "": continue  # skip HETATM
        # Skip hydrogens
        if name.startswith('H'): continue
        elem = atom.element or ''
        dt = get_donor_type(name, res.resname)
        at = get_acceptor_type(name, res.resname)
        is_donor = dt is not None and elem in ('N', 'O', 'S')
        is_acceptor = at is not None and elem in ('N', 'O', 'S')
        # Find bonded heavy atom (for angle calc when no explicit H)
        bonded = None
        if is_donor:
            # For backbone N: bonded to CA and C(prev)
            # For sidechain: find C or other heavy atom bonded to this atom
            bonded = None
            for other in res:
                if other is atom: continue
                if other.element in ('C', 'S') and other.get_name() != 'H':
                    # Simple distance-based bond check
                    d = float(atom - other)
                    if d < 2.0:
                        bonded = other
                        break
        result.append({
            'atom': atom, 'res': res, 'chain': chain_id,
            'name': name, 'element': elem,
            'is_donor': is_donor, 'is_acceptor': is_acceptor,
            'donor_type': dt, 'acceptor_type': at,
            'bonded_atom': bonded,
        })
    return result

info1 = classify_atoms(chain1_atoms, chain1_id)
info2 = classify_atoms(chain2_atoms, chain2_id)

# Use NeighborSearch for initial distance screening (generous cutoff)
all_atoms = [x['atom'] for x in info1 + info2]
ns = NeighborSearch(all_atoms)
search_cutoff = 4.0  # generous, will filter with precise criteria
pairs = ns.search_all(search_cutoff, level="A")

hbonds = []
for a, b in pairs:
    # Must be cross-chain
    if a.get_parent().get_parent().id == b.get_parent().get_parent().id:
        continue
    # Find info records
    info_a = None; info_b = None
    for x in info1 + info2:
        if x['atom'] is a: info_a = x
        if x['atom'] is b: info_b = x
    if not info_a or not info_b: continue
    # Try both directions: a=donor, b=acceptor AND b=donor, a=acceptor
    for donor_info, acceptor_info in [(info_a, info_b), (info_b, info_a)]:
        if not donor_info['is_donor'] or not acceptor_info['is_acceptor']:
            continue
        dt = donor_info['donor_type']
        at = acceptor_info['acceptor_type']
        if not dt or not at: continue
        max_dist = get_max_dist(dt, at) + dist_tolerance
        dist = float(donor_info['atom'] - acceptor_info['atom'])
        if dist > max_dist: continue
        # Angle check (if we have a bonded atom for angle calculation)
        angle = None
        if donor_info['bonded_atom'] is not None:
            min_angle = get_min_angle(dt) - angle_tolerance
            # Angle: bonded_atom - donor - acceptor
            angle = calc_angle(
                donor_info['bonded_atom'].coord,
                donor_info['atom'].coord,
                acceptor_info['atom'].coord
            )
            if angle < min_angle: continue
        # This is a valid H-bond
        d_res = donor_info['res']
        a_res = acceptor_info['res']
        hbonds.append({
            'donor_chain': donor_info['chain'],
            'donor_resno': int(d_res.id[1]),
            'donor_resname': d_res.resname,
            'donor_atom': donor_info['name'],
            'donor_type': dt,
            'acceptor_chain': acceptor_info['chain'],
            'acceptor_resno': int(a_res.id[1]),
            'acceptor_resname': a_res.resname,
            'acceptor_atom': acceptor_info['name'],
            'acceptor_type': at,
            'distance_A': round(dist, 2),
            'angle_deg': round(angle, 1) if angle is not None else None,
            'criteria': f'{dt}→{at} (max {max_dist:.1f}Å)',
        })

# Dedupe
seen = set()
unique_hbonds = []
for h in sorted(hbonds, key=lambda x: x['distance_A']):
    key = (h['donor_chain'], h['donor_resno'], h['donor_atom'],
           h['acceptor_chain'], h['acceptor_resno'], h['acceptor_atom'])
    if key not in seen:
        seen.add(key)
        unique_hbonds.append(h)

# Summary by residue pair
residue_pairs = {}
for h in unique_hbonds:
    pk = f"{h['donor_resname']}{h['donor_resno']}({h['donor_chain']}) - {h['acceptor_resname']}{h['acceptor_resno']}({h['acceptor_chain']})"
    residue_pairs[pk] = residue_pairs.get(pk, 0) + 1
top_pairs = sorted(residue_pairs.items(), key=lambda x: -x[1])[:10]

print(json.dumps({
    "chain1": chain1_id, "chain2": chain2_id,
    "method": "Mills-Dean geometric criteria (ChimeraX-style)",
    "dist_tolerance": dist_tolerance,
    "angle_tolerance": angle_tolerance,
    "total_hbonds": len(unique_hbonds),
    "hbonds": unique_hbonds[:40],
    "top_residue_pairs": [{"pair": p, "count": c} for p, c in top_pairs],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "salt_bridges",
    label: "盐桥检测 (Salt Bridges)",
    description:
      "检测两条链之间的盐桥：正电残基 (ARG/LYS/HIS) 与负电残基 (ASP/GLU) 之间 < 4.0Å",
    requires: ["biopython"],
    params: [
      { name: "chain1", type: "string", required: true, description: "链 1 ID" },
      { name: "chain2", type: "string", required: true, description: "链 2 ID" },
      {
        name: "cutoff",
        type: "number",
        required: false,
        description: "距离截断 (Å)，默认 4.0",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      const cutoff = Number(params.cutoff ?? 4.0);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
chain1 = "${chain1}"; chain2 = "${chain2}"; cutoff = ${cutoff}
model = next(iter(struct))
if chain1 not in model or chain2 not in model:
    print(json.dumps({"error": f"chain {chain1} or {chain2} not found", "available_chains": [c.id for c in model]}))
    raise SystemExit
POS = {'ARG': ['NH1', 'NH2', 'NE'], 'LYS': ['NZ'], 'HIS': ['ND1', 'NE2']}
NEG = {'ASP': ['OD1', 'OD2'], 'GLU': ['OE1', 'OE2']}
pos_atoms1 = [a for r in model[chain1] if r.resname in POS for a in r if a.get_name() in POS[r.resname]]
neg_atoms1 = [a for r in model[chain1] if r.resname in NEG for a in r if a.get_name() in NEG[r.resname]]
pos_atoms2 = [a for r in model[chain2] if r.resname in POS for a in r if a.get_name() in POS[r.resname]]
neg_atoms2 = [a for r in model[chain2] if r.resname in NEG for a in r if a.get_name() in NEG[r.resname]]
all_atoms = pos_atoms1 + neg_atoms1 + pos_atoms2 + neg_atoms2
ns = NeighborSearch(all_atoms)
pairs = ns.search_all(cutoff, level="A")
bridges = []
for a, b in pairs:
    ca = a.get_parent().get_parent().id; cb = b.get_parent().get_parent().id
    if ca == cb:
        continue
    ra = a.get_parent(); rb = b.get_parent()
    a_pos = ra.resname in POS and a.get_name() in POS[ra.resname]
    b_pos = rb.resname in POS and b.get_name() in POS[rb.resname]
    a_neg = ra.resname in NEG and a.get_name() in NEG[ra.resname]
    b_neg = rb.resname in NEG and b.get_name() in NEG[rb.resname]
    if not ((a_pos and b_neg) or (a_neg and b_pos)):
        continue
    bridges.append({
        "pos_chain": ca if a_pos else cb,
        "pos_resno": int(ra.id[1]) if a_pos else int(rb.id[1]),
        "pos_resname": ra.resname if a_pos else rb.resname,
        "pos_atom": a.get_name() if a_pos else b.get_name(),
        "neg_chain": cb if a_pos else ca,
        "neg_resno": int(rb.id[1]) if a_pos else int(ra.id[1]),
        "neg_resname": rb.resname if a_pos else ra.resname,
        "neg_atom": b.get_name() if a_pos else a.get_name(),
        "distance_A": round(float(a - b), 2),
    })
bridges.sort(key=lambda x: x["distance_A"])
print(json.dumps({
    "chain1": chain1, "chain2": chain2, "cutoff": cutoff,
    "total_salt_bridges": len(bridges),
    "salt_bridges": bridges,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "hydrophobic_contacts",
    label: "疏水接触 (Hydrophobic)",
    description:
      "检测两条链之间的疏水接触：疏水残基 (ALA/VAL/LEU/ILE/MET/PHE/TRP/PRO) 之间 < 4.5Å",
    requires: ["biopython"],
    params: [
      { name: "chain1", type: "string", required: true, description: "链 1 ID" },
      { name: "chain2", type: "string", required: true, description: "链 2 ID" },
      {
        name: "cutoff",
        type: "number",
        required: false,
        description: "距离截断 (Å)，默认 4.5",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      const cutoff = Number(params.cutoff ?? 4.5);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
chain1 = "${chain1}"; chain2 = "${chain2}"; cutoff = ${cutoff}
model = next(iter(struct))
if chain1 not in model or chain2 not in model:
    print(json.dumps({"error": f"chain {chain1} or {chain2} not found", "available_chains": [c.id for c in model]}))
    raise SystemExit
HYDROPHOBIC = {'ALA', 'VAL', 'LEU', 'ILE', 'MET', 'PHE', 'TRP', 'PRO'}
h1 = [a for r in model[chain1] if r.resname in HYDROPHOBIC for a in r if a.element == 'C']
h2 = [a for r in model[chain2] if r.resname in HYDROPHOBIC for a in r if a.element == 'C']
ns = NeighborSearch(h1 + h2)
pairs = ns.search_all(cutoff, level="A")
contacts = []
for a, b in pairs:
    if a.get_parent().get_parent().id == b.get_parent().get_parent().id:
        continue
    ra = a.get_parent(); rb = b.get_parent()
    contacts.append({
        "chain1": a.get_parent().get_parent().id,
        "resno1": int(ra.id[1]), "resname1": ra.resname,
        "atom1": a.get_name(),
        "chain2": b.get_parent().get_parent().id,
        "resno2": int(rb.id[1]), "resname2": rb.resname,
        "atom2": b.get_name(),
        "distance_A": round(float(a - b), 2),
    })
# Aggregate by residue pair
res_pairs = {}
for c in contacts:
    key = tuple(sorted([(c["resname1"] + str(c["resno1"]) + "(" + c["chain1"] + ")"),
                         (c["resname2"] + str(c["resno2"]) + "(" + c["chain2"] + ")")]))
    res_pairs[key] = res_pairs.get(key, 0) + 1
top = sorted(res_pairs.items(), key=lambda x: -x[1])[:20]
print(json.dumps({
    "chain1": chain1, "chain2": chain2, "cutoff": cutoff,
    "total_atom_contacts": len(contacts),
    "total_residue_pairs": len(res_pairs),
    "top_residue_pairs": [{"pair": " <-> ".join(k), "contacts": v} for k, v in top],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "ramachandran",
    label: "Ramachandran 图 (φ/ψ 角)",
    description:
      "计算所有残基的 φ/ψ 二面角，返回分布数据 + 落在允许/不允许区域的比例",
    requires: ["biopython"],
    params: [
      {
        name: "chain",
        type: "string",
        required: false,
        description: "链 ID（可选，默认全部链）",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain = String(params.chain ?? "");
      return `${RECIPE_HEADER}
from Bio.PDB import PPBuilder
import math
struct = load_structure("${inputPath}")
chain_filter = "${chain}"
model = next(iter(struct))
ppb = PPBuilder()
polypeptides = []
for pp in ppb.build_peptides(model):
    if chain_filter and pp[0].get_parent().id != chain_filter:
        continue
    polypeptides.append(pp)
data = []
regions = {"favoured": 0, "allowed": 0, "outlier": 0, "gly": 0, "pro": 0, "pre_pro": 0}
for pp in polypeptides:
    try:
        phipsi = list(pp.get_phi_psi_list())
    except Exception:
        continue
    for i, (phi, psi) in enumerate(phipsi):
        if phi is None or psi is None:
            continue
        # phi = C(i-1)-N(i)-CA(i)-C(i); psi = N(i)-CA(i)-C(i)-N(i+1)
        # The residue with phi/psi is the i-th residue in the peptide (0-indexed)
        # because get_phi_psi_list returns phi/psi for each residue starting from
        # the first (which has no phi if N-terminus, but biopython handles that).
        try:
            res_obj = pp[i] if i < len(pp) else None
            resno = res_obj.id[1] if res_obj else i + 1
            resname = res_obj.resname if res_obj else "X"
        except Exception:
            resno = i + 1
            resname = "X"
        # Classify region (approximate Ramachandran boundaries)
        phi_d = math.degrees(phi)
        psi_d = math.degrees(psi)
        region = "outlier"
        # Favoured: alpha-helix (-150<=phi<=-30, -90<=psi<=45) OR beta-sheet (-180<=phi<=-30, 90<=psi<=180)
        if (-150 <= phi_d <= -30 and -90 <= psi_d <= 45) or (-180 <= phi_d <= -30 and 90 <= psi_d <= 180):
            region = "favoured"
        elif -180 <= phi_d <= 180 and -180 <= psi_d <= 180:
            region = "allowed"
        if resname == "GLY":
            region = "gly"
        elif resname == "PRO":
            region = "pro"
        elif i > 0 and pp[i - 1].resname == "PRO":
            region = "pre_pro"
        regions[region if region in regions else "outlier"] += 1
        data.append({
            "chain": pp[0].get_parent().id,
            "resno": int(resno),
            "resname": resname,
            "phi": round(phi_d, 1),
            "psi": round(psi_d, 1),
            "region": region,
        })
total = len(data)
print(json.dumps({
    "total_residues": total,
    "regions": regions,
    "favoured_pct": round(100 * regions["favoured"] / max(1, total), 1),
    "outlier_pct": round(100 * regions["outlier"] / max(1, total), 1),
    "data": data,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "ligand_interactions",
    label: "配体互作指纹 (Ligand Fingerprint)",
    description:
      "检测指定配体周围 cutoff Å 内所有残基，分类接触类型（H-bond / 疏水 / 芳香 / 离子），生成互作指纹",
    requires: ["biopython"],
    params: [
      {
        name: "ligandCompId",
        type: "string",
        required: true,
        description: "配体 3-letter code，如 'N3', 'REA', 'A1BII'",
      },
      {
        name: "cutoff",
        type: "number",
        required: false,
        description: "距离截断 (Å)，默认 5.0",
      },
    ],
    buildScript: (inputPath, params) => {
      const ligandCompId = String(params.ligandCompId ?? "");
      const cutoff = Number(params.cutoff ?? 5.0);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
from collections import defaultdict
struct = load_structure("${inputPath}")
ligand_id = "${ligandCompId}"
cutoff = ${cutoff}
model = next(iter(struct))
# Find ligand residues
ligand_residues = [r for r in model.get_residues() if r.resname == ligand_id]
if not ligand_residues:
    available_het = sorted(set(r.resname for r in model.get_residues() if r.id[0].strip() != "" and r.resname != "HOH"))
    print(json.dumps({"error": f"ligand {ligand_id} not found", "available_ligands": available_het}))
    raise SystemExit
ligand_atoms = [a for r in ligand_residues for a in r]
# Find protein/nucleic residues within cutoff
ns = NeighborSearch(list(model.get_atoms()))
contacts = []
residue_contacts = defaultdict(list)
for ligand_atom in ligand_atoms:
    nearby = ns.search(ligand_atom.coord, cutoff, level="A")
    for nb_atom in nearby:
        nb_res = nb_atom.get_parent()
        if nb_res.id[0].strip() != "" and nb_res.resname != "HOH":
            # skip other ligand atoms of same comp
            if nb_res.resname == ligand_id:
                continue
            continue
        if nb_res.resname == "HOH":
            continue
        if nb_res.resname == ligand_id:
            continue
        # It's a protein/nucleic residue
        d = float(ligand_atom - nb_atom)
        # Classify
        atom_name = nb_atom.get_name()
        resname = nb_res.resname
        chain = nb_res.get_parent().id
        resno = int(nb_res.id[1])
        contact_type = "other"
        if atom_name.startswith(("N", "O")) or atom_name in ("ND1","ND2","NE1","NE2","NZ","OD1","OD2","OE1","OE2","OG","OG1","OH","NH1","NH2"):
            contact_type = "H-bond"
        elif atom_name.startswith(("C", "S")) or atom_name in ("SD", "SG"):
            contact_type = "hydrophobic"
        if resname in ("PHE","TYR","TRP","HIS") and atom_name in ("CG","CD1","CD2","CE1","CE2","CZ","CH2","NE1","CZ2","CZ3","CH2"):
            contact_type = "aromatic"
        if (resname in ("ARG","LYS","HIS") and atom_name in ("NH1","NH2","NE","NZ","ND1","NE2")) or \\
           (resname in ("ASP","GLU") and atom_name in ("OD1","OD2","OE1","OE2")):
            contact_type = "ionic"
        entry = {
            "ligand_atom": ligand_atom.get_name(),
            "chain": chain, "resno": resno, "resname": resname,
            "atom": atom_name, "distance_A": round(d, 2), "type": contact_type,
        }
        contacts.append(entry)
        residue_contacts[(chain, resno, resname)].append((contact_type, d))
# Aggregate per residue
residue_summary = []
for (chain, resno, resname), ct_list in sorted(residue_contacts.items()):
    types = set(t for t, _ in ct_list)
    min_d = min(d for _, d in ct_list)
    residue_summary.append({
        "chain": chain, "resno": resno, "resname": resname,
        "min_distance_A": round(min_d, 2),
        "n_contacts": len(ct_list),
        "contact_types": sorted(types),
    })
residue_summary.sort(key=lambda x: x["min_distance_A"])
# Count by type
type_counts = defaultdict(int)
for c in contacts:
    type_counts[c["type"]] += 1
print(json.dumps({
    "ligand": ligand_id, "cutoff": cutoff,
    "num_ligand_residues": len(ligand_residues),
    "total_contacts": len(contacts),
    "total_residues": len(residue_summary),
    "type_counts": dict(type_counts),
    "residues": residue_summary[:30],
    "contacts": contacts[:30],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "sequence_align",
    label: "序列比对 (Pairwise)",
    description:
      "两条链的蛋白序列进行全局比对 (Needleman-Wunsch)，返回比对结果 + 相同度/相似度/空位率",
    requires: ["biopython"],
    params: [
      {
        name: "chain1",
        type: "string",
        required: true,
        description: "链 1 ID",
      },
      {
        name: "chain2",
        type: "string",
        required: true,
        description: "链 2 ID",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      return `${RECIPE_HEADER}
from Bio import pairwise2
from Bio.PDB import PPBuilder
from Bio.SeqUtils import seq1
struct = load_structure("${inputPath}")
chain1_id = "${chain1}"
chain2_id = "${chain2}"
model = next(iter(struct))
if chain1_id not in model or chain2_id not in model:
    print(json.dumps({"error": f"chain {chain1_id} or {chain2_id} not found", "available_chains": [c.id for c in model]}))
    raise SystemExit
ppb = PPBuilder()
def get_sequence(chain_id):
    for pp in ppb.build_peptides(model[chain_id]):
        return "".join(seq1(r.resname) for r in pp)
    return ""
seq1_str = get_sequence(chain1_id)
seq2_str = get_sequence(chain2_id)
if not seq1_str or not seq2_str:
    print(json.dumps({"error": "could not extract sequence"}))
    raise SystemExit
# Global alignment with BLOSUM62
alignments = pairwise2.align.globalms(seq1_str, seq2_str, 2, -1, -2, -0.5, one_alignment_only=True)
if not alignments:
    print(json.dumps({"error": "alignment failed"}))
    raise SystemExit
aln = alignments[0]
aln_seq1 = aln.seqA
aln_seq2 = aln.seqB
score = aln.score
# Compute identity / similarity / gaps
matches = 0
similar = 0
gaps = 0
# Simple similarity groups
sim_groups = [
    set("GAVLI"), set("ST"), set("FYW"), set("KRH"), set("DE"), set("NQ"), set("CM"), set("P")
]
for a, b in zip(aln_seq1, aln_seq2):
    if a == "-" or b == "-":
        gaps += 1
    elif a == b:
        matches += 1
    else:
        for g in sim_groups:
            if a in g and b in g:
                similar += 1
                break
total = len(aln_seq1)
identity = round(100 * matches / max(1, total), 1)
similarity = round(100 * (matches + similar) / max(1, total), 1)
gap_pct = round(100 * gaps / max(1, total), 1)
# Format alignment in 60-char blocks with match line
blocks = []
for i in range(0, len(aln_seq1), 60):
    s1 = aln_seq1[i:i+60]
    s2 = aln_seq2[i:i+60]
    ml = ""
    for a, b in zip(s1, s2):
        if a == b:
            ml += "|"
        elif a == "-" or b == "-":
            ml += " "
        else:
            ml += "."
    blocks.append({"seq1": s1, "match": ml, "seq2": s2, "start": i+1})
print(json.dumps({
    "chain1": chain1_id, "chain2": chain2_id,
    "seq1_length": len(seq1_str), "seq2_length": len(seq2_str),
    "alignment_length": total,
    "identity_pct": identity,
    "similarity_pct": similarity,
    "gap_pct": gap_pct,
    "score": round(float(score), 1),
    "matches": matches,
    "similar": similar,
    "gaps": gaps,
    "blocks": blocks,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "electrostatic",
    label: "静电势分析 (Coulombic)",
    description:
      "计算每个残基的净电荷 + 周围 6Å 内的库仑相互作用能（简化版，无介电衰减）",
    requires: ["biopython"],
    params: [
      {
        name: "chain",
        type: "string",
        required: false,
        description: "链 ID（可选，默认全部链）",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain = String(params.chain ?? "");
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
import math
struct = load_structure("${inputPath}")
chain_filter = "${chain}"
model = next(iter(struct))
# Residue charges (approximate, at physiological pH)
CHARGES = {
    'ARG': 1.0, 'LYS': 1.0, 'HIS': 0.5,  # positive (HIS partial)
    'ASP': -1.0, 'GLU': -1.0,  # negative
    'CYS': 0.0, 'TYR': 0.0,  # neutral (pKa ~8-10, mostly protonated)
}
# Atom-level charges for backbone + sidechain (very simplified)
def atom_charge(resname, atom_name):
    if resname in ('ARG', 'LYS', 'HIS') and atom_name in ('NZ', 'NH1', 'NH2', 'NE', 'ND1', 'NE2'):
        return 1.0
    if resname in ('ASP', 'GLU') and atom_name in ('OD1', 'OD2', 'OE1', 'OE2'):
        return -1.0
    return 0.0
# Collect charged atoms
charged_atoms = []
for res in model.get_residues():
    if res.id[0].strip() != "" and res.resname != "HOH":
        continue
    if chain_filter and res.get_parent().id != chain_filter:
        continue
    for atom in res:
        q = atom_charge(res.resname, atom.get_name())
        if q != 0:
            charged_atoms.append((atom, q, res))
# Compute per-residue net charge + Coulombic energy
residue_data = {}
ns = NeighborSearch([a for a, _, _ in charged_atoms])
total_energy = 0.0
pairs = []
for atom, q, res in charged_atoms:
    nearby = ns.search(atom.coord, 6.0, level="A")
    for nb in nearby:
        if nb is atom:
            continue
        nb_res = nb.get_parent()
        if nb_res is res:
            continue
        # Find charge of nb
        nb_q = 0.0
        for a2, q2, r2 in charged_atoms:
            if a2 is nb:
                nb_q = q2
                break
        if nb_q == 0:
            continue
        d = float(atom - nb)
        if d < 1.0:
            d = 1.0
        # Coulomb: E = k * q1 * q2 / d (k=332 for kcal/mol with Å + e)
        e = 332.0 * q * nb_q / d
        total_energy += e / 2.0  # divide by 2 (counted twice)
        key = (res.get_parent().id, res.id[1], res.resname)
        if key not in residue_data:
            residue_data[key] = {'charge': 0.0, 'energy': 0.0, 'partners': set()}
        residue_data[key]['energy'] += e / 2.0
        residue_data[key]['partners'].add((nb_res.get_parent().id, nb_res.id[1], nb_res.resname))
# Aggregate
results = []
for (chain_id, resno, resname), d in sorted(residue_data.items()):
    results.append({
        'chain': chain_id, 'resno': int(resno), 'resname': resname,
        'charge': CHARGES.get(resname, 0.0),
        'coulomb_energy_kcal': round(float(d['energy']), 2),
        'n_partners': len(d['partners']),
    })
# Sort by absolute energy (most stabilizing/destabilizing)
results.sort(key=lambda x: abs(x['coulomb_energy_kcal']), reverse=True)
# Summary
pos_count = sum(1 for r in results if r['charge'] > 0)
neg_count = sum(1 for r in results if r['charge'] < 0)
neutral_count = sum(1 for r in results if r['charge'] == 0)
print(json.dumps({
    'total_charged_residues': len(results),
    'positive': pos_count, 'negative': neg_count, 'neutral': neutral_count,
    'total_coulomb_energy_kcal': round(float(total_energy), 2),
    'top_residues': results[:20],
    'all_residues': results,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "sequence_features",
    label: "序列特征 (pI/MW/糖基化/无序)",
    description:
      "计算蛋白序列的等电点 pI、分子量、N-糖基化位点 (N-X-S/T) 和简化的无序倾向区域 (连续带电残基)",
    requires: ["biopython"],
    params: [
      {
        name: "chain",
        type: "string",
        required: false,
        description: "链 ID（可选，默认全部链）",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain = String(params.chain ?? "");
      return `${RECIPE_HEADER}
from Bio.SeqUtils import seq1
from Bio.SeqUtils.IsoelectricPoint import IsoelectricPoint
from Bio.PDB import PPBuilder
struct = load_structure("${inputPath}")
chain_filter = "${chain}"
model = next(iter(struct))
ppb = PPBuilder()
results = []
for c in model:
    if chain_filter and c.id != chain_filter:
        continue
    # Build protein sequence
    seq = ""
    for pp in ppb.build_peptides(c):
        seq = "".join(seq1(r.resname) for r in pp)
        break
    if not seq or len(seq) < 2:
        results.append({
            "chain": c.id,
            "error": "no peptide sequence (may be DNA/RNA/ligand)",
        })
        continue
    # Isoelectric point + MW
    ip = IsoelectricPoint(seq)
    pI = round(float(ip.pi()), 2)
    # molecular weight (Da)
    mw = 0.0
    # average residue masses (Da) — including water loss for peptide bonds
    AA_MW = {
        'A': 71.0788, 'R': 156.1875, 'N': 114.1038, 'D': 115.0886,
        'C': 103.1388, 'E': 129.1155, 'Q': 128.1307, 'G': 57.0519,
        'H': 137.1411, 'I': 113.1594, 'L': 113.1594, 'K': 128.1741,
        'M': 131.1926, 'F': 147.1766, 'P': 97.1167, 'S': 87.0782,
        'T': 101.1051, 'W': 186.2132, 'Y': 163.1760, 'V': 99.1326,
    }
    for aa in seq:
        mw += AA_MW.get(aa, 110.0)
    mw += 18.0153  # water for N+H and C-OH termini
    # charge at pH 7.4 (approximate)
    charge_74 = round(float(ip.charge_at_pH(7.4)), 2)
    # N-glycosylation motif: N-X-S/T where X != P
    glycos_sites = []
    for i in range(len(seq) - 2):
        if seq[i] == 'N' and seq[i+1] != 'P' and seq[i+2] in ('S', 'T'):
            glycos_sites.append({
                "resno": i + 1,  # 1-based residue number (approx, ignores gaps)
                "motif": f"{seq[i]}{seq[i+1]}{seq[i+2]}",
                "position": i + 1,
            })
    # Disorder-prone regions: stretches of >=6 consecutive charged residues
    # (R/K/D/E) — simplified heuristic
    charged = set('RKDE')
    disorder_regions = []
    i = 0
    while i < len(seq):
        if seq[i] in charged:
            j = i
            while j < len(seq) and seq[j] in charged:
                j += 1
            if j - i >= 6:
                disorder_regions.append({
                    "start": i + 1,
                    "end": j,
                    "length": j - i,
                    "sequence": seq[i:j],
                })
            i = j
        else:
            i += 1
    # Composition summary
    from collections import Counter
    comp = Counter(seq)
    total = sum(comp.values())
    composition = {aa: round(100 * cnt / total, 1) for aa, cnt in sorted(comp.items())}
    # Hydrophobicity (Kyte-Doolittle average)
    KD = {'A':1.8,'R':-4.5,'N':-3.5,'D':-3.5,'C':2.5,'E':-3.5,'Q':-3.5,'G':-0.4,
          'H':-3.2,'I':4.5,'L':3.8,'K':-3.9,'M':1.9,'F':2.8,'P':-1.6,'S':-0.8,
          'T':-0.7,'W':-0.9,'Y':-1.3,'V':4.2}
    gravy = round(sum(KD.get(a, 0) for a in seq) / max(1, len(seq)), 3)
    results.append({
        "chain": c.id,
        "sequence_length": len(seq),
        "molecular_weight_Da": round(float(mw), 2),
        "isoelectric_point_pI": pI,
        "charge_at_pH_7_4": charge_74,
        "gravy_hydrophobicity": gravy,
        "n_glycosylation_sites": glycos_sites,
        "n_glycosylation_count": len(glycos_sites),
        "disorder_prone_regions": disorder_regions,
        "disorder_residue_count": sum(r["length"] for r in disorder_regions),
        "composition_pct": composition,
    })
print(json.dumps({
    "chain_filter": chain_filter or "all",
    "n_chains_analyzed": len(results),
    "chains": results,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "rmsd",
    label: "RMSD 计算 (两链 CA)",
    description:
      "计算两条链之间 CA 原子的 RMSD（需要相同残基数，按残基号配对）",
    requires: ["biopython"],
    params: [
      { name: "chain1", type: "string", required: true, description: "链 1 ID" },
      { name: "chain2", type: "string", required: true, description: "链 2 ID" },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      return `${RECIPE_HEADER}
import math
struct = load_structure("${inputPath}")
chain1_id = "${chain1}"
chain2_id = "${chain2}"
model = next(iter(struct))
if chain1_id not in model or chain2_id not in model:
    print(json.dumps({"error": f"chain {chain1_id} or {chain2_id} not found", "available_chains": [c.id for c in model]}))
    raise SystemExit
# Collect CA atoms by residue number
ca1 = {}
for res in model[chain1_id]:
    if res.id[0].strip() != "":
        continue
    if "CA" in res:
        ca1[res.id[1]] = res["CA"]
ca2 = {}
for res in model[chain2_id]:
    if res.id[0].strip() != "":
        continue
    if "CA" in res:
        ca2[res.id[1]] = res["CA"]
# Find common residue numbers
common = sorted(set(ca1.keys()) & set(ca2.keys()))
if len(common) < 3:
    print(json.dumps({"error": f"only {len(common)} common residues", "chain1_residues": len(ca1), "chain2_residues": len(ca2)}))
    raise SystemExit
# Compute RMSD (no superposition — raw coordinate RMSD)
sum_sq = 0.0
per_residue = []
for resno in common:
    a1 = ca1[resno]
    a2 = ca2[resno]
    dx = float(a1.coord[0] - a2.coord[0])
    dy = float(a1.coord[1] - a2.coord[1])
    dz = float(a1.coord[2] - a2.coord[2])
    d2 = dx*dx + dy*dy + dz*dz
    sum_sq += d2
    per_residue.append({"resno": int(resno), "deviation_A": round(math.sqrt(d2), 2)})
rmsd = math.sqrt(sum_sq / len(common))
# Also compute RMSD after optimal superposition (Kabsch algorithm)
import numpy as np
P = np.array([ca1[r].coord for r in common])
Q = np.array([ca2[r].coord for r in common])
# Center
P_c = P - P.mean(axis=0)
Q_c = Q - Q.mean(axis=0)
# Kabsch
H = P_c.T @ Q_c
U, S, Vt = np.linalg.svd(H)
d = np.sign(np.linalg.det(Vt.T @ U.T))
D = np.diag([1, 1, d])
R = Vt.T @ D @ U.T
P_rot = P_c @ R.T
diff = P_rot - Q_c
rmsd_aligned = math.sqrt(np.sum(diff * diff) / len(common))
print(json.dumps({
    "chain1": chain1_id, "chain2": chain2_id,
    "common_residues": len(common),
    "chain1_total": len(ca1), "chain2_total": len(ca2),
    "rmsd_raw_A": round(float(rmsd), 3),
    "rmsd_aligned_A": round(float(rmsd_aligned), 3),
    "per_residue": per_residue[:30],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "secondary_structure_simple",
    label: "二级结构统计 (简化)",
    description:
      "通过 φ/ψ 角推断二级结构（α-helix / β-sheet / coil），统计各类型比例",
    requires: ["biopython"],
    params: [
      {
        name: "chain",
        type: "string",
        required: false,
        description: "链 ID（可选，默认全部链）",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain = String(params.chain ?? "");
      return `${RECIPE_HEADER}
from Bio.PDB import PPBuilder
import math
struct = load_structure("${inputPath}")
chain_filter = "${chain}"
model = next(iter(struct))
ppb = PPBuilder()
ss_counts = {"alpha_helix": 0, "beta_sheet": 0, "coil": 0, "turn": 0}
total = 0
residue_ss = []
for pp in ppb.build_peptides(model):
    if chain_filter and pp[0].get_parent().id != chain_filter:
        continue
    try:
        phipsi = list(pp.get_phi_psi_list())
    except Exception:
        continue
    for i, (phi, psi) in enumerate(phipsi):
        if phi is None or psi is None:
            ss_counts["coil"] += 1
            total += 1
            continue
        phi_d = math.degrees(phi)
        psi_d = math.degrees(psi)
        ss = "coil"
        # Alpha-helix: phi ~ -60, psi ~ -45
        if -90 <= phi_d <= -30 and -75 <= psi_d <= 15:
            ss = "alpha_helix"
        # Beta-sheet: phi ~ -120, psi ~ 130
        elif -180 <= phi_d <= -60 and 90 <= psi_d <= 180:
            ss = "beta_sheet"
        # Turn: phi ~ -60, psi ~ 30-90
        elif -90 <= phi_d <= 0 and 0 <= psi_d <= 90:
            ss = "turn"
        ss_counts[ss] += 1
        total += 1
        try:
            res_obj = pp[i]
            residue_ss.append({
                "chain": pp[0].get_parent().id,
                "resno": int(res_obj.id[1]),
                "resname": res_obj.resname,
                "phi": round(phi_d, 1),
                "psi": round(psi_d, 1),
                "ss": ss,
            })
        except Exception:
            pass
print(json.dumps({
    "total_residues": total,
    "ss_counts": ss_counts,
    "alpha_helix_pct": round(100 * ss_counts["alpha_helix"] / max(1, total), 1),
    "beta_sheet_pct": round(100 * ss_counts["beta_sheet"] / max(1, total), 1),
    "coil_pct": round(100 * ss_counts["coil"] / max(1, total), 1),
    "turn_pct": round(100 * ss_counts["turn"] / max(1, total), 1),
    "residues": residue_ss,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "bfactor_stats",
    label: "B-factor / pLDDT 统计",
    description:
      "统计每条链的 B-factor 分布（均值/最小/最大/标准差），返回分箱直方图数据 + 高柔性残基列表",
    requires: ["biopython"],
    params: [
      {
        name: "chain",
        type: "string",
        required: false,
        description: "链 ID（可选，默认全部链）",
      },
    ],
    buildScript: (inputPath, params) => {
      const chain = String(params.chain ?? "");
      return `${RECIPE_HEADER}
import math
struct = load_structure("${inputPath}")
chain_filter = "${chain}"
model = next(iter(struct))
chain_data = {}
for chain_obj in model:
    if chain_filter and chain_obj.id != chain_filter:
        continue
    bvalues = []
    per_residue = []
    for res in chain_obj:
        if res.id[0].strip() != "":
            continue
        res_bvals = []
        for atom in res:
            try:
                bf = float(atom.bfactor)
                bvalues.append(bf)
                res_bvals.append(bf)
            except Exception:
                pass
        if res_bvals:
            avg = sum(res_bvals) / len(res_bvals)
            per_residue.append({
                'resno': int(res.id[1]),
                'resname': res.resname,
                'bfactor': round(avg, 2),
            })
    if not bvalues:
        continue
    n = len(bvalues)
    mean = sum(bvalues) / n
    mn = min(bvalues)
    mx = max(bvalues)
    variance = sum((b - mean) ** 2 for b in bvalues) / n
    std = math.sqrt(variance)
    # Histogram (10 bins from min to max)
    bin_size = (mx - mn) / 10 if mx > mn else 1
    bins = [0] * 10
    for b in bvalues:
        idx = min(int((b - mn) / bin_size), 9)
        bins[idx] += 1
    # High flexibility residues (B-factor > mean + 1.5*std)
    threshold = mean + 1.5 * std
    high_flex = [r for r in per_residue if r['bfactor'] > threshold]
    high_flex.sort(key=lambda x: -x['bfactor'])
    # Detect pLDDT (AlphaFold structures have B-factor = pLDDT 0-100)
    is_plddt = mx <= 100 and mn >= 0 and mean < 100
    chain_data[chain_obj.id] = {
        'chain': chain_obj.id,
        'n_atoms': n,
        'mean': round(mean, 2),
        'min': round(mn, 2),
        'max': round(mx, 2),
        'std': round(std, 2),
        'histogram_bins': bins,
        'histogram_bin_size': round(bin_size, 2),
        'threshold_high_flex': round(threshold, 2),
        'high_flexibility_residues': high_flex[:20],
        'is_plddt': is_plddt,
        'per_residue_count': len(per_residue),
    }
print(json.dumps({
    'chains': chain_data,
    'total_chains': len(chain_data),
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "cross_pdb_rmsd",
    label: "跨 PDB RMSD 矩阵",
    description:
      "下载多个 PDB 结构，计算链 A 的 CA 原子两两 RMSD（Kabsch 叠合），返回 RMSD 矩阵",
    requires: ["biopython", "numpy"],
    params: [
      {
        name: "pdbIds",
        type: "string[]",
        required: true,
        description: 'PDB ID 列表，如 ["1CBS","1TQN","4HHB"]',
      },
      {
        name: "chain",
        type: "string",
        required: false,
        description: "链 ID（默认 A）",
      },
    ],
    buildScript: (_inputPath, params) => {
      const pdbIds = JSON.stringify(params.pdbIds ?? []);
      const chain = String(params.chain ?? "A");
      return `
import json, math, os, urllib.request
import numpy as np
from Bio.PDB import PDBParser, MMCIFParser

pdb_ids = json.loads('''${pdbIds}''')
chain_id = "${chain}"
cache_dir = "/tmp/molcraft-analysis/pdb"
os.makedirs(cache_dir, exist_ok=True)

def download_structure(pdb_id):
    pdb_id = pdb_id.lower()
    pdb_path = os.path.join(cache_dir, pdb_id + ".pdb")
    cif_path = os.path.join(cache_dir, pdb_id + ".cif")
    if os.path.exists(pdb_path):
        return pdb_path, "pdb"
    if os.path.exists(cif_path):
        return cif_path, "cif"
    # Try PDB first
    try:
        url = f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb"
        urllib.request.urlretrieve(url, pdb_path)
        if os.path.getsize(pdb_path) > 100:
            return pdb_path, "pdb"
    except Exception:
        pass
    # Fall back to mmCIF
    try:
        url = f"https://files.rcsb.org/download/{pdb_id.upper()}.cif"
        urllib.request.urlretrieve(url, cif_path)
        return cif_path, "cif"
    except Exception as e:
        return None, str(e)

def get_ca_atoms(pdb_id):
    path, fmt = download_structure(pdb_id)
    if not path:
        return None, f"download failed: {fmt}"
    if fmt == "cif":
        parser = MMCIFParser(QUIET=True)
    else:
        parser = PDBParser(QUIET=True)
    try:
        struct = parser.get_structure("s", path)
        model = next(iter(struct))
        if chain_id not in model:
            return None, f"chain {chain_id} not found"
        ca = []
        for res in model[chain_id]:
            if res.id[0].strip() != "":
                continue
            if "CA" in res:
                ca.append(res["CA"])
        return ca, None
    except Exception as e:
        return None, str(e)

def kabsch_rmsd(P, Q):
    P_c = P - P.mean(axis=0)
    Q_c = Q - Q.mean(axis=0)
    H = P_c.T @ Q_c
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d])
    R = Vt.T @ D @ U.T
    P_rot = P_c @ R.T
    diff = P_rot - Q_c
    return math.sqrt(np.sum(diff * diff) / len(P))

# Download all structures
structures = {}
errors = {}
for pid in pdb_ids:
    ca, err = get_ca_atoms(pid)
    if err:
        errors[pid] = err
    else:
        structures[pid] = ca

valid_ids = list(structures.keys())
if len(valid_ids) < 2:
    print(json.dumps({"error": "need at least 2 valid structures", "errors": errors}))
    raise SystemExit

# Compute pairwise RMSD (using minimum common residue count)
n = len(valid_ids)
matrix = [[0.0] * n for _ in range(n)]
for i in range(n):
    for j in range(i + 1, n):
        ca1 = structures[valid_ids[i]]
        ca2 = structures[valid_ids[j]]
        # Match by residue number
        resnos1 = {r.id[1]: idx for idx, r in enumerate(ca1)}
        resnos2 = {r.id[1]: idx for idx, r in enumerate(ca2)}
        common = sorted(set(resnos1.keys()) & set(resnos2.keys()))
        if len(common) < 3:
            matrix[i][j] = -1
            matrix[j][i] = -1
            continue
        P = np.array([ca1[resnos1[r]].coord for r in common], dtype=float)
        Q = np.array([ca2[resnos2[r]].coord for r in common], dtype=float)
        rmsd = kabsch_rmsd(P, Q)
        matrix[i][j] = round(rmsd, 3)
        matrix[j][i] = round(rmsd, 3)

print(json.dumps({
    "pdb_ids": valid_ids,
    "chain": chain_id,
    "matrix": matrix,
    "errors": errors,
    "common_residues_note": "RMSD computed on CA atoms of common residue numbers",
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "cross_pdb_rmsd_aligned",
    label: "序列对齐驱动的跨 PDB RMSD",
    description:
      "下载多个 PDB，先用序列比对匹配残基，再计算 CA 原子两两 Kabsch 叠合 RMSD（解决残基编号不匹配问题）",
    requires: ["biopython", "numpy"],
    params: [
      {
        name: "pdbIds",
        type: "string[]",
        required: true,
        description: 'PDB ID 列表，如 ["1CBS","1CBR"]',
      },
      {
        name: "chain",
        type: "string",
        required: false,
        description: "链 ID（默认 A）",
      },
    ],
    buildScript: (_inputPath, params) => {
      const pdbIds = JSON.stringify(params.pdbIds ?? []);
      const chain = String(params.chain ?? "A");
      return `
import json, math, os, urllib.request
import numpy as np
from Bio import pairwise2
from Bio.PDB import PDBParser, MMCIFParser, PPBuilder
from Bio.SeqUtils import seq1

pdb_ids = json.loads('''${pdbIds}''')
chain_id = "${chain}"
cache_dir = "/tmp/molcraft-analysis/pdb"
os.makedirs(cache_dir, exist_ok=True)

def download_structure(pdb_id):
    pdb_id = pdb_id.lower()
    pdb_path = os.path.join(cache_dir, pdb_id + ".pdb")
    cif_path = os.path.join(cache_dir, pdb_id + ".cif")
    if os.path.exists(pdb_path):
        return pdb_path, "pdb"
    if os.path.exists(cif_path):
        return cif_path, "cif"
    try:
        url = f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb"
        urllib.request.urlretrieve(url, pdb_path)
        if os.path.getsize(pdb_path) > 100:
            return pdb_path, "pdb"
    except Exception:
        pass
    try:
        url = f"https://files.rcsb.org/download/{pdb_id.upper()}.cif"
        urllib.request.urlretrieve(url, cif_path)
        return cif_path, "cif"
    except Exception as e:
        return None, str(e)

def get_chain_data(pdb_id):
    """Return (sequence, ca_atoms_by_resno) for the chain."""
    path, fmt = download_structure(pdb_id)
    if not path:
        return None, None, f"download failed: {fmt}"
    if fmt == "cif":
        parser = MMCIFParser(QUIET=True)
    else:
        parser = PDBParser(QUIET=True)
    try:
        struct = parser.get_structure("s", path)
        model = next(iter(struct))
        if chain_id not in model:
            return None, None, f"chain {chain_id} not found"
        ca_by_resno = {}
        ppb = PPBuilder()
        seq = ""
        for pp in ppb.build_peptides(model[chain_id]):
            seq = "".join(seq1(r.resname) for r in pp)
            break
        for res in model[chain_id]:
            if res.id[0].strip() != "":
                continue
            if "CA" in res:
                ca_by_resno[res.id[1]] = res["CA"]
        return seq, ca_by_resno, None
    except Exception as e:
        return None, None, str(e)

# Download all structures
structures = {}
errors = {}
for pid in pdb_ids:
    seq, ca, err = get_chain_data(pid)
    if err:
        errors[pid] = err
    else:
        structures[pid] = {"seq": seq, "ca": ca}

valid_ids = list(structures.keys())
if len(valid_ids) < 2:
    print(json.dumps({"error": "need at least 2 valid structures", "errors": errors}))
    raise SystemExit

# For each pair, do sequence alignment and match CA atoms by alignment position
def kabsch_rmsd(P, Q):
    P_c = P - P.mean(axis=0)
    Q_c = Q - Q.mean(axis=0)
    H = P_c.T @ Q_c
    U, S, Vt = np.linalg.svd(H)
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    D = np.diag([1, 1, d])
    R = Vt.T @ D @ U.T
    P_rot = P_c @ R.T
    diff = P_rot - Q_c
    return math.sqrt(np.sum(diff * diff) / len(P))

def aligned_rmsd(id1, id2):
    s1 = structures[id1]["seq"]
    s2 = structures[id2]["seq"]
    ca1 = structures[id1]["ca"]
    ca2 = structures[id2]["ca"]
    if not s1 or not s2:
        return -1, 0, "no sequence"
    # Global alignment
    alignments = pairwise2.align.globalms(s1, s2, 2, -1, -2, -0.5, one_alignment_only=True)
    if not alignments:
        return -1, 0, "alignment failed"
    aln = alignments[0]
    # Walk the alignment and collect matched residue numbers
    resnos1 = sorted(ca1.keys())
    resnos2 = sorted(ca2.keys())
    # Map sequence position → resno (1-indexed within sequence)
    # The sequence from PPBuilder is in residue order, so position i → resnos1[i]
    matched_pairs = []
    i1 = 0  # index into resnos1
    i2 = 0  # index into resnos2
    for a, b in zip(aln.seqA, aln.seqB):
        if a == "-" and b == "-":
            continue
        r1 = None
        r2 = None
        if a != "-":
            if i1 < len(resnos1):
                r1 = resnos1[i1]
            i1 += 1
        if b != "-":
            if i2 < len(resnos2):
                r2 = resnos2[i2]
            i2 += 1
        if r1 is not None and r2 is not None:
            matched_pairs.append((r1, r2))
    if len(matched_pairs) < 3:
        return -1, len(matched_pairs), "too few matched residues"
    P = np.array([ca1[r1].coord for r1, r2 in matched_pairs], dtype=float)
    Q = np.array([ca2[r2].coord for r1, r2 in matched_pairs], dtype=float)
    rmsd = kabsch_rmsd(P, Q)
    identity = sum(1 for a, b in zip(aln.seqA, aln.seqB) if a == b and a != "-")
    return rmsd, len(matched_pairs), f"{identity}/{len(matched_pairs)} matched"

# Compute pairwise RMSD
n = len(valid_ids)
matrix = [[0.0] * n for _ in range(n)]
matched_counts = [[0] * n for _ in range(n)]
for i in range(n):
    for j in range(i + 1, n):
        rmsd, matched, note = aligned_rmsd(valid_ids[i], valid_ids[j])
        matrix[i][j] = round(rmsd, 3) if rmsd >= 0 else -1
        matrix[j][i] = matrix[i][j]
        matched_counts[i][j] = matched
        matched_counts[j][i] = matched

print(json.dumps({
    "pdb_ids": valid_ids,
    "chain": chain_id,
    "matrix": matrix,
    "matched_counts": matched_counts,
    "errors": errors,
    "method": "sequence-alignment-driven CA RMSD (Kabsch)",
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "aromatic_stacking",
    label: "芳香族堆积 (Aromatic Stacking)",
    description:
      "检测两条链之间的 π-π 堆积和阳离子-π 相互作用 (PHE/TYR/TRP/HIS 环中心 < 6Å)",
    requires: ["biopython", "numpy"],
    params: [
      { name: "chain1", type: "string", required: true, description: "链 1 ID" },
      { name: "chain2", type: "string", required: true, description: "链 2 ID" },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
import numpy as np
import math
struct = load_structure("${inputPath}")
chain1_id = "${chain1}"; chain2_id = "${chain2}"
model = next(iter(struct))
if chain1_id not in model or chain2_id not in model:
    print(json.dumps({"error": f"chain not found", "available": [c.id for c in model]}))
    raise SystemExit
AROMATIC = {
    'PHE': ['CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ'],
    'TYR': ['CG', 'CD1', 'CD2', 'CE1', 'CE2', 'CZ'],
    'TRP': ['CG', 'CD1', 'CD2', 'NE1', 'CE2', 'CE3', 'CZ2', 'CZ3', 'CH2'],
    'HIS': ['CG', 'ND1', 'CD2', 'CE1', 'NE2'],
}
CATION = {'ARG': ['NH1','NH2','NE'], 'LYS': ['NZ'], 'HIS': ['ND1','NE2']}
def ring_center(res, atom_names):
    coords = []
    for an in atom_names:
        if an in res:
            coords.append(list(res[an].coord))
    if len(coords) < 3:
        return None
    return np.mean(coords, axis=0)
def ring_normal(res, atom_names):
    coords = []
    for an in atom_names:
        if an in res:
            coords.append(list(res[an].coord))
    if len(coords) < 3:
        return None
    coords = np.array(coords)
    v1 = coords[1] - coords[0]
    v2 = coords[2] - coords[0]
    n = np.cross(v1, v2)
    norm = np.linalg.norm(n)
    if norm < 0.01:
        return None
    return n / norm
# Collect aromatic rings
rings1 = []
rings2 = []
cations1 = []
cations2 = []
for res in model[chain1_id]:
    if res.id[0].strip() != "": continue
    if res.resname in AROMATIC:
        c = ring_center(res, AROMATIC[res.resname])
        n = ring_normal(res, AROMATIC[res.resname])
        if c is not None:
            rings1.append({'res': res, 'center': c, 'normal': n})
    if res.resname in CATION:
        for an in CATION[res.resname]:
            if an in res:
                cations1.append({'res': res, 'atom': an, 'coord': list(res[an].coord)})
for res in model[chain2_id]:
    if res.id[0].strip() != "": continue
    if res.resname in AROMATIC:
        c = ring_center(res, AROMATIC[res.resname])
        n = ring_normal(res, AROMATIC[res.resname])
        if c is not None:
            rings2.append({'res': res, 'center': c, 'normal': n})
    if res.resname in CATION:
        for an in CATION[res.resname]:
            if an in res:
                cations2.append({'res': res, 'atom': an, 'coord': list(res[an].coord)})
stacking = []
# π-π stacking
for r1 in rings1:
    for r2 in rings2:
        dist = float(np.linalg.norm(r1['center'] - r2['center']))
        if dist > 6.0:
            continue
        # Angle between normals
        dot = float(np.dot(r1['normal'], r2['normal']))
        angle = math.degrees(math.acos(max(-1, min(1, abs(dot)))))
        stack_type = "unknown"
        if angle < 30:
            stack_type = "parallel"  # face-to-face
        elif angle > 60:
            stack_type = "perpendicular"  # T-shaped / edge-to-face
        elif 30 <= angle <= 60:
            stack_type = "displaced"
        stacking.append({
            'type': 'pi_pi',
            'stacking': stack_type,
            'res1': f"{r1['res'].resname}{r1['res'].id[1]}({chain1_id})",
            'res2': f"{r2['res'].resname}{r2['res'].id[1]}({chain2_id})",
            'distance_A': round(dist, 2),
            'angle_deg': round(angle, 1),
        })
# Cation-π
for ring in rings1:
    for cat in cations2:
        dist = float(np.linalg.norm(ring['center'] - np.array(cat['coord'])))
        if dist > 6.0:
            continue
        stacking.append({
            'type': 'cation_pi',
            'res1': f"{ring['res'].resname}{ring['res'].id[1]}({chain1_id})",
            'res2': f"{cat['res'].resname}{cat['res'].id[1]}({chain2_id})",
            'cation_atom': cat['atom'],
            'distance_A': round(dist, 2),
        })
for ring in rings2:
    for cat in cations1:
        dist = float(np.linalg.norm(ring['center'] - np.array(cat['coord'])))
        if dist > 6.0:
            continue
        stacking.append({
            'type': 'cation_pi',
            'res1': f"{cat['res'].resname}{cat['res'].id[1]}({chain1_id})",
            'res2': f"{ring['res'].resname}{ring['res'].id[1]}({chain2_id})",
            'cation_atom': cat['atom'],
            'distance_A': round(dist, 2),
        })
print(json.dumps({
    'total_aromatic_interactions': len(stacking),
    'pi_pi_count': sum(1 for s in stacking if s['type'] == 'pi_pi'),
    'cation_pi_count': sum(1 for s in stacking if s['type'] == 'cation_pi'),
    'interactions': stacking,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "water_bridges",
    label: "水桥 (Water Bridges)",
    description:
      "检测通过水分子介导的氢键网络 (蛋白-水-蛋白)，返回水分子坐标 + 两端残基",
    requires: ["biopython"],
    params: [
      { name: "chain1", type: "string", required: true, description: "链 1 ID" },
      { name: "chain2", type: "string", required: true, description: "链 2 ID" },
      { name: "cutoff", type: "number", required: false, description: "水-蛋白距离截断 (Å)，默认 3.5" },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "B");
      const cutoff = Number(params.cutoff ?? 3.5);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
chain1_id = "${chain1}"; chain2_id = "${chain2}"; cutoff = ${cutoff}
model = next(iter(struct))
if chain1_id not in model or chain2_id not in model:
    print(json.dumps({"error": "chain not found"}))
    raise SystemExit
# Find water molecules
waters = []
for res in model.get_residues():
    if res.resname == "HOH" and "O" in res:
        waters.append(res)
if not waters:
    print(json.dumps({"total_water_bridges": 0, "note": "no water molecules found"}))
    raise SystemExit
# Collect protein polar atoms
polar_atoms_1 = []
polar_atoms_2 = []
POLAR = {'N', 'O', 'S'}
for res in model[chain1_id]:
    if res.id[0].strip() != "": continue
    for atom in res:
        if atom.element in POLAR:
            polar_atoms_1.append((atom, res))
for res in model[chain2_id]:
    if res.id[0].strip() != "": continue
    for atom in res:
        if atom.element in POLAR:
            polar_atoms_2.append((atom, res))
ns1 = NeighborSearch([a for a, _ in polar_atoms_1])
ns2 = NeighborSearch([a for a, _ in polar_atoms_2])
bridges = []
seen_pairs = set()
for water in waters:
    o = water["O"]
    nearby1 = ns1.search(o.coord, cutoff, level="A")
    nearby2 = ns2.search(o.coord, cutoff, level="A")
    if nearby1 and nearby2:
        for a1 in nearby1:
            r1 = a1.get_parent()
            for a2 in nearby2:
                r2 = a2.get_parent()
                if r1 is r2: continue
                d1 = round(float(a1 - o), 2)
                d2 = round(float(a2 - o), 2)
                # Strictly enforce: both distances must be <= cutoff
                if d1 > cutoff or d2 > cutoff: continue
                # Deduplicate by (water, res1, res2)
                key = (int(water.id[1]), f"{r1.resname}{r1.id[1]}({chain1_id})", f"{r2.resname}{r2.id[1]}({chain2_id})")
                if key in seen_pairs: continue
                seen_pairs.add(key)
                bridges.append({
                    'water_resno': int(water.id[1]),
                    'res1': f"{r1.resname}{r1.id[1]}({chain1_id})",
                    'atom1': a1.get_name(),
                    'dist1_A': d1,
                    'res2': f"{r2.resname}{r2.id[1]}({chain2_id})",
                    'atom2': a2.get_name(),
                    'dist2_A': d2,
                    'total_path_A': round(d1 + d2, 2),
                })
print(json.dumps({
    'total_water_bridges': len(bridges),
    'bridges': bridges[:30],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "metal_coordination",
    label: "金属配位 (Metal Coordination)",
    description:
      "检测金属离子周围的所有配位残基 (金属-配体距离 < 3.5Å)",
    requires: ["biopython"],
    params: [
      { name: "cutoff", type: "number", required: false, description: "距离截断 (Å)，默认 3.5" },
    ],
    buildScript: (inputPath, params) => {
      const cutoff = Number(params.cutoff ?? 3.5);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
cutoff = ${cutoff}
model = next(iter(struct))
METALS = {'ZN', 'MG', 'CA', 'MN', 'FE', 'CU', 'NI', 'CO', 'CD', 'NA', 'K', 'MO', 'W'}
metal_residues = []
for res in model.get_residues():
    if res.resname.strip() in METALS:
        metal_residues.append(res)
if not metal_residues:
    print(json.dumps({"total_metals": 0, "note": "no metal ions found"}))
    raise SystemExit
all_atoms = list(model.get_atoms())
ns = NeighborSearch(all_atoms)
results = []
for metal in metal_residues:
    metal_name = metal.resname
    metal_resno = metal.id[1]
    metal_chain = metal.get_parent().id
    metal_atom = list(metal.get_atoms())[0]
    nearby = ns.search(metal_atom.coord, cutoff, level="A")
    ligands = []
    for nb in nearby:
        nb_res = nb.get_parent()
        if nb_res is metal: continue
        if nb_res.resname in METALS or nb_res.resname == "HOH": continue
        d = round(float(metal_atom - nb), 2)
        # Determine coordination geometry
        DONOR_ATOMS = {'SG', 'OG', 'OG1', 'OD1', 'OD2', 'OE1', 'OE2', 'ND1', 'NE2', 'NZ', 'NE', 'NH1', 'NH2', 'O', 'N', 'S'}
        is_donor = nb.get_name() in DONOR_ATOMS
        ligands.append({
            'resname': nb_res.resname,
            'resno': int(nb_res.id[1]),
            'chain': nb_res.get_parent().id,
            'atom': nb.get_name(),
            'distance_A': d,
            'is_donor': is_donor,
        })
    ligands.sort(key=lambda x: x['distance_A'])
    geometry = "unknown"
    n = len(ligands)
    if n == 4: geometry = "tetrahedral"
    elif n == 6: geometry = "octahedral"
    elif n == 5: geometry = "trigonal_bipyramidal"
    elif n == 3: geometry = "trigonal_planar"
    elif n == 2: geometry = "linear"
    results.append({
        'metal': f"{metal_name}{metal_resno}({metal_chain})",
        'coordination_number': n,
        'geometry': geometry,
        'ligands': ligands[:10],
    })
print(json.dumps({
    'total_metals': len(results),
    'metals': results,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "structure_validation",
    label: "结构质量验证 (Validation)",
    description:
      "检查结构质量：原子碰撞 (距离 < 1.5Å)、Ramachandran 异常、缺失侧链",
    requires: ["biopython", "numpy"],
    params: [],
    buildScript: (inputPath) => `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch, PPBuilder
import math
struct = load_structure("${inputPath}")
model = next(iter(struct))
issues = []
# 1. Check for clashes (non-bonded atoms < 1.5 Å)
all_atoms = list(model.get_atoms())
ns = NeighborSearch(all_atoms)
clash_pairs = ns.search_all(1.5, level="A")
clashes = []
for a, b in clash_pairs:
    r_a = a.get_parent()
    r_b = b.get_parent()
    # Skip bonded atoms (same residue or adjacent)
    if r_a is r_b: continue
    if abs(r_a.id[1] - r_b.id[1]) <= 1 and r_a.get_parent().id == r_b.get_parent().id:
        continue
    d = float(a - b)
    if d < 0.8:  # serious clash
        clashes.append({
            'atom1': f"{r_a.resname}{r_a.id[1]}/{a.get_name()}({r_a.get_parent().id})",
            'atom2': f"{r_b.resname}{r_b.id[1]}/{b.get_name()}({r_b.get_parent().id})",
            'distance_A': round(d, 2),
        })
issues.append({'type': 'clashes', 'count': len(clashes), 'details': clashes[:10]})
# 2. Ramachandran outliers
ppb = PPBuilder()
outlier_count = 0
total_phi_psi = 0
for pp in ppb.build_peptides(model):
    try:
        phipsi = list(pp.get_phi_psi_list())
    except:
        continue
    for i, (phi, psi) in enumerate(phipsi):
        if phi is None or psi is None: continue
        total_phi_psi += 1
        phi_d = math.degrees(phi)
        psi_d = math.degrees(psi)
        is_outlier = True
        if (-150 <= phi_d <= -30 and -90 <= psi_d <= 45): is_outlier = False
        elif (-180 <= phi_d <= -30 and 90 <= psi_d <= 180): is_outlier = False
        elif (-90 <= phi_d <= 0 and 0 <= psi_d <= 90): is_outlier = False
        if is_outlier:
            outlier_count += 1
            if outlier_count <= 10:
                try:
                    res = pp[i]
                    issues.append({
                        'type': 'rama_outlier',
                        'residue': f"{res.resname}{res.id[1]}({res.get_parent().id})",
                        'phi': round(phi_d, 1),
                        'psi': round(psi_d, 1),
                    })
                except: pass
rama_outlier_pct = round(100 * outlier_count / max(1, total_phi_psi), 1)
# 3. Missing sidechain (CA only residues)
missing_sc = 0
for res in model.get_residues():
    if res.id[0].strip() != "": continue
    if res.resname == "GLY": continue
    if "CA" in res and "CB" not in res and res.resname != "ALA":
        missing_sc += 1
        if missing_sc <= 5:
            issues.append({
                'type': 'missing_sidechain',
                'residue': f"{res.resname}{res.id[1]}({res.get_parent().id})",
            })
# 4. Summary
quality = "good"
if len(clashes) > 10 or rama_outlier_pct > 5 or missing_sc > 5:
    quality = "poor"
elif len(clashes) > 3 or rama_outlier_pct > 2 or missing_sc > 1:
    quality = "fair"
print(json.dumps({
    'quality': quality,
    'clash_count': len(clashes),
    'rama_outlier_count': outlier_count,
    'rama_outlier_pct': rama_outlier_pct,
    'total_phi_psi': total_phi_psi,
    'missing_sidechain_count': missing_sc,
    'issues': issues[:20],
}, ensure_ascii=False, indent=2))
`,
  },
  {
    id: "apbs_electrostatic",
    label: "APBS 静电势 (pdb2pqr + Poisson-Boltzmann)",
    description:
      "计算表面静电势：使用 pdb2pqr 分配 PARSE 力场真实电荷，然后基于 Debye-Hückel 理论的线性化 Poisson-Boltzmann 方程计算每个表面原子的静电势",
    requires: ["biopython", "numpy"],
    params: [
      { name: "chain", type: "string", required: false, description: "链 ID（可选，默认全部链）" },
      { name: "ionic_strength", type: "number", required: false, description: "离子强度 (mM)，默认 150" },
      { name: "grid_spacing", type: "number", required: false, description: "网格间距 (Å)，默认 1.0" },
      { name: "ff", type: "string", required: false, description: "力场 (PARSE/AMBER/CHARMM)，默认 PARSE" },
    ],
    buildScript: (inputPath, params) => {
      const chain = String(params.chain ?? "");
      const ionic = Number(params.ionic_strength ?? 150);
      const grid = Number(params.grid_spacing ?? 1.0);
      const ff = String(params.ff ?? "PARSE");
      return `${RECIPE_HEADER}
import numpy as np
from Bio.PDB import PDBParser
import subprocess, os, math

# --- Step 1: Run pdb2pqr to assign real forcefield charges ---
input_pdb = "${inputPath}"
pqr_path = input_pdb.rsplit('.', 1)[0] + "_charged.pqr"
ff_name = "${ff}"
pdb2pqr_ok = False
pdb2pqr_log = ""
try:
    cmd = ["pdb2pqr", "--ff=" + ff_name, "--whitespace", "--apbs-input", input_pdb.rsplit('.', 1)[0] + "_apbs.in", input_pdb, pqr_path]
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if proc.returncode == 0 and os.path.exists(pqr_path) and os.path.getsize(pqr_path) > 100:
        pdb2pqr_ok = True
    else:
        pdb2pqr_log = (proc.stderr or proc.stdout or "")[:500]
except Exception as e:
    pdb2pqr_log = str(e)[:500]

# --- Step 2: Parse PQR for charges (with fallback) ---
struct = load_structure("${inputPath}")
chain_filter = "${chain}"
model = next(iter(struct))

# Fallback charge table
POSITIVE = {
    'ARG': {'NH1': 0.5, 'NH2': 0.5, 'NE': 0.1},
    'LYS': {'NZ': 1.0},
    'HIS': {'ND1': 0.1, 'NE2': 0.1},
}
NEGATIVE = {
    'ASP': {'OD1': -0.5, 'OD2': -0.5},
    'GLU': {'OE1': -0.5, 'OE2': -0.5},
}
BACKBONE_N = 0.1
BACKBONE_O = -0.1

# Real charges from PQR
pqr_charges = {}
if pdb2pqr_ok:
    try:
        with open(pqr_path, 'r') as f:
            for line in f:
                if not (line.startswith("ATOM") or line.startswith("HETATM")):
                    continue
                parts = line.split()
                if len(parts) < 9:
                    continue
                atom_name = parts[2]
                # PQR may have 10 or 11 fields depending on chain ID column
                try:
                    if len(parts) >= 11:
                        try:
                            chain_id = parts[4]
                            resno = int(parts[5])
                            q = float(parts[9])
                        except ValueError:
                            chain_id = ""
                            resno = int(parts[4])
                            q = float(parts[8])
                    else:
                        chain_id = ""
                        resno = int(parts[4])
                        q = float(parts[8])
                except (ValueError, IndexError):
                    continue
                if abs(q) > 0.001:
                    pqr_charges[(chain_id, resno, atom_name)] = q
    except Exception:
        pass

# Collect charged atoms
charged_atoms = []
n_pqr = 0
n_fallback = 0
for res in model.get_residues():
    if res.id[0].strip() != "": continue
    if chain_filter and res.get_parent().id != chain_filter: continue
    resname = res.resname
    for atom in res:
        q = 0.0
        aname = atom.get_name()
        chain_id_actual = res.get_parent().id
        resno_actual = int(res.id[1])
        if (chain_id_actual, resno_actual, aname) in pqr_charges:
            q = pqr_charges[(chain_id_actual, resno_actual, aname)]
            n_pqr += 1
        elif ("", resno_actual, aname) in pqr_charges:
            q = pqr_charges[("", resno_actual, aname)]
            n_pqr += 1
        elif resname in POSITIVE and aname in POSITIVE[resname]:
            q = POSITIVE[resname][aname]
            n_fallback += 1
        elif resname in NEGATIVE and aname in NEGATIVE[resname]:
            q = NEGATIVE[resname][aname]
            n_fallback += 1
        elif aname == 'N':
            q = BACKBONE_N
            n_fallback += 1
        elif aname == 'O':
            q = BACKBONE_O
            n_fallback += 1
        if abs(q) > 0.005:
            charged_atoms.append((atom, res, q))

if not charged_atoms:
    print(json.dumps({"error": "no charged atoms found"}))
    raise SystemExit

# Physical constants
e_charge = 1.602e-19
epsilon_0 = 8.854e-12
epsilon_r = 78.5
kB = 1.381e-23
T = 298.15
NA = 6.022e23
I = ${ionic} / 1000
debye = math.sqrt(epsilon_0 * epsilon_r * kB * T / (2 * NA * e_charge**2 * I * 1000)) * 1e10
k_coulomb = (e_charge**2 * NA) / (4 * math.pi * epsilon_0 * epsilon_r * 1e-10) / 1000

# Compute potential at each charged atom
results = []
for i, (atom_i, res_i, q_i) in enumerate(charged_atoms):
    coord_i = atom_i.coord
    potential = 0.0
    for j, (atom_j, res_j, q_j) in enumerate(charged_atoms):
        if i == j: continue
        r = float(atom_i - atom_j)
        if r < 1.0: r = 1.0
        potential += k_coulomb * q_i * q_j * math.exp(-r / debye) / r
    results.append({
        'chain': res_i.get_parent().id,
        'resno': int(res_i.id[1]),
        'resname': res_i.resname,
        'atom': atom_i.get_name(),
        'charge': round(q_i, 3),
        'potential_kJ_mol': round(potential, 2),
        'potential_kcal_mol': round(potential / 4.184, 2),
    })

results.sort(key=lambda x: x['potential_kJ_mol'])
potentials = [r['potential_kJ_mol'] for r in results]
total_potential = sum(potentials)
abs_pots = sorted([abs(p) for p in potentials])
median_abs = abs_pots[len(abs_pots)//2] if abs_pots else 0
surface_charged = [r for r in results if abs(r['potential_kJ_mol']) > median_abs]
print(json.dumps({
    'chain_filter': chain_filter or 'all',
    'ionic_strength_mM': ${ionic},
    'debye_length_A': round(debye, 2),
    'grid_spacing_A': ${grid},
    'forcefield': ff_name if pdb2pqr_ok else 'fallback (simple)',
    'pdb2pqr_used': pdb2pqr_ok,
    'pdb2pqr_log': pdb2pqr_log if not pdb2pqr_ok else '',
    'num_charged_atoms': len(charged_atoms),
    'num_pqr_atoms': n_pqr,
    'num_fallback_atoms': n_fallback,
    'total_potential_kJ_mol': round(total_potential, 2),
    'total_potential_kcal_mol': round(total_potential / 4.184, 2),
    'mean_potential_kJ_mol': round(sum(potentials) / len(potentials), 2),
    'mean_potential_kcal_mol': round(sum(potentials) / len(potentials) / 4.184, 2),
    'most_stabilizing': results[:5],
    'most_destabilizing': results[-5:],
    'surface_charged': surface_charged[:30],
    'all_results': results[:80],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "surface_residues",
    label: "表面残基 (Surface Residues)",
    description:
      "识别表面暴露 vs 内部 buried 残基 (基于 SASA 阈值)",
    requires: ["biopython", "freesasa"],
    params: [
      { name: "chain", type: "string", required: false, description: "链 ID（可选）" },
      { name: "threshold", type: "number", required: false, description: "SASA 阈值 (Å²)，默认 30" },
    ],
    buildScript: (inputPath, params) => {
      const chain = String(params.chain ?? "");
      const threshold = Number(params.threshold ?? 30);
      return `${RECIPE_HEADER}
import freesasa
struct = load_structure("${inputPath}")
chain_filter = "${chain}"
threshold = ${threshold}
model = next(iter(struct))
# Compute SASA
fs_struct = freesasa.Structure("${inputPath}")
result = freesasa.calc(fs_struct)
residue_areas = result.residueAreas()
surface = []
buried = []
for cid in residue_areas:
    if chain_filter and cid != chain_filter: continue
    for resno_str, area in residue_areas[cid].items():
        resno = int(resno_str)
        sasa = float(area.total)
        # Find residue name
        resname = "?"
        for res in model[cid] if cid in model else []:
            if res.id[1] == resno:
                resname = res.resname
                break
        entry = {'chain': cid, 'resno': resno, 'resname': resname, 'sasa_A2': round(sasa, 1)}
        if sasa > threshold:
            surface.append(entry)
        else:
            buried.append(entry)
surface.sort(key=lambda x: -x['sasa_A2'])
buried.sort(key=lambda x: x['sasa_A2'])
print(json.dumps({
    'threshold_A2': threshold,
    'total_residues': len(surface) + len(buried),
    'surface_count': len(surface),
    'buried_count': len(buried),
    'surface_pct': round(100 * len(surface) / max(1, len(surface) + len(buried)), 1),
    'top_surface': surface[:20],
    'top_buried': buried[:10],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "oligomer_analysis",
    label: "寡聚体分析 (Oligomer)",
    description:
      "分析组装体的寡聚状态：链数、对称性、界面数、每条链的角色",
    requires: ["biopython"],
    params: [],
    buildScript: (inputPath) => `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
model = next(iter(struct))
chains = list(model)
n_chains = len(chains)
chain_info = []
for c in chains:
    residues = [r for r in c if r.id[0].strip() == ""]
    atoms = list(c.get_atoms())
    chain_info.append({
        'chain': c.id,
        'residue_count': len(residues),
        'atom_count': len(atoms),
        'first_resno': residues[0].id[1] if residues else None,
        'last_resno': residues[-1].id[1] if residues else None,
    })
# Detect interfaces between all chain pairs
interfaces = []
for i in range(n_chains):
    for j in range(i + 1, n_chains):
        c1 = chains[i]
        c2 = chains[j]
        atoms1 = [a for a in c1.get_atoms()]
        atoms2 = [a for a in c2.get_atoms()]
        ns = NeighborSearch(atoms1 + atoms2)
        pairs = ns.search_all(5.0, level="A")
        cross = [(a, b) for (a, b) in pairs if a.get_parent().get_parent().id != b.get_parent().get_parent().id]
        if cross:
            interfaces.append({
                'chain1': c1.id,
                'chain2': c2.id,
                'contact_atoms': len(cross),
                'min_distance_A': round(float(min(a - b for a, b in cross)), 2),
            })
# Detect symmetry (simplified: check if chains have similar length)
lengths = [info['residue_count'] for info in chain_info]
is_homomer = len(set(lengths)) <= 2  # allow 1-2 distinct lengths
oligomer_type = "monomer"
if n_chains == 1: oligomer_type = "monomer"
elif n_chains == 2: oligomer_type = "homodimer" if is_homomer else "heterodimer"
elif n_chains == 3: oligomer_type = "homotrimer" if is_homomer else "heterotrimer"
elif n_chains == 4: oligomer_type = "homotetramer" if is_homomer else "heterotetramer"
elif n_chains >= 5: oligomer_type = f"homo{n_chains}mer" if is_homomer else f"hetero{n_chains}mer"
print(json.dumps({
    'n_chains': n_chains,
    'oligomer_type': oligomer_type,
    'is_homomer': is_homomer,
    'n_interfaces': len(interfaces),
    'chains': chain_info,
    'interfaces': interfaces,
}, ensure_ascii=False, indent=2))
`,
  },
  {
    id: "binding_pocket",
    label: "结合口袋 (Binding Pocket)",
    description:
      "检测配体周围的结合口袋残基 + 口袋体积估算 + 疏水性/极性分布",
    requires: ["biopython", "numpy"],
    params: [
      { name: "ligandCompId", type: "string", required: true, description: "配体 3-letter code" },
      { name: "radius", type: "number", required: false, description: "口袋半径 (Å)，默认 8" },
    ],
    buildScript: (inputPath, params) => {
      const ligandCompId = String(params.ligandCompId ?? "");
      const radius = Number(params.radius ?? 8);
      return `${RECIPE_HEADER}
from Bio.PDB import NeighborSearch
import numpy as np
struct = load_structure("${inputPath}")
ligand_id = "${ligandCompId}"
radius = ${radius}
model = next(iter(struct))
# Find ligand
ligand_residues = [r for r in model.get_residues() if r.resname == ligand_id]
if not ligand_residues:
    available = sorted(set(r.resname for r in model.get_residues() if r.id[0].strip() != "" and r.resname != "HOH"))
    print(json.dumps({"error": f"ligand {ligand_id} not found", "available": available}))
    raise SystemExit
ligand_atoms = [a for r in ligand_residues for a in r]
ligand_center = np.mean([a.coord for a in ligand_atoms], axis=0)
# Find all protein atoms within radius
all_atoms = list(model.get_atoms())
ns = NeighborSearch(all_atoms)
pocket_residues = {}
for lig_atom in ligand_atoms:
    nearby = ns.search(lig_atom.coord, radius, level="A")
    for nb in nearby:
        nb_res = nb.get_parent()
        if nb_res.resname == ligand_id or nb_res.resname == "HOH": continue
        if nb_res.id[0].strip() != "": continue
        key = (nb_res.get_parent().id, nb_res.id[1], nb_res.resname)
        if key not in pocket_residues:
            pocket_residues[key] = {'min_dist': float('inf'), 'atom_count': 0, 'atoms': []}
        d = round(float(lig_atom - nb), 2)
        pocket_residues[key]['min_dist'] = min(pocket_residues[key]['min_dist'], d)
        pocket_residues[key]['atom_count'] += 1
        pocket_residues[key]['atoms'].append({'atom': nb.get_name(), 'dist': d})
# Classify residues
HYDROPHOBIC = {'ALA', 'VAL', 'LEU', 'ILE', 'MET', 'PHE', 'TRP', 'PRO'}
POLAR = {'SER', 'THR', 'ASN', 'GLN', 'CYS', 'TYR'}
POSITIVE = {'ARG', 'LYS', 'HIS'}
NEGATIVE = {'ASP', 'GLU'}
GLYCINE = {'GLY'}
residue_list = []
counts = {'hydrophobic': 0, 'polar': 0, 'positive': 0, 'negative': 0, 'glycine': 0, 'other': 0}
for (chain, resno, resname), info in sorted(pocket_residues.items(), key=lambda x: x[1]['min_dist']):
    category = 'other'
    if resname in HYDROPHOBIC: category = 'hydrophobic'
    elif resname in POLAR: category = 'polar'
    elif resname in POSITIVE: category = 'positive'
    elif resname in NEGATIVE: category = 'negative'
    elif resname in GLYCINE: category = 'glycine'
    counts[category] += 1
    residue_list.append({
        'chain': chain, 'resno': resno, 'resname': resname,
        'min_dist_A': round(info['min_dist'], 2),
        'atom_count': info['atom_count'],
        'category': category,
    })
# Estimate pocket volume (simplified: sphere * packing fraction)
pocket_volume = round(float(4/3 * 3.14159 * radius**3 * 0.6), 1)
print(json.dumps({
    'ligand': ligand_id,
    'radius_A': radius,
    'pocket_residue_count': len(residue_list),
    'estimated_volume_A3': pocket_volume,
    'composition': counts,
    'residues': residue_list[:30],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "druggability",
    label: "可药性预测 (Druggability)",
    description:
      "评估结合口袋的可药性：基于口袋体积、疏水性比例、极性比例、电荷分布、深度/封闭度等特征，给出可药性评分和分类",
    requires: ["biopython", "numpy"],
    params: [
      { name: "ligandCompId", type: "string", required: true, description: "配体 compId (如 N3, REA, HEM)" },
      { name: "radius", type: "number", required: false, description: "口袋半径 (\u00c5)，默认 8" },
    ],
    buildScript: (inputPath, params) => {
      const ligandCompId = String(params.ligandCompId ?? "N3");
      const radius = Number(params.radius ?? 8);
      return `${RECIPE_HEADER}
import numpy as np
from Bio.PDB import NeighborSearch
struct = load_structure("${inputPath}")
ligand_id = "${ligandCompId}"
radius = ${radius}
model = next(iter(struct))
ligand_residues = [r for r in model.get_residues() if r.resname == ligand_id]
if not ligand_residues:
    available = sorted(set(r.resname for r in model.get_residues() if r.id[0].strip() != "" and r.resname != "HOH"))
    print(json.dumps({"error": "ligand not found", "available": available}))
    raise SystemExit
ligand_atoms = [a for r in ligand_residues for a in r]
ligand_center = np.mean([a.coord for a in ligand_atoms], axis=0)
all_atoms = list(model.get_atoms())
ns = NeighborSearch(all_atoms)
pocket_residues = {}
for lig_atom in ligand_atoms:
    nearby = ns.search(lig_atom.coord, radius, level="A")
    for nb in nearby:
        nb_res = nb.get_parent()
        if nb_res.resname == ligand_id or nb_res.resname == "HOH": continue
        if nb_res.id[0].strip() != "": continue
        key = (nb_res.get_parent().id, nb_res.id[1], nb_res.resname)
        if key not in pocket_residues:
            pocket_residues[key] = {"min_dist": float("inf"), "atom_count": 0}
        d = round(float(lig_atom - nb), 2)
        pocket_residues[key]["min_dist"] = min(pocket_residues[key]["min_dist"], d)
        pocket_residues[key]["atom_count"] += 1
HYDROPHOBIC = {"ALA", "VAL", "LEU", "ILE", "MET", "PHE", "TRP", "PRO"}
POLAR = {"SER", "THR", "ASN", "GLN", "CYS", "TYR"}
POSITIVE = {"ARG", "LYS", "HIS"}
NEGATIVE = {"ASP", "GLU"}
res_list = []
counts = {"hydrophobic": 0, "polar": 0, "positive": 0, "negative": 0, "glycine": 0, "other": 0}
for (chain, resno, resname), info in sorted(pocket_residues.items(), key=lambda x: x[1]["min_dist"]):
    cat = "other"
    if resname in HYDROPHOBIC: cat = "hydrophobic"
    elif resname in POLAR: cat = "polar"
    elif resname in POSITIVE: cat = "positive"
    elif resname in NEGATIVE: cat = "negative"
    elif resname == "GLY": cat = "glycine"
    counts[cat] += 1
    res_list.append({"chain": chain, "resno": resno, "resname": resname, "min_dist_A": round(info["min_dist"], 2), "category": cat})
total = len(res_list)
if total == 0:
    print(json.dumps({"error": "no pocket residues"}))
    raise SystemExit
hydro_pct = counts["hydrophobic"] / total * 100
polar_pct = counts["polar"] / total * 100
charged_pct = (counts["positive"] + counts["negative"]) / total * 100
# Grid-based volume
protein_coords = np.array([a.coord for a in all_atoms if a.get_parent().resname != ligand_id and a.get_parent().resname != "HOH"])
min_b = np.min(np.vstack([protein_coords, ligand_center]), axis=0) - 2
max_b = np.max(np.vstack([protein_coords, ligand_center]), axis=0) + 2
xs = np.arange(min_b[0], max_b[0], 1.0)
ys = np.arange(min_b[1], max_b[1], 1.0)
zs = np.arange(min_b[2], max_b[2], 1.0)
grid = np.array(np.meshgrid(xs, ys, zs, indexing="ij")).T.reshape(-1, 3)
dist_lig = np.sqrt(np.sum((grid - ligand_center)**2, axis=1))
in_pocket = dist_lig <= radius
for pc in protein_coords:
    d = np.sqrt(np.sum((grid[in_pocket] - pc)**2, axis=1))
    mask = d < 1.5
    idxs = np.where(in_pocket)[0]
    in_pocket[idxs[mask]] = False
pocket_vol = float(np.sum(in_pocket))
vol_score = max(0, min(100, 100 - abs(pocket_vol - 800) / 10))
hydro_score = max(0, 100 - abs(hydro_pct - 55) * 2)
polar_score = max(0, 100 - abs(polar_pct - 35) * 2)
depth_score = min(100, total * 5)
charge_score = min(100, charged_pct * 3)
drug_score = round(vol_score * 0.25 + hydro_score * 0.25 + polar_score * 0.15 + depth_score * 0.2 + charge_score * 0.15, 1)
if drug_score >= 70: cls = "highly_druggable"
elif drug_score >= 50: cls = "druggable"
elif drug_score >= 30: cls = "moderately_druggable"
else: cls = "difficult"
print(json.dumps({
    "ligand": ligand_id, "radius_A": radius,
    "pocket_residue_count": total, "pocket_volume_A3": pocket_vol,
    "composition": counts,
    "hydrophobic_pct": round(hydro_pct, 1), "polar_pct": round(polar_pct, 1), "charged_pct": round(charged_pct, 1),
    "druggability_score": drug_score, "classification": cls,
    "score_breakdown": {"volume": round(vol_score,1), "hydrophobicity": round(hydro_score,1), "polarity": round(polar_score,1), "depth": round(depth_score,1), "charge": round(charge_score,1)},
    "residues": res_list[:30],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "virtual_screening",
    label: "虚拟筛选 (Virtual Screening)",
    description:
      "基于结合口袋的可药性评分，对片段库进行虚拟筛选：评估形状互补、氢键、疏水匹配、电荷互补，返回按预测亲和力排序的命中列表",
    requires: ["biopython", "numpy"],
    params: [
      { name: "ligandCompId", type: "string", required: true, description: "口袋中心配体 compId" },
      { name: "radius", type: "number", required: false, description: "口袋半径 (Å)，默认 8" },
      { name: "fragment_set", type: "string", required: false, description: "片段库: druglike / fragment / natural，默认 druglike" },
    ],
    buildScript: (inputPath, params) => {
      const ligandCompId = String(params.ligandCompId ?? "");
      const radius = Number(params.radius ?? 8);
      const fragmentSet = String(params.fragment_set ?? "druglike");
      return `${RECIPE_HEADER}
import numpy as np
from Bio.PDB import NeighborSearch
import math
struct = load_structure("${inputPath}")
ligand_id = "${ligandCompId}"
radius = ${radius}
fragment_set = "${fragmentSet}"
model = next(iter(struct))
ligand_residues = [r for r in model.get_residues() if r.resname == ligand_id]
if not ligand_residues:
    available = sorted(set(r.resname for r in model.get_residues() if r.id[0].strip() != "" and r.resname != "HOH"))
    print(json.dumps({"error": "ligand not found", "available": available}))
    raise SystemExit
ligand_atoms = [a for r in ligand_residues for a in r]
ligand_center = np.mean([a.coord for a in ligand_atoms], axis=0)
all_atoms = list(model.get_atoms())
ns = NeighborSearch(all_atoms)
pocket_residues = {}
for lig_atom in ligand_atoms:
    nearby = ns.search(lig_atom.coord, radius, level="A")
    for nb in nearby:
        nb_res = nb.get_parent()
        if nb_res.resname == ligand_id or nb_res.resname == "HOH": continue
        if nb_res.id[0].strip() != "": continue
        key = (nb_res.get_parent().id, nb_res.id[1], nb_res.resname)
        if key not in pocket_residues:
            pocket_residues[key] = {"min_dist": float("inf"), "atom_count": 0}
        d = float(lig_atom - nb)
        pocket_residues[key]["min_dist"] = min(pocket_residues[key]["min_dist"], d)
        pocket_residues[key]["atom_count"] += 1
HYDROPHOBIC = {"ALA", "VAL", "LEU", "ILE", "MET", "PHE", "TRP", "PRO"}
POLAR = {"SER", "THR", "ASN", "GLN", "CYS", "TYR"}
POSITIVE = {"ARG", "LYS", "HIS"}
NEGATIVE = {"ASP", "GLU"}
counts = {"hydrophobic": 0, "polar": 0, "positive": 0, "negative": 0, "glycine": 0, "other": 0}
for (chain, resno, resname), info in pocket_residues.items():
    cat = "other"
    if resname in HYDROPHOBIC: cat = "hydrophobic"
    elif resname in POLAR: cat = "polar"
    elif resname in POSITIVE: cat = "positive"
    elif resname in NEGATIVE: cat = "negative"
    elif resname == "GLY": cat = "glycine"
    counts[cat] += 1
total = sum(counts.values())
if total == 0:
    print(json.dumps({"error": "no pocket residues"}))
    raise SystemExit
hydro_pct = counts["hydrophobic"] / total * 100
polar_pct = counts["polar"] / total * 100
charged_pct = (counts["positive"] + counts["negative"]) / total * 100
protein_coords = np.array([a.coord for a in all_atoms if a.get_parent().resname != ligand_id and a.get_parent().resname != "HOH"])
min_b = np.min(np.vstack([protein_coords, ligand_center]), axis=0) - 2
max_b = np.max(np.vstack([protein_coords, ligand_center]), axis=0) + 2
xs = np.arange(min_b[0], max_b[0], 1.0)
ys = np.arange(min_b[1], max_b[1], 1.0)
zs = np.arange(min_b[2], max_b[2], 1.0)
grid = np.array(np.meshgrid(xs, ys, zs, indexing="ij")).T.reshape(-1, 3)
dist_lig = np.sqrt(np.sum((grid - ligand_center)**2, axis=1))
in_pocket = dist_lig <= radius
for pc in protein_coords:
    d = np.sqrt(np.sum((grid[in_pocket] - pc)**2, axis=1))
    mask = d < 1.5
    idxs = np.where(in_pocket)[0]
    in_pocket[idxs[mask]] = False
pocket_vol = float(np.sum(in_pocket))
vol_score = max(0, min(100, 100 - abs(pocket_vol - 800) / 10))
hydro_score = max(0, 100 - abs(hydro_pct - 55) * 2)
polar_score = max(0, 100 - abs(polar_pct - 35) * 2)
depth_score = min(100, total * 5)
charge_score = min(100, charged_pct * 3)
pocket_score = round(vol_score * 0.25 + hydro_score * 0.25 + polar_score * 0.15 + depth_score * 0.2 + charge_score * 0.15, 1)
FRAGMENT_LIBRARIES = {
    "druglike": [
        {"name": "Benzamidine", "smiles": "NC(=N)c1ccccc1", "mw": 136.15, "logp": 1.4, "hbd": 1, "hba": 1, "charge": 1},
        {"name": "Imidazole", "smiles": "c1[nH]cnc1", "mw": 68.08, "logp": -0.1, "hbd": 1, "hba": 1, "charge": 0},
        {"name": "Indole", "smiles": "c1ccc2[nH]ccc2c1", "mw": 117.15, "logp": 2.1, "hbd": 1, "hba": 0, "charge": 0},
        {"name": "Benzimidazole", "smiles": "c1ccc2[nH]cnc2c1", "mw": 118.14, "logp": 1.4, "hbd": 1, "hba": 1, "charge": 0},
        {"name": "Purine", "smiles": "c1nc2nc[nH]c2n1", "mw": 120.11, "logp": -0.3, "hbd": 1, "hba": 3, "charge": 0},
        {"name": "Pyrimidine", "smiles": "c1cncnc1", "mw": 80.09, "logp": -0.4, "hbd": 0, "hba": 2, "charge": 0},
        {"name": "Naphthalene", "smiles": "c1ccc2ccccc2c1", "mw": 128.17, "logp": 3.3, "hbd": 0, "hba": 0, "charge": 0},
        {"name": "Quinoline", "smiles": "c1ccc2ncccc2c1", "mw": 129.16, "logp": 2.0, "hbd": 0, "hba": 1, "charge": 0},
        {"name": "Acetamide", "smiles": "CC(=O)N", "mw": 59.07, "logp": -1.0, "hbd": 1, "hba": 1, "charge": 0},
        {"name": "Guanidine", "smiles": "NC(=N)N", "mw": 59.07, "logp": -1.3, "hbd": 2, "hba": 1, "charge": 1},
        {"name": "Sulfonamide", "smiles": "NS(=O)(=O)C", "mw": 95.12, "logp": -1.0, "hbd": 1, "hba": 2, "charge": 0},
        {"name": "Carboxylate", "smiles": "CC(=O)[O-]", "mw": 59.04, "logp": -0.5, "hbd": 0, "hba": 2, "charge": -1},
    ],
    "fragment": [
        {"name": "Benzene", "smiles": "c1ccccc1", "mw": 78.11, "logp": 2.0, "hbd": 0, "hba": 0, "charge": 0},
        {"name": "Phenol", "smiles": "c1ccc(O)cc1", "mw": 94.11, "logp": 1.5, "hbd": 1, "hba": 1, "charge": 0},
        {"name": "Aniline", "smiles": "c1ccc(N)cc1", "mw": 93.13, "logp": 0.9, "hbd": 1, "hba": 1, "charge": 0},
        {"name": "Pyridine", "smiles": "c1ccncc1", "mw": 79.10, "logp": 0.6, "hbd": 0, "hba": 1, "charge": 0},
        {"name": "Furan", "smiles": "c1ccoc1", "mw": 68.07, "logp": 1.3, "hbd": 0, "hba": 1, "charge": 0},
        {"name": "Thiophene", "smiles": "c1ccsc1", "mw": 84.14, "logp": 1.8, "hbd": 0, "hba": 0, "charge": 0},
        {"name": "Imidazole", "smiles": "c1[nH]cnc1", "mw": 68.08, "logp": -0.1, "hbd": 1, "hba": 1, "charge": 0},
        {"name": "Cyclohexane", "smiles": "C1CCCCC1", "mw": 84.16, "logp": 3.0, "hbd": 0, "hba": 0, "charge": 0},
    ],
    "natural": [
        {"name": "Adenine", "smiles": "c1nc2ncnc2[nH]1", "mw": 135.13, "logp": -0.5, "hbd": 2, "hba": 3, "charge": 0},
        {"name": "Guanine", "smiles": "c1nc2nc(nc2[nH]1)N", "mw": 151.13, "logp": -1.0, "hbd": 2, "hba": 3, "charge": 0},
        {"name": "Cytosine", "smiles": "c1cc(NC(=O)N)[nH]1", "mw": 111.10, "logp": -1.7, "hbd": 2, "hba": 2, "charge": 0},
        {"name": "Uracil", "smiles": "c1cc(NC(=O)NC1=O)", "mw": 112.09, "logp": -1.0, "hbd": 2, "hba": 2, "charge": 0},
        {"name": "Thymine", "smiles": "Cc1cc(NC(=O)NC1=O)", "mw": 126.11, "logp": -0.5, "hbd": 2, "hba": 2, "charge": 0},
        {"name": "Trp_sidechain", "smiles": "c1ccc2c(c1)c(c[nH]2)CC", "mw": 144.18, "logp": 2.5, "hbd": 1, "hba": 0, "charge": 0},
        {"name": "Tyr_sidechain", "smiles": "c1ccc(O)cc1CC", "mw": 122.17, "logp": 1.9, "hbd": 1, "hba": 1, "charge": 0},
        {"name": "His_sidechain", "smiles": "CC1C=NC=N1", "mw": 96.13, "logp": 0.5, "hbd": 1, "hba": 2, "charge": 0},
    ],
}
fragments = FRAGMENT_LIBRARIES.get(fragment_set, FRAGMENT_LIBRARIES["druglike"])
RT = 0.593
hits = []
for frag in fragments:
    frag_vol_est = frag["mw"] * 1.5
    shape_match = max(0, 1 - abs(pocket_vol - frag_vol_est * 10) / 1000)
    delta_g_shape = -2.0 * shape_match
    hbond_capacity = min(frag["hbd"] + frag["hba"], int(polar_pct / 10) + 2)
    delta_g_hbond = -0.8 * hbond_capacity
    hydro_match = (hydro_pct / 100) * min(2.0, max(0, frag["logp"]))
    delta_g_hydrophobic = -1.5 * hydro_match
    frag_charge = frag.get("charge", 0)
    delta_g_charge = 0
    if frag_charge > 0 and charged_pct > 0:
        neg_pct = counts["negative"] / total * 100
        delta_g_charge = -1.5 * min(1.0, neg_pct / 20)
    elif frag_charge < 0 and charged_pct > 0:
        pos_pct = counts["positive"] / total * 100
        delta_g_charge = -1.5 * min(1.0, pos_pct / 20)
    elif frag_charge == 0 and charged_pct > 10:
        delta_g_charge = +0.3
    delta_g_desolv = +0.4 * (frag["hbd"] + frag["hba"])
    lipinski_violations = 0
    if frag["mw"] > 500: lipinski_violations += 1
    if frag["logp"] > 5: lipinski_violations += 1
    if frag["hbd"] > 5: lipinski_violations += 1
    if frag["hba"] > 10: lipinski_violations += 1
    delta_g_lipinski = +0.5 * lipinski_violations
    delta_g = delta_g_shape + delta_g_hbond + delta_g_hydrophobic + delta_g_charge + delta_g_desolv + delta_g_lipinski
    ki_M = math.exp(delta_g / RT)
    ki_uM = round(ki_M * 1e6, 3)
    score = round(-delta_g, 2)
    rationale_parts = []
    if delta_g_shape < -1: rationale_parts.append(f"形状匹配好 ({shape_match:.2f})")
    if delta_g_hbond < -1: rationale_parts.append(f"{hbond_capacity} 个氢键")
    if delta_g_hydrophobic < -0.5: rationale_parts.append(f"疏水互补 (logP={frag['logp']})")
    if delta_g_charge < -0.5: rationale_parts.append("电荷互补")
    if delta_g_desolv > 1: rationale_parts.append("去溶剂化代价较高")
    if not rationale_parts: rationale_parts.append("一般结合")
    hits.append({
        "name": frag["name"], "smiles": frag["smiles"], "mw": frag["mw"], "logp": frag["logp"],
        "hbond_donors": frag["hbd"], "hbond_acceptors": frag["hba"],
        "affinity_kcal_mol": round(delta_g, 2), "ki_uM": ki_uM, "score": score,
        "rationale": "; ".join(rationale_parts),
    })
hits.sort(key=lambda h: -h["score"])
print(json.dumps({
    "ligand": ligand_id, "radius_A": radius, "fragment_set": fragment_set,
    "pocket_score": pocket_score, "pocket_composition": counts, "pocket_volume_A3": pocket_vol,
    "hydrophobic_pct": round(hydro_pct, 1), "polar_pct": round(polar_pct, 1), "charged_pct": round(charged_pct, 1),
    "num_fragments_screened": len(fragments), "ranked_hits": hits,
    "top_hit": hits[0] if hits else None,
    "best_affinity_kcal_mol": hits[0]["affinity_kcal_mol"] if hits else 0,
    "best_ki_uM": hits[0]["ki_uM"] if hits else 0,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "per_residue_rmsd_two",
    label: "跨结构逐残基 RMSD",
    description:
      "计算两个独立 PDB 结构之间（Kabsch 叠合后）的逐残基 Cα 偏差，返回每个残基的 RMSD 值用于热图可视化。需要通过 fileContent + fileContent2 提供两个结构。",
    requires: ["biopython", "numpy"],
    params: [
      { name: "chain1", type: "string", required: false, description: "结构 1 链 ID，默认 A" },
      { name: "chain2", type: "string", required: false, description: "结构 2 链 ID，默认 A" },
    ],
    buildScript: (inputPath, params) => {
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "A");
      const secondPath = String((params as any).__secondPath__ ?? "");
      return `${RECIPE_HEADER}
import math
import numpy as np
from Bio.PDB import PDBParser, MMCIFParser
path1 = "${inputPath}"
path2 = "${secondPath}"
chain1_id = "${chain1}"
chain2_id = "${chain2}"
if not path2 or path2 == "":
    print(json.dumps({"error": "second structure fileContent2 is required"}))
    raise SystemExit
def parse_structure(path, name="s"):
    fmt = path.rsplit('.', 1)[-1].lower()
    if fmt == 'cif':
        parser = MMCIFParser(QUIET=True)
    else:
        parser = PDBParser(QUIET=True)
    return parser.get_structure(name, path)
struct1 = parse_structure(path1, "s1")
struct2 = parse_structure(path2, "s2")
model1 = next(iter(struct1))
model2 = next(iter(struct2))
if chain1_id not in model1:
    print(json.dumps({"error": f"chain {chain1_id} not in structure 1", "available": [c.id for c in model1]}))
    raise SystemExit
if chain2_id not in model2:
    print(json.dumps({"error": f"chain {chain2_id} not in structure 2", "available": [c.id for c in model2]}))
    raise SystemExit
ca1 = {}
for res in model1[chain1_id]:
    if res.id[0].strip() != "": continue
    if "CA" in res:
        ca1[res.id[1]] = res["CA"]
ca2 = {}
for res in model2[chain2_id]:
    if res.id[0].strip() != "": continue
    if "CA" in res:
        ca2[res.id[1]] = res["CA"]
common = sorted(set(ca1.keys()) & set(ca2.keys()))
if len(common) < 3:
    print(json.dumps({"error": f"only {len(common)} common residues", "struct1_residues": len(ca1), "struct2_residues": len(ca2)}))
    raise SystemExit
P = np.array([ca1[r].coord for r in common], dtype=float)
Q = np.array([ca2[r].coord for r in common], dtype=float)
P_c = P - P.mean(axis=0)
Q_c = Q - Q.mean(axis=0)
H = P_c.T @ Q_c
U, S, Vt = np.linalg.svd(H)
d = np.sign(np.linalg.det(Vt.T @ U.T))
D = np.diag([1, 1, d])
R = Vt.T @ D @ U.T
P_rot = P_c @ R.T
diff = P_rot - Q_c
per_residue = []
for i, resno in enumerate(common):
    dev = float(np.sqrt(np.sum(diff[i] * diff[i])))
    per_residue.append({"resno": int(resno), "rmsd": round(dev, 3)})
rmsd_aligned = math.sqrt(np.sum(diff * diff) / len(common))
raw_diff = P - Q
rmsd_raw = math.sqrt(np.sum(raw_diff * raw_diff) / len(common))
L = len(common)
d0 = 1.24 * (max(L, 19) - 15) ** (1/3) - 1.8
if d0 < 0.5: d0 = 0.5
tm_sum = sum(1.0 / (1.0 + (np.sqrt(np.sum(diff[i]*diff[i]))/d0)**2) for i in range(L))
tm_score = tm_sum / L
rmsds = [r["rmsd"] for r in per_residue]
mean_r = sum(rmsds) / len(rmsds)
max_r = max(rmsds)
high_var = [r for r in per_residue if r["rmsd"] > 3.0]
print(json.dumps({
    "struct1": path1.rsplit("/", 1)[-1], "struct2": path2.rsplit("/", 1)[-1],
    "chain1": chain1_id, "chain2": chain2_id,
    "common_residues": len(common), "struct1_total": len(ca1), "struct2_total": len(ca2),
    "rmsd_raw_A": round(float(rmsd_raw), 3), "rmsd_aligned_A": round(float(rmsd_aligned), 3),
    "tm_score": round(float(tm_score), 3),
    "mean_per_residue": round(mean_r, 3), "max_per_residue": round(max_r, 3),
    "high_variation_count": len(high_var),
    "per_residue": per_residue, "high_variation_residues": high_var[:20],
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "detect_pockets",
    label: "多口袋检测 (Multi-Pocket Detection)",
    description:
      "自动检测蛋白表面的所有结合口袋：使用网格法扫描蛋白质表面凹陷区域，计算每个口袋的体积、深度、残基组成和可药性评分",
    requires: ["biopython", "numpy"],
    params: [
      { name: "grid_spacing", type: "number", required: false, description: "网格间距 (Å)，默认 1.5" },
      { name: "probe_radius", type: "number", required: false, description: "探针半径 (Å)，默认 1.4" },
      { name: "min_volume", type: "number", required: false, description: "最小口袋体积 (Å³)，默认 100" },
    ],
    buildScript: (inputPath, params) => {
      const gridSpacing = Number(params.grid_spacing ?? 1.5);
      const probeRadius = Number(params.probe_radius ?? 1.4);
      const minVolume = Number(params.min_volume ?? 100);
      return `${RECIPE_HEADER}
import numpy as np
from Bio.PDB import NeighborSearch
from scipy.ndimage import label
struct = load_structure("${inputPath}")
grid_spacing = ${gridSpacing}
probe_radius = ${probeRadius}
min_volume = ${minVolume}
model = next(iter(struct))
all_atoms = list(model.get_atoms())
protein_atoms = [a for a in all_atoms if a.get_parent().id[0].strip() == "" and a.get_parent().resname != "HOH"]
protein_coords = np.array([a.coord for a in protein_atoms])
# Build bounding box
min_b = np.min(protein_coords, axis=0) - probe_radius - 2
max_b = np.max(protein_coords, axis=0) + probe_radius + 2
# Create grid
xs = np.arange(min_b[0], max_b[0], grid_spacing)
ys = np.arange(min_b[1], max_b[1], grid_spacing)
zs = np.arange(min_b[2], max_b[2], grid_spacing)
gx, gy, gz = np.meshgrid(xs, ys, zs, indexing="ij")
grid_points = np.column_stack([gx.ravel(), gy.ravel(), gz.ravel()])
# Mark grid points that are inside protein (within probe_radius of any atom)
# Use KD-tree for efficiency
from scipy.spatial import cKDTree
tree = cKDTree(protein_coords)
distances, _ = tree.query(grid_points, k=1)
inside_protein = distances < probe_radius
outside_protein = ~inside_protein
# Find surface-accessible grid points (outside protein but near surface)
near_surface = (distances >= probe_radius) & (distances < probe_radius + 3.0)
# Among surface points, find those in concave regions (pockets)
# A point is in a pocket if many of its neighbors are inside the protein
# Use a local density approach: count protein atoms within 5Å
nearby_protein_count = tree.query_ball_point(grid_points[near_surface], 5.0, return_length=True)
# Pocket points: surface points with high nearby protein count (concave)
pocket_mask = np.zeros(len(grid_points), dtype=bool)
surface_indices = np.where(near_surface)[0]
for idx in surface_indices:
    count = nearby_protein_count[np.where(surface_indices == idx)[0][0]] if len(nearby_protein_count) > 0 else 0
    if count >= 8:  # at least 8 protein atoms within 5Å = concave
        pocket_mask[idx] = True
# Cluster pocket points into individual pockets using connected components
# Reshape to 3D grid for labeling
grid_shape = (len(xs), len(ys), len(zs))
pocket_3d = pocket_mask.reshape(grid_shape)
labeled_array, num_features = label(pocket_3d)
# Extract pocket info
pockets = []
HYDROPHOBIC = {"ALA", "VAL", "LEU", "ILE", "MET", "PHE", "TRP", "PRO"}
POLAR = {"SER", "THR", "ASN", "GLN", "CYS", "TYR"}
POSITIVE = {"ARG", "LYS", "HIS"}
NEGATIVE = {"ASP", "GLU"}
ns = NeighborSearch(protein_atoms)
for pocket_id in range(1, num_features + 1):
    pocket_indices = np.where(labeled_array == pocket_id)
    if len(pocket_indices[0]) == 0: continue
    # Convert grid indices to coordinates
    pocket_coords = np.array([
        [xs[i], ys[j], zs[k]] for i, j, k in zip(*pocket_indices)
    ])
    volume = len(pocket_coords) * (grid_spacing ** 3)
    if volume < min_volume: continue
    center = np.mean(pocket_coords, axis=0)
    # Depth = max distance from center to any pocket point
    depths = np.sqrt(np.sum((pocket_coords - center)**2, axis=1))
    depth = float(np.max(depths))
    # Find residues near this pocket
    pocket_residues = {}
    for pc in pocket_coords[::3]:  # sample every 3rd point for speed
        nearby = ns.search(pc, 4.0, level="R")
        for nb_res in nearby:
            if nb_res.id[0].strip() != "": continue
            key = (nb_res.get_parent().id, nb_res.id[1], nb_res.resname)
            if key not in pocket_residues:
                pocket_residues[key] = float("inf")
            d = float(np.sqrt(np.sum((pc - np.array([a.coord for a in nb_res if True][0:1]))**2))) if len(list(nb_res)) > 0 else 99
            pocket_residues[key] = min(pocket_residues[key], d)
    counts = {"hydrophobic": 0, "polar": 0, "positive": 0, "negative": 0, "glycine": 0, "other": 0}
    top_residues = []
    for (chain, resno, resname), dist in sorted(pocket_residues.items(), key=lambda x: x[1])[:15]:
        cat = "other"
        if resname in HYDROPHOBIC: cat = "hydrophobic"
        elif resname in POLAR: cat = "polar"
        elif resname in POSITIVE: cat = "positive"
        elif resname in NEGATIVE: cat = "negative"
        elif resname == "GLY": cat = "glycine"
        counts[cat] += 1
        top_residues.append({"chain": chain, "resno": int(resno), "resname": resname})
    total_res = sum(counts.values())
    if total_res == 0: continue
    hydro_pct = counts["hydrophobic"] / total_res * 100
    polar_pct = counts["polar"] / total_res * 100
    charged_pct = (counts["positive"] + counts["negative"]) / total_res * 100
    vol_score = max(0, min(100, 100 - abs(volume - 800) / 10))
    hydro_score = max(0, 100 - abs(hydro_pct - 55) * 2)
    polar_score = max(0, 100 - abs(polar_pct - 35) * 2)
    depth_score = min(100, total_res * 5)
    charge_score = min(100, charged_pct * 3)
    drug_score = round(vol_score * 0.25 + hydro_score * 0.25 + polar_score * 0.15 + depth_score * 0.2 + charge_score * 0.15, 1)
    if drug_score >= 70: cls = "highly_druggable"
    elif drug_score >= 50: cls = "druggable"
    elif drug_score >= 30: cls = "moderately_druggable"
    else: cls = "difficult"
    pockets.append({
        "id": len(pockets) + 1,
        "center": [round(float(center[0]), 1), round(float(center[1]), 1), round(float(center[2]), 1)],
        "volume": round(volume, 1),
        "depth": round(depth, 1),
        "druggability_score": drug_score,
        "classification": cls,
        "residue_count": total_res,
        "composition": counts,
        "top_residues": top_residues[:10],
    })
# Sort by druggability score
pockets.sort(key=lambda p: -p["druggability_score"])
# Renumber
for i, p in enumerate(pockets):
    p["id"] = i + 1
print(json.dumps({
    "num_pockets": len(pockets),
    "grid_spacing": grid_spacing,
    "probe_radius": probe_radius,
    "pockets": pockets[:10],
    "top_pocket": pockets[0] if pockets else None,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "entity_analysis",
    label: "实体信息提取 (Entity Analysis)",
    description:
      "从 mmCIF 文件中提取完整的实体信息：链-实体映射、描述、来源生物、基因、突变、片段、EC号、配体名称，用于关联自然语言描述与结构中的实体",
    requires: ["biopython"],
    params: [],
    buildScript: (inputPath) => `${RECIPE_HEADER}
from Bio.PDB.MMCIFParser import MMCIFParser
from Bio.PDB.PDBParser import PDBParser
import os

path = "${inputPath}"
fmt = os.path.splitext(path)[1].lower().lstrip('.')

entities = {}
chain_entity_map = {}

if fmt == 'cif':
    # Parse mmCIF directly to extract entity info
    from Bio.PDB.MMCIF2Dict import MMCIF2Dict
    try:
        d = MMCIF2Dict(path)
        # Entity descriptions
        ent_ids = d.get('_entity.id', [])
        ent_types = d.get('_entity.type', [])
        ent_descs = d.get('_entity.pdbx_description', [])
        ent_methods = d.get('_entity.src_method', [])
        ent_ec = d.get('_entity.pdbx_ec', [])
        ent_mut = d.get('_entity.pdbx_mutation', [])
        ent_frag = d.get('_entity.pdbx_fragment', [])

        # Polymer strand mapping
        poly_strands = d.get('_entity_poly.pdbx_strand_id', [])
        poly_types = d.get('_entity_poly.type', [])
        poly_seqs = d.get('_entity_poly.pdbx_seq_one_letter_code_can', [])

        # Nonpolymer info
        np_ids = d.get('_pdbx_entity_nonpoly.entity_id', [])
        np_names = d.get('_pdbx_entity_nonpoly.name', [])
        np_comps = d.get('_pdbx_entity_nonpoly.comp_id', [])

        # Source organism info
        src_ents = d.get('_entity_src_gen.entity_id', [])
        src_sci = d.get('_entity_src_gen.pdbx_gene_src_scientific_name', [])
        src_gene = d.get('_entity_src_gen.pdbx_gene_src_gene', [])
        src_tax = d.get('_entity_src_gen.pdbx_gene_src_ncbi_taxonomy_id', [])
        host_sci = d.get('_entity_src_gen.pdbx_host_org_scientific_name', [])

        # Struct ref (UniProt / PDB cross-refs)
        ref_ents = d.get('_struct_ref.entity_id', [])
        ref_types = d.get('_struct_ref.pdbx_db_name', [])
        ref_codes = d.get('_struct_ref.pdbx_db_code', [])
        ref_beg = d.get('_struct_ref.pdbx_seq_one_letter_code', [])

        for i, eid in enumerate(ent_ids):
            ent = {
                'entity_id': eid,
                'type': ent_types[i] if i < len(ent_types) else '?',
                'description': ent_descs[i] if i < len(ent_descs) else '?',
                'source_method': ent_methods[i] if i < len(ent_methods) else '?',
                'ec_number': ent_ec[i] if i < len(ent_ec) and ent_ec[i] != '?' else None,
                'mutation': ent_mut[i] if i < len(ent_mut) and ent_mut[i] != '?' else None,
                'fragment': ent_frag[i] if i < len(ent_frag) and ent_frag[i] != '?' else None,
            }
            # Add polymer info
            poly_ent_ids = d.get('_entity_poly.entity_id', [])
            for j, peid in enumerate(poly_ent_ids):
                if str(peid) == str(eid):
                    ps = poly_strands[j] if j < len(poly_strands) else ''
                    ent['polymer_type'] = poly_types[j] if j < len(poly_types) else None
                    seq = poly_seqs[j] if j < len(poly_seqs) else ''
                    ent['sequence'] = seq[:100] + ('...' if len(seq) > 100 else '')
                    ent['sequence_length'] = len(seq)
                    # Map chains — pdbx_strand_id contains auth chain IDs
                    if ps:
                        for ch in ps.split(','):
                            ch = ch.strip()
                            if ch:
                                chain_entity_map[ch] = eid
                    break
            # Add nonpolymer info
            for j, nid in enumerate(np_ids):
                if str(nid) == str(eid):
                    ent['comp_id'] = np_comps[j] if j < len(np_comps) else '?'
                    ent['ligand_name'] = np_names[j] if j < len(np_names) else '?'
                    break
            # Add source organism
            for j, se in enumerate(src_ents):
                if str(se) == str(eid):
                    ent['gene_source_organism'] = src_sci[j] if j < len(src_sci) and src_sci[j] != '?' else None
                    ent['gene'] = src_gene[j] if j < len(src_gene) and src_gene[j] != '?' else None
                    ent['taxonomy_id'] = src_tax[j] if j < len(src_tax) and src_tax[j] != '?' else None
                    ent['expression_host'] = host_sci[j] if j < len(host_sci) and host_sci[j] != '?' else None
                    break
            # Add UniProt / database cross-refs
            for j, re in enumerate(ref_ents):
                if str(re) == str(eid):
                    db = ref_types[j] if j < len(ref_types) else '?'
                    code = ref_codes[j] if j < len(ref_codes) else '?'
                    ent.setdefault('cross_refs', []).append({'database': db, 'id': code})
            entities[eid] = ent
    except Exception as e:
        # Fallback to basic structure parsing
        struct = load_structure(path)
        model = next(iter(struct))
        for ch in model:
            residues = [r for r in ch if r.id[0].strip() == '']
            entities[ch.id] = {
                'entity_id': ch.id,
                'type': 'polymer',
                'description': 'Unknown (no entity info in file)',
                'chains': [ch.id],
                'sequence_length': len(residues),
                'note': 'Entity info not available in this file format'
            }
            chain_entity_map[ch.id] = ch.id
else:
    # PDB format — limited entity info
    struct = load_structure(path)
    model = next(iter(struct))
    for ch in model:
        residues = [r for r in ch if r.id[0].strip() == '']
        # Try to get HEADER/TITLE
        header = ''
        try:
            header = struct.header.get('head', '')
        except:
            pass
        entities[ch.id] = {
            'entity_id': ch.id,
            'type': 'polymer',
            'description': f'Chain {ch.id} ({len(residues)} residues)',
            'chains': [ch.id],
            'sequence_length': len(residues),
            'header': header,
            'note': 'PDB format has limited entity info. Use mmCIF for full entity details.'
        }
        chain_entity_map[ch.id] = ch.id

# Build chain summary
chain_summary = {}
struct = load_structure(path)
model = next(iter(struct))
for ch in model:
    residues = [r for r in ch if r.id[0].strip() == '']
    het_res = [r for r in ch if r.id[0].strip() != '' and r.resname != 'HOH']
    eid = chain_entity_map.get(ch.id, '?')
    ent = entities.get(eid, {})
    chain_summary[ch.id] = {
        'chain_id': ch.id,
        'entity_id': eid,
        'description': ent.get('description', 'Unknown'),
        'type': ent.get('type', 'polymer'),
        'residue_count': len(residues),
        'has_ligands': len(het_res) > 0,
        'ligands': list(set(r.resname for r in het_res)) if het_res else [],
    }

# Sort entities by ID
sorted_entities = [entities[k] for k in sorted(entities.keys(), key=lambda x: str(x))]

print(json.dumps({
    'file_format': fmt,
    'total_entities': len(entities),
    'chain_entity_map': chain_entity_map,
    'entities': sorted_entities,
    'chains': chain_summary,
    'has_entity_info': fmt == 'cif',
}, ensure_ascii=False, indent=2))
`,
  },
  {
    id: "blast_chain_id",
    label: "BLAST 链鉴定 (Chain Identification)",
    description:
      "对每条链的序列进行 BLAST 搜索，鉴定蛋白身份（当 mmCIF 中缺少实体信息时使用）。注意：需要网络连接到 NCBI，可能较慢。",
    requires: ["biopython"],
    params: [
      { name: "chain", type: "string", required: false, description: "链 ID（可选，默认全部链）" },
      { name: "evalue", type: "number", required: false, description: "E-value 阈值，默认 0.001" },
    ],
    buildScript: (inputPath, params) => {
      const chainFilter = String(params.chain ?? "");
      const evalue = Number(params.evalue ?? 0.001);
      return `${RECIPE_HEADER}
from Bio.PDB import PPBuilder
from Bio.SeqUtils import seq1
from Bio.Blast import NCBIWWW
import time

struct = load_structure("${inputPath}")
chain_filter = "${chainFilter}"
evalue_threshold = ${evalue}
model = next(iter(struct))
ppb = PPBuilder()

def get_sequence(chain):
    for pp in ppb.build_peptides(chain):
        return "".join(seq1(r.resname) for r in pp)
    return ""

results = []
for ch in model:
    if chain_filter and ch.id != chain_filter:
        continue
    residues = [r for r in ch if r.id[0].strip() == ""]
    if len(residues) < 10:
        continue
    seq = get_sequence(ch)
    if not seq or len(seq) < 10:
        continue

    # Run BLAST
    try:
        blast_result = NCBIWWW.qblast("blastp", "nr", seq, expect=evalue_threshold, hitlist_size=5, format_type="XML")
        from Bio.Blast import NCBIXML
        blast_records = NCBIXML.parse(blast_result)
        hits = []
        for record in blast_records:
            for alignment in record.alignments[:3]:
                hit_title = alignment.title
                hit_accession = alignment.accession
                for hsp in alignment.hsps[:1]:
                    hits.append({
                        'title': hit_title,
                        'accession': hit_accession,
                        'evalue': hsp.expect,
                        'identity_pct': round(100 * hsp.identities / hsp.align_length, 1) if hsp.align_length > 0 else 0,
                        'align_length': hsp.align_length,
                    })
        results.append({
            'chain': ch.id,
            'sequence_length': len(seq),
            'sequence_preview': seq[:50] + '...' if len(seq) > 50 else seq,
            'top_hits': hits,
            'best_match': hits[0]['title'] if hits else 'No significant hit',
            'best_evalue': hits[0]['evalue'] if hits else None,
        })
    except Exception as e:
        results.append({
            'chain': ch.id,
            'sequence_length': len(seq),
            'error': str(e)[:200],
            'note': 'BLAST search failed (may need network access)'
        })
    time.sleep(1)  # Rate limit

print(json.dumps({
    'chains_analyzed': len(results),
    'evalue_threshold': evalue_threshold,
    'results': results,
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "align_and_superpose",
    label: "结构比对并叠合 (CE-like Alignment)",
    description:
      "下载两个 PDB，用序列比对匹配残基，做 Kabsch 最优叠合，输出旋转矩阵+RMSD+匹配残基数。用于替换 Molstar 不可用的 tm-align/superpose。",
    requires: ["biopython", "numpy"],
    params: [
      { name: "pdbId1", type: "string", required: true, description: "PDB ID 1 (参考)" },
      { name: "pdbId2", type: "string", required: true, description: "PDB ID 2 (移动)" },
      { name: "chain1", type: "string", required: false, description: "链 ID 1 (默认 A)" },
      { name: "chain2", type: "string", required: false, description: "链 ID 2 (默认 A)" },
    ],
    buildScript: (_inputPath, params) => {
      const pdbId1 = String(params.pdbId1 ?? "");
      const pdbId2 = String(params.pdbId2 ?? "");
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "A");
      return `
import json, math, os, urllib.request
import numpy as np
from Bio import pairwise2
from Bio.PDB import PDBParser, MMCIFParser, PPBuilder
from Bio.SeqUtils import seq1

pdb1 = "${pdbId1}".lower()
pdb2 = "${pdbId2}".lower()
chain1_id = "${chain1}"
chain2_id = "${chain2}"
cache_dir = "/tmp/molcraft-analysis/pdb"
os.makedirs(cache_dir, exist_ok=True)

def download(pdb_id):
    pdb_path = os.path.join(cache_dir, pdb_id + ".pdb")
    cif_path = os.path.join(cache_dir, pdb_id + ".cif")
    if os.path.exists(pdb_path): return pdb_path, "pdb"
    if os.path.exists(cif_path): return cif_path, "cif"
    try:
        urllib.request.urlretrieve(f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb", pdb_path)
        if os.path.getsize(pdb_path) > 100: return pdb_path, "pdb"
    except: pass
    try:
        urllib.request.urlretrieve(f"https://files.rcsb.org/download/{pdb_id.upper()}.cif", cif_path)
        return cif_path, "cif"
    except Exception as e:
        return None, str(e)

def get_ca_and_seq(pdb_id, chain_id):
    path, fmt = download(pdb_id)
    if not path: return None, None, None, f"download failed: {fmt}"
    parser = MMCIFParser(QUIET=True) if fmt == "cif" else PDBParser(QUIET=True)
    struct = parser.get_structure("s", path)
    model = next(iter(struct))
    if chain_id not in model: return None, None, None, f"chain {chain_id} not found"
    ppb = PPBuilder()
    seq = ""
    for pp in ppb.build_peptides(model[chain_id]):
        seq = "".join(seq1(r.resname) for r in pp)
        break
    ca_by_resno = {}
    for res in model[chain_id]:
        if res.id[0].strip() != "": continue
        if "CA" in res: ca_by_resno[res.id[1]] = res["CA"]
    return seq, ca_by_resno, model[chain_id], None

seq1_str, ca1, chain1_obj, err1 = get_ca_and_seq(pdb1, chain1_id)
if err1: print(json.dumps({"error": err1})); raise SystemExit
seq2_str, ca2, chain2_obj, err2 = get_ca_and_seq(pdb2, chain2_id)
if err2: print(json.dumps({"error": err2})); raise SystemExit

# Sequence alignment
alignments = pairwise2.align.globalms(seq1_str, seq2_str, 2, -1, -2, -0.5, one_alignment_only=True)
if not alignments: print(json.dumps({"error": "alignment failed"})); raise SystemExit
aln = alignments[0]

# Match CA atoms by alignment position
resnos1 = sorted(ca1.keys())
resnos2 = sorted(ca2.keys())
matched_pairs = []
i1 = 0; i2 = 0
for a, b in zip(aln.seqA, aln.seqB):
    r1 = None; r2 = None
    if a != "-":
        if i1 < len(resnos1): r1 = resnos1[i1]
        i1 += 1
    if b != "-":
        if i2 < len(resnos2): r2 = resnos2[i2]
        i2 += 1
    if r1 is not None and r2 is not None:
        matched_pairs.append((r1, r2))

if len(matched_pairs) < 3:
    print(json.dumps({"error": f"only {len(matched_pairs)} matched residues"})); raise SystemExit

# Kabsch superposition
P = np.array([ca1[r1].coord for r1, r2 in matched_pairs], dtype=float)
Q = np.array([ca2[r2].coord for r1, r2 in matched_pairs], dtype=float)
P_c = P - P.mean(axis=0)
Q_c = Q - Q.mean(axis=0)
H = P_c.T @ Q_c
U, S, Vt = np.linalg.svd(H)
d = np.sign(np.linalg.det(Vt.T @ U.T))
D = np.diag([1, 1, d])
R = Vt.T @ D @ U.T
t = P.mean(axis=0) - Q.mean(axis=0) @ R.T
diff = P_c - (Q_c @ R.T)
rmsd = math.sqrt(np.sum(diff * diff) / len(matched_pairs))

# Identity
identity = sum(1 for a, b in zip(aln.seqA, aln.seqB) if a == b and a != "-")

print(json.dumps({
    "pdb1": pdb1, "pdb2": pdb2,
    "chain1": chain1_id, "chain2": chain2_id,
    "seq1_length": len(seq1_str), "seq2_length": len(seq2_str),
    "matched_residues": len(matched_pairs),
    "identity_pct": round(100 * identity / max(1, len(matched_pairs)), 1),
    "rmsd_A": round(float(rmsd), 3),
    "rotation_matrix": [[round(float(R[i][j]), 6) for j in range(3)] for i in range(3)],
    "translation": [round(float(t[i]), 6) for i in range(3)],
    "method": "sequence-alignment + Kabsch (CE-like)",
    "note": "Use rotation_matrix and translation to transform structure 2 onto structure 1 in Molstar",
}, ensure_ascii=False, indent=2))
`;
    },
  },
  {
    id: "align_save_transformed",
    label: "比对并保存变换后坐标 (Save Aligned PDB)",
    description:
      "下载两个 PDB，序列比对+Kabsch 叠合，将结构2所有原子坐标变换后保存为新 PDB 文件，返回文件路径供重新加载到查看器",
    requires: ["biopython", "numpy"],
    params: [
      { name: "pdbId1", type: "string", required: true, description: "PDB ID 1 (参考)" },
      { name: "pdbId2", type: "string", required: true, description: "PDB ID 2 (移动)" },
      { name: "chain1", type: "string", required: false, description: "链 ID 1 (默认 A)" },
      { name: "chain2", type: "string", required: false, description: "链 ID 2 (默认 A)" },
    ],
    buildScript: (_inputPath, params) => {
      const pdbId1 = String(params.pdbId1 ?? "");
      const pdbId2 = String(params.pdbId2 ?? "");
      const chain1 = String(params.chain1 ?? "A");
      const chain2 = String(params.chain2 ?? "A");
      return `
import json, math, os, urllib.request
import numpy as np
from Bio import pairwise2
from Bio.PDB import PDBParser, MMCIFParser, PPBuilder, PDBIO
from Bio.SeqUtils import seq1

pdb1 = "${pdbId1}".lower()
pdb2 = "${pdbId2}".lower()
chain1_id = "${chain1}"
chain2_id = "${chain2}"
cache_dir = "/tmp/molcraft-analysis/pdb"
os.makedirs(cache_dir, exist_ok=True)

def download(pdb_id):
    pdb_path = os.path.join(cache_dir, pdb_id + ".pdb")
    cif_path = os.path.join(cache_dir, pdb_id + ".cif")
    if os.path.exists(pdb_path): return pdb_path, "pdb"
    if os.path.exists(cif_path): return cif_path, "cif"
    try:
        urllib.request.urlretrieve(f"https://files.rcsb.org/download/{pdb_id.upper()}.pdb", pdb_path)
        if os.path.getsize(pdb_path) > 100: return pdb_path, "pdb"
    except: pass
    try:
        urllib.request.urlretrieve(f"https://files.rcsb.org/download/{pdb_id.upper()}.cif", cif_path)
        return cif_path, "cif"
    except Exception as e:
        return None, str(e)

def get_ca_and_seq(pdb_id, chain_id):
    path, fmt = download(pdb_id)
    if not path: return None, None, None, f"download failed: {fmt}"
    parser = MMCIFParser(QUIET=True) if fmt == "cif" else PDBParser(QUIET=True)
    struct = parser.get_structure("s", path)
    model = next(iter(struct))
    if chain_id not in model: return None, None, None, f"chain {chain_id} not found"
    ppb = PPBuilder()
    seq = ""
    for pp in ppb.build_peptides(model[chain_id]):
        seq = "".join(seq1(r.resname) for r in pp)
        break
    ca_by_resno = {}
    for res in model[chain_id]:
        if res.id[0].strip() != "": continue
        if "CA" in res: ca_by_resno[res.id[1]] = res["CA"]
    return seq, ca_by_resno, struct, None

seq1_str, ca1, struct1, err1 = get_ca_and_seq(pdb1, chain1_id)
if err1: print(json.dumps({"error": err1})); raise SystemExit
seq2_str, ca2, struct2, err2 = get_ca_and_seq(pdb2, chain2_id)
if err2: print(json.dumps({"error": err2})); raise SystemExit

# Sequence alignment
alignments = pairwise2.align.globalms(seq1_str, seq2_str, 2, -1, -2, -0.5, one_alignment_only=True)
if not alignments: print(json.dumps({"error": "alignment failed"})); raise SystemExit
aln = alignments[0]

# Match CA atoms
resnos1 = sorted(ca1.keys())
resnos2 = sorted(ca2.keys())
matched_pairs = []
i1 = 0; i2 = 0
for a, b in zip(aln.seqA, aln.seqB):
    r1 = None; r2 = None
    if a != "-":
        if i1 < len(resnos1): r1 = resnos1[i1]
        i1 += 1
    if b != "-":
        if i2 < len(resnos2): r2 = resnos2[i2]
        i2 += 1
    if r1 is not None and r2 is not None:
        matched_pairs.append((r1, r2))

if len(matched_pairs) < 3:
    print(json.dumps({"error": f"only {len(matched_pairs)} matched residues"})); raise SystemExit

# Kabsch
P = np.array([ca1[r1].coord for r1, r2 in matched_pairs], dtype=float)
Q = np.array([ca2[r2].coord for r1, r2 in matched_pairs], dtype=float)
P_c = P - P.mean(axis=0)
Q_c = Q - Q.mean(axis=0)
H = P_c.T @ Q_c
U, S, Vt = np.linalg.svd(H)
d = np.sign(np.linalg.det(Vt.T @ U.T))
D = np.diag([1, 1, d])
R = Vt.T @ D @ U.T
t = P.mean(axis=0) - Q.mean(axis=0) @ R.T
diff = P_c - (Q_c @ R.T)
rmsd = math.sqrt(np.sum(diff * diff) / len(matched_pairs))

# Transform ALL atoms in structure 2
model2 = next(iter(struct2))
for atom in model2.get_atoms():
    coord = np.array(atom.coord, dtype=float)
    new_coord = coord @ R.T + t
    atom.set_coord(new_coord)

# Save transformed structure as PDB
output_path = os.path.join(cache_dir, f"{pdb2}_aligned_to_{pdb1}.pdb")
io = PDBIO()
io.set_structure(struct2)
io.save(output_path)

identity = sum(1 for a, b in zip(aln.seqA, aln.seqB) if a == b and a != "-")

print(json.dumps({
    "pdb1": pdb1, "pdb2": pdb2,
    "chain1": chain1_id, "chain2": chain2_id,
    "matched_residues": len(matched_pairs),
    "identity_pct": round(100 * identity / max(1, len(matched_pairs)), 1),
    "rmsd_A": round(float(rmsd), 3),
    "saved_pdb_path": output_path,
    "saved_filename": f"{pdb2}_aligned_to_{pdb1}.pdb",
    "method": "sequence-alignment + Kabsch + coordinate transform",
    "note": f"Load {output_path} into viewer to see aligned structures",
}, ensure_ascii=False, indent=2))
`;
    },
  },
];

export function getRecipe(id: string): AnalysisRecipe | undefined {
  return ANALYSIS_RECIPES.find((r) => r.id === id);
}
