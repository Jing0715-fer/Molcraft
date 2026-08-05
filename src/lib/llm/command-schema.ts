/**
 * Command schema for the LLM → Molstar bridge.
 *
 * The LLM is instructed (via SYSTEM_PROMPT) to return a JSON object with the
 * shape { reply: string, commands: LlmCommand[] }. The frontend parses the
 * commands and executes them against the Molstar plugin in order.
 *
 * Each command is discriminated by its `type` field so TypeScript can narrow
 * the payload. Add new commands here and dispatch them in `commands.ts`.
 */

export type LlmCommand =
  | { type: "load_pdb"; id: string; preset?: string }
  | { type: "load_alphafold"; uniprotId: string }
  | { type: "load_emdb"; emdbId: string; detail?: number }
  | { type: "load_structure_url"; url: string; format?: string; isBinary?: boolean }
  | {
      type: "set_representation";
      preset: string;
      structures?: "all" | number;
    }
  | {
      type: "set_color_theme";
      theme: string;
      structures?: "all" | number;
    }
  | {
      type: "set_uniform_color";
      color: string; // hex like "#10b981"
      structures?: "all" | number;
    }
  | { type: "focus_residue"; chain?: string; resno?: number; compId?: string }
  | { type: "focus_ligand"; compId: string }
  | { type: "focus_chain"; chain: string }
  | { type: "focus_selection" }
  | { type: "reset_camera" }
  | {
      type: "measure_distance";
      a: ResidueRef;
      b: ResidueRef;
      atomA?: string;
      atomB?: string;
    }
  | {
      type: "measure_angle";
      a: ResidueRef;
      b: ResidueRef;
      c: ResidueRef;
    }
  | {
      type: "measure_dihedral";
      a: ResidueRef;
      b: ResidueRef;
      c: ResidueRef;
      d: ResidueRef;
    }
  | { type: "label_residue"; target: ResidueRef; text?: string }
  | {
      type: "show_interactions";
      target?: ResidueRef | "selection" | "ligand";
      radius?: number;
    }
  | { type: "clear_measurements" }
  | { type: "clear_interactions" }
  | { type: "toggle_spin"; speed?: number }
  | { type: "toggle_rock" }
  | { type: "stop_animation" }
  | { type: "export_snapshot"; width?: number; height?: number }
  | {
      type: "capture_snapshot";
      /** Optional title / caption for the screenshot (used in the report). */
      label?: string;
      /** Camera angle to apply before capturing. */
      angle?: "front" | "side" | "top" | "back";
      /** Optional text labels to overlay at residue positions. */
      labels?: Array<{
        text: string;
        chain?: string;
        resno?: number;
      }>;
      width?: number;
      height?: number;
    }
  | {
      type: "select";
      target: ResidueRef | "ligand" | "all";
      action?: "set" | "add" | "remove";
    }
  | { type: "clear_selection" }
  | { type: "toggle_component_visibility"; component: string; visible?: boolean }
  | {
      type: "load_volume_url";
      url: string;
      format: string;
      isBinary: boolean;
      isoValue: number;
      color?: string;
    }
  | {
      type: "align_structures";
      ref: number; // index of reference structure
      mobile: number; // index of mobile structure
      method?: "superpose" | "tm-align";
    }
  | { type: "set_background"; color: string }
  | { type: "set_granularity"; granularity: string }
  // ---------- Real structure analysis (NEW) ----------
  | { type: "analyze_metadata"; id: string; includeInterfaces?: boolean }
  | { type: "analyze_interface"; id: string; assembly?: number }
  | { type: "analyze_cli_list" }
  | {
      type: "analyze_run";
      recipe: string;
      pdbId?: string;
      params?: Record<string, unknown>;
    }
  // ---------- APBS electrostatic 3D visualization ----------
  | {
      type: "show_electrostatic_surface";
      pdbId?: string;
      chain?: string;
      ionicStrength?: number;
    }
  // ---------- Druggability 3D visualization ----------
  | {
      type: "show_druggable_pocket";
      ligandCompId: string;
      pdbId?: string;
      radius?: number;
    }
  // ---------- Virtual screening ----------
  | {
      type: "run_virtual_screening";
      ligandCompId: string;
      pdbId?: string;
      fragmentSet?: "druglike" | "fragment" | "natural";
    }
  // ---------- Multi-pocket detection ----------
  | {
      type: "detect_pockets";
      pdbId?: string;
      minDepth?: number;
    };

export interface ResidueRef {
  /** Chain identifier (auth or label) e.g. "A". */
  chain?: string;
  /** Residue number (auth seq id). */
  resno?: number;
  /** Residue name / component id e.g. "HEM", "ALA". */
  compId?: string;
  /** Insertion code, if any. */
  insCode?: string;
  /** Atom name within the residue e.g. "CA", "NZ". */
  atom?: string;
}

export interface LlmResponsePayload {
  /** Human-facing chat reply (Markdown). */
  reply: string;
  /** Optional commands to execute against the viewer. */
  commands?: LlmCommand[];
  /** Optional flag: if true, capture a snapshot after executing commands (for report). */
  captureSnapshot?: boolean;
  /** If true, after executing analyze_* commands, feed results back to LLM for a follow-up turn. */
  continueAfterAnalysis?: boolean;
}

/** Parse and validate an LLM response into a LlmResponsePayload. */
export function parseLlmPayload(raw: string): LlmResponsePayload {
  const trimmed = raw.trim();

  // The model may wrap JSON in ```json ... ``` fences or prepend prose.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonCandidate = fenceMatch
    ? fenceMatch[1].trim()
    : extractFirstJsonObject(trimmed);

  if (!jsonCandidate) {
    // No JSON found — treat the whole thing as a plain chat reply.
    return { reply: trimmed };
  }

  // Try parsing the JSON directly first.
  try {
    const parsed = JSON.parse(jsonCandidate);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        captureSnapshot: Boolean(parsed.captureSnapshot),
        continueAfterAnalysis: Boolean(parsed.continueAfterAnalysis),
      };
    }
  } catch {
    // JSON.parse failed — likely due to unescaped quotes inside string values
    // (LLMs often produce JSON with unescaped " inside reply strings).
    // Try to extract the reply field using regex as a fallback.
  }

  // Fallback 1: Regex extraction of the reply field.
  // This handles cases where JSON.parse fails due to unescaped quotes.
  const replyMatch = jsonCandidate.match(
    /"reply"\s*:\s*"([\s\S]*?)"\s*,\s*"commands"/
  );
  if (replyMatch) {
    // Unescape common escape sequences
    let reply = replyMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    // Try to parse commands array separately
    const commandsMatch = jsonCandidate.match(
      /"commands"\s*:\s*(\[[\s\S]*?\])\s*[,\}]/
    );
    let commands: unknown[] = [];
    if (commandsMatch) {
      try {
        commands = JSON.parse(commandsMatch[1]);
      } catch {
        // commands array also has issues — leave empty
      }
    }
    const continueMatch = jsonCandidate.match(
      /"continueAfterAnalysis"\s*:\s*(true|false)/
    );
    return {
      reply,
      commands,
      captureSnapshot: false,
      continueAfterAnalysis: continueMatch ? continueMatch[1] === "true" : false,
    };
  }

  // Fallback 2: Try to repair common LLM JSON mistakes.
  try {
    let repaired = jsonCandidate;
    // Fix 1: "key: value" → "key": value (colon inside quotes)
    // The LLM sometimes writes "includeInterfaces: true" instead of "includeInterfaces": true
    // This pattern matches a quoted string that looks like "word: bool/number"
    // and converts it to "word": bool/number
    repaired = repaired.replace(
      /"(\w+)\s*:\s*(true|false|null|\d+(?:\.\d+)?)"/g,
      '"$1": $2'
    );
    // Fix 2: Remove trailing commas
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");
    // Fix 3: Add missing closing braces/brackets
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    if (openBraces > closeBraces) {
      repaired += "}".repeat(openBraces - closeBraces);
    }
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) {
      repaired += "]".repeat(openBrackets - closeBrackets);
    }
    const parsed = JSON.parse(repaired);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        captureSnapshot: Boolean(parsed.captureSnapshot),
        continueAfterAnalysis: Boolean(parsed.continueAfterAnalysis),
      };
    }
  } catch {
    // Repair also failed
  }

  // Fallback 3: Add missing closing braces/brackets and try again.
  try {
    let repaired = jsonCandidate;
    repaired = repaired.replace(/,\s*([}\]])/g, "$1");
    const openBraces = (repaired.match(/{/g) || []).length;
    const closeBraces = (repaired.match(/}/g) || []).length;
    if (openBraces > closeBraces) {
      repaired += "}".repeat(openBraces - closeBraces);
    }
    const openBrackets = (repaired.match(/\[/g) || []).length;
    const closeBrackets = (repaired.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets) {
      repaired += "]".repeat(openBrackets - closeBrackets);
    }
    const parsed = JSON.parse(repaired);
    if (typeof parsed === "object" && parsed !== null) {
      return {
        reply: typeof parsed.reply === "string" ? parsed.reply : "",
        commands: Array.isArray(parsed.commands) ? parsed.commands : [],
        captureSnapshot: Boolean(parsed.captureSnapshot),
        continueAfterAnalysis: Boolean(parsed.continueAfterAnalysis),
      };
    }
  } catch {
    // All parsing attempts failed
  }

  // Last resort: return the raw text as the reply.
  console.warn("[parseLlmPayload] All JSON parse attempts failed, returning raw text");
  return { reply: trimmed };
}

/** Find the first balanced {...} object in a string. */
function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else {
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
  }
  return null;
}
