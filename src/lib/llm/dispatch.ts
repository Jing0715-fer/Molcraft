/**
 * LLM provider dispatcher for Molcraft.
 *
 * Pattern adapted from llm-provider-dispatch skill + SciWrite's src/lib/llm.ts:
 *   - Each adapter is declarative (id, bin, callArgs, parseSessionId, ...).
 *   - chatWithSession(userId, scope, messages, opts) routes by `provider`:
 *       "glm" / "zai"      → z-ai-web-dev-sdk (no session reuse, but consistent)
 *       "cli:<id>"         → spawn <id> with optional --resume <sessionId>
 *   - On every call we persist (userId, scope, provider) → cliSessionId in
 *     the LLMSession table, so multi-turn UI flows can resume.
 *   - On failure, the candidate chain is walked in order — never fabricate.
 *   - No hardcoded absolute paths; everything resolved via `where`/`which`
 *     (with ${BIN}_CLI_PATH and extraProbePaths overrides for codebuddy).
 *
 * This file is the single source of truth for "which LLM can be called and
 * how". The /api/llm/chat, /api/llm/report, /api/vlm/chat routes just call
 * chatWithSession / vlmChat; the /api/llm/agents route surfaces
 * inspectProviders() for the UI picker.
 */

import { spawn, execFile as _execFile } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "@/lib/db";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Scope = "chat" | "report" | "vlm";

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Provider id: "glm" | "zai" | "cli:hermes" | "cli:codex" | ... */
  provider: string;
  /** Project/structure id this call belongs to (for session scoping). */
  projectId?: string;
  /** Optional explicit model override (e.g. "gpt-5", "claude-sonnet-4.6"). */
  model?: string;
  /** Hard kill timeout in ms (overrides adapter default). */
  timeoutMs?: number;
  /** When true, persist the user+assistant turns to ConversationTurn. */
  persistHistory?: boolean;
}

export interface LlmResult {
  ok: boolean;
  content: string;
  provider: string;
  model: string;
  durationMs: number;
  fallback: boolean;
  cliSessionId?: string;
  error?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

export interface LlmProviderInfo {
  provider: string;            // canonical id: "glm" | "cli:hermes" | ...
  label: string;
  icon: string;
  via: "native" | "wsl" | "sdk";
  available: boolean;
  bin: string | null;
  reason: string;              // human-readable availability / error
  defaultModel?: string;
}

// ---------------------------------------------------------------------------
// Adapter table
// ---------------------------------------------------------------------------

interface CliAdapter {
  id: string;
  label: string;
  icon: string;
  bin: string;
  /** Some CLIs ship as Node.js shims and need `node <bin>` to launch. */
  needsNode?: boolean;
  /** Known absolute paths to probe first (Windows-only install dirs). */
  extraProbePaths?: string[];
  /**
   * Build the argv. The caller passes the rendered prompt as `prompt`;
   * the adapter is responsible for placing it on the command line. Most
   * CLIs use a positional or `-q "..."` arg. Keep the prompt short —
   * Windows CreateProcess has a ~16KB argv ceiling. If you need to ship
   * a longer prompt, attach it via stdin (write to child.stdin in
   * runCli) and have callArgs return ["-q", "-"] or equivalent.
   */
  callArgs: (model: string | undefined, prompt: string) => string[];
  outputStream: "stdout" | "both";
  /** Strip leading banner lines (e.g. `session_id: <id>`) from the reply. */
  stripBanner?: (raw: string) => string;
  /** Append `--resume <id>` tokens when an existing session is being continued. */
  resumeArg?: (sessionId: string) => string[];
  /** Extract a session id from CLI stdout/stderr so the next call can resume. */
  parseSessionId?: (raw: string) => string | null;
  extraEnv?: Record<string, string>;
  probeTimeoutMs?: number;
  callTimeoutMs?: number;
  defaultModel?: string;
}

/**
 * IMPORTANT:
 *  - `hermes` callArgs MUST NOT pass `--ignore-user-config` — that disables
 *    the user's locally-configured provider/model and breaks when the user
 *    has MiniMax / GLM / other backend configured.
 *  - `codebuddy` ships as a Node.js shim, hence `needsNode: true`. Its
 *    `--output-format json` is required to read sessionId — see
 *    `extractContent` note below.
 */
const CLI_ADAPTERS: CliAdapter[] = [
  {
    id: "hermes",
    label: "Hermes CLI",
    icon: "⚡",
    bin: "hermes",
    callArgs: (m, p) => {
      const args = ["chat", "-q", p, "-Q", "--source", "molcraft"];
      if (m) args.push("--model", m);
      return args;
    },
    outputStream: "both",
    stripBanner: (r) => r.replace(/(?:^|\n)\s*session_id:\s*\S+/i, "").trim(),
    parseSessionId: (raw) => {
      const m = raw.match(/(?:^|\n)\s*session_id:\s*(\S+)/i);
      return m ? m[1] : null;
    },
    resumeArg: (id) => ["--resume", id],
    extraEnv: { PYTHONIOENCODING: "utf-8" },
    probeTimeoutMs: 15_000,
    callTimeoutMs: Number(process.env.HERMES_CLI_TIMEOUT_MS) || 600_000,
    defaultModel: undefined,
  },
  {
    id: "codex",
    label: "Codex CLI",
    icon: "🟢",
    bin: "codex",
    callArgs: (_m, p) => ["exec", p],  // codex exec takes the prompt as positional; --quiet isn't a valid flag
    outputStream: "stdout",
    resumeArg: (id) => ["resume", id],
    parseSessionId: (raw) => {
      // Codex emits "session id: <uuid>" in the boot log
      const m = raw.match(/session\s+id:\s*([a-f0-9-]{8,})/i);
      return m ? m[1] : null;
    },
    probeTimeoutMs: 10_000,
    callTimeoutMs: 240_000,
  },
  {
    id: "claude",
    label: "Claude Code CLI",
    icon: "🟠",
    bin: "claude",
    callArgs: (_m, p) => ["-p", p, "--no-stream"],
    outputStream: "stdout",
    resumeArg: (id) => ["--resume", id],
    parseSessionId: (raw) => {
      const m = raw.match(/session[_-]?id[:\s]+([a-f0-9-]{8,})/i);
      return m ? m[1] : null;
    },
    probeTimeoutMs: 10_000,
    callTimeoutMs: 240_000,
  },
  {
    id: "codebuddy",
    label: "Codebuddy / WorkBuddy CLI",
    icon: "🐼",
    bin: "codebuddy",
    needsNode: true,
    extraProbePaths: [
      process.platform === "win32"
        ? "C:\\Program Files\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy"
        : "/usr/local/bin/codebuddy",
    ],
    callArgs: (m, p) => [
      "--print",
      "--output-format",
      "json",
      "--model",
      m ?? "deepseek-v4-pro",
      p,
    ],
    outputStream: "stdout",
    resumeArg: (id) => ["--resume", id],
    parseSessionId: (raw) => {
      const m = raw.match(/"sessionId"\s*:\s*"([a-f0-9-]{8,})"/i);
      return m ? m[1] : null;
    },
    // When --output-format json is used, the entire stdout is a JSON array
    // envelope. We must pull the last assistant text or the caller receives
    // a JSON blob instead of the LLM's reply. See "Critical Pitfalls" in
    // llm-provider-dispatch SKILL.md.
    stripBanner: (r) => extractCodebuddyContent(r),
    probeTimeoutMs: 15_000,
    callTimeoutMs: 240_000,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    icon: "♊",
    bin: "gemini",
    callArgs: (_m, p) => [p],  // gemini takes the prompt as a positional
    outputStream: "stdout",
    resumeArg: (id) => ["--resume", id],
    probeTimeoutMs: 10_000,
    callTimeoutMs: 240_000,
  },
  {
    id: "aider",
    label: "Aider CLI",
    icon: "🛠️",
    bin: "aider",
    callArgs: (_m, p) => ["--message", p, "--no-git", "--yes", "--no-auto-commits"],
    outputStream: "stdout",
    probeTimeoutMs: 10_000,
    callTimeoutMs: 240_000,
  },
];

function extractCodebuddyContent(raw: string): string {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return raw.trim();
    for (let i = arr.length - 1; i >= 0; i--) {
      const ev = arr[i];
      if (ev?.type === "result" && typeof ev.result === "string") return ev.result;
    }
    for (let i = arr.length - 1; i >= 0; i--) {
      const ev = arr[i];
      if (ev?.type === "assistant" && Array.isArray(ev.message?.content)) {
        const blocks = ev.message.content.filter((b: any) => b?.type === "text");
        const lastText = blocks[blocks.length - 1]?.text;
        if (typeof lastText === "string") return lastText;
      }
    }
  } catch {
    /* fall through */
  }
  return raw.trim();
}

// ---------------------------------------------------------------------------
// findOnPath: 3-tier resolution (extras → env override → PATH)
// ---------------------------------------------------------------------------

async function findOnPath(
  bin: string,
  extras?: string[]
): Promise<string | null> {
  // 1. extraProbePaths (known install dirs not on PATH)
  if (extras) {
    for (const p of extras) {
      try {
        const r = await execFileAsync("where", [p], { timeout: 2000 });
        // `where` may print multiple lines if the path itself is a directory;
        // we want the first file that exists.
        const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
        if (first) return first;
      } catch {
        /* keep looking */
      }
    }
  }
  // 2. ${BIN}_CLI_PATH env override
  const envKey = bin.toUpperCase().replace(/[^A-Z0-9]/g, "_") + "_CLI_PATH";
  const envPath = process.env[envKey];
  if (envPath) {
    try {
      const r = await execFileAsync("where", [envPath], { timeout: 2000 });
      const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (first) return first;
    } catch {
      /* keep looking */
    }
  }
  // 3. PATH lookup
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const r = await execFileAsync(cmd, [bin], { timeout: 3000 });
    const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Probing: in-process cache, fast --version smoke test
// ---------------------------------------------------------------------------

type ProbeOk = { ok: true; bin: string; version: string };
type ProbeErr = { ok: false; reason: string };

let _probeCache: Promise<Record<string, ProbeOk | ProbeErr>> | null = null;

async function probeCli(adapter: CliAdapter): Promise<ProbeOk | ProbeErr> {
  const bin = await findOnPath(adapter.bin, adapter.extraProbePaths);
  if (!bin) return { ok: false, reason: "binary not in PATH" };

  const args = ["--version"];
  const timeout = adapter.probeTimeoutMs ?? 10_000;
  try {
    const child = adapter.needsNode
      ? spawn(process.execPath, [bin, ...args], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ...adapter.extraEnv },
        })
      : spawn(bin, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ...adapter.extraEnv },
        });
    let out = "";
    child.stdout.on("data", (b) => (out += b.toString()));
    child.stderr.on("data", (b) => (out += b.toString()));
    const result = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const kill = setTimeout(() => {
        try { child.kill(); } catch {}
        resolve({ code: 124, out });
      }, timeout);
      child.on("close", (code) => {
        clearTimeout(kill);
        resolve({ code, out });
      });
      child.on("error", () => {
        clearTimeout(kill);
        resolve({ code: -1, out });
      });
    });
    if (result.code === 0 || /version/i.test(result.out)) {
      return { ok: true, bin, version: result.out.trim().split(/\r?\n/)[0].slice(0, 80) || "ok" };
    }
    // Some CLIs return non-zero on --version but still print something — accept that
    if (result.out.trim().length > 0) {
      return { ok: true, bin, version: result.out.trim().split(/\r?\n/)[0].slice(0, 80) };
    }
    return { ok: false, reason: `probe exited ${result.code}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function probeAll(): Promise<Record<string, ProbeOk | ProbeErr>> {
  if (_probeCache) return _probeCache;
  _probeCache = (async () => {
    const out: Record<string, ProbeOk | ProbeErr> = {};
    await Promise.all(
      CLI_ADAPTERS.map(async (a) => {
        out[a.id] = await probeCli(a);
      })
    );
    return out;
  })();
  return _probeCache;
}

export function clearLlmProbeCache(): void {
  _probeCache = null;
}

// ---------------------------------------------------------------------------
// Z.ai (default SDK) probe — separate from CLI probe cache
// ---------------------------------------------------------------------------

let _zaiOk: boolean | null = null;
async function probeZai(): Promise<boolean> {
  if (_zaiOk !== null) return _zaiOk;
  try {
    const mod = await import("z-ai-web-dev-sdk").catch(() => null);
    if (!mod) {
      _zaiOk = false;
      return false;
    }
    // We don't actually call the API on probe (that costs a round-trip);
    // SDK being importable is the signal.
    _zaiOk = true;
    return true;
  } catch {
    _zaiOk = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// inspectProviders — for /api/llm/agents and the UI picker
// ---------------------------------------------------------------------------

export async function inspectProviders(opts?: {
  showUnavailable?: boolean;
  whitelist?: string[];
}): Promise<{
  chosen: string;
  available: LlmProviderInfo[];
  totalClisScanned: number;
}> {
  const probes = await probeAll();
  const zaiAvailable = await probeZai();
  const whitelist = opts?.whitelist;

  const all: LlmProviderInfo[] = [];

  // Z.ai SDK (default)
  if (!whitelist || whitelist.includes("glm") || whitelist.includes("zai")) {
    all.push({
      provider: "glm",
      label: "GLM (Z.ai SDK)",
      icon: "🟣",
      via: "sdk",
      available: zaiAvailable,
      bin: null,
      reason: zaiAvailable
        ? "通过 z-ai-web-dev-sdk 调用 GLM 大模型"
        : "z-ai-web-dev-sdk 未安装或不可用",
      defaultModel: "glm-4.6",
    });
  }

  // CLI adapters
  for (const a of CLI_ADAPTERS) {
    const providerId = `cli:${a.id}`;
    if (whitelist && !whitelist.includes(providerId)) continue;
    const probe = probes[a.id];
    const available = probe?.ok === true;
    all.push({
      provider: providerId,
      label: a.label,
      icon: a.icon,
      via: "native",
      available,
      bin: available ? (probe as ProbeOk).bin : a.bin,
      reason: available
        ? `${(probe as ProbeOk).version} — ${a.bin}`
        : (probe as ProbeErr).reason,
      defaultModel: a.defaultModel,
    });
  }

  const filtered = opts?.showUnavailable ? all : all.filter((p) => p.available);
  const chosen = filtered[0]?.provider ?? "glm";
  return { chosen, available: filtered, totalClisScanned: CLI_ADAPTERS.length };
}

// ---------------------------------------------------------------------------
// chatWithSession — main entrypoint for chat / report
// ---------------------------------------------------------------------------

export async function chatWithSession(
  userId: string,
  scope: Scope,
  messages: LlmMessage[],
  opts: ChatOptions
): Promise<LlmResult> {
  const start = Date.now();
  const provider = (opts.provider || "glm").toLowerCase();

  // Load persisted session id for (user, scope, provider) if any
  let persistedSessionId: string | undefined;
  try {
    const row = await db.lLMSession.findUnique({
      where: {
        userId_scope_provider: { userId, scope, provider },
      },
    });
    persistedSessionId = row?.cliSessionId ?? undefined;
  } catch (err) {
    // If DB is not migrated yet, keep going without session resume
    console.warn("[llm] session lookup failed:", err instanceof Error ? err.message : err);
  }

  // Build the candidate chain — requested provider first, then fallbacks
  const all = await inspectProviders({ showUnavailable: true });
  const available = all.available.filter((p) => p.available);
  if (available.length === 0) {
    return {
      ok: false,
      content: "",
      provider,
      model: opts.model ?? "",
      durationMs: Date.now() - start,
      fallback: false,
      error: "No LLM provider available. Install one CLI from the list, or restore z-ai-web-dev-sdk.",
    };
  }
  const requested = available.find((p) => p.provider === provider);
  // Fallback policy:
  //   - "auto" or unspecified  → try requested (if any) then walk the chain
  //   - explicit provider      → try ONLY that one; if it fails, return
  //                             the error verbatim so the caller knows
  //                             their pick didn't work (and can prompt
  //                             the user to install it or pick another).
  //                             This prevents the silent "user picked
  //                             codebuddy → got a hermes reply" bug.
  const isExplicit = !!opts.provider && opts.provider !== "auto";
  const candidates = isExplicit
    ? requested
      ? [requested]
      : []
    : requested
      ? [requested, ...available.filter((p) => p.provider !== provider)]
      : available;

  if (candidates.length === 0) {
    return {
      ok: false,
      content: "",
      provider,
      model: opts.model ?? "",
      durationMs: Date.now() - start,
      fallback: false,
      error: isExplicit
        ? `Provider "${provider}" is not available on this host. Install it or pick another.`
        : "No LLM provider available. Install one CLI from the list, or restore z-ai-web-dev-sdk.",
    };
  }

  // Build a single combined prompt for CLI calls (CLI ADAPTERS receive
  // a flat string, not a multi-message array). The system prompt becomes
  // a prefix; user/assistant turns are joined with role tags.
  const systemMsg = messages.find((m) => m.role === "system")?.content;
  const turns = messages.filter((m) => m.role !== "system");
  const flatPrompt = renderFlatPrompt(systemMsg, turns);

  let lastError: string | undefined;
  for (const cand of candidates) {
    const tried = candidates.indexOf(cand) > 0;
    try {
      let result: LlmResult;
      if (cand.provider === "glm") {
        result = await callZai(flatPrompt, messages, opts);
      } else {
        const cliId = cand.provider.replace(/^cli:/, "");
        result = await callCli(cliId, flatPrompt, opts, persistedSessionId);
      }
      result.fallback = tried;
      result.durationMs = Date.now() - start;

      // Persist the (user, scope, provider, cliSessionId) tuple so next call resumes
      if (result.ok && result.cliSessionId && cand.provider !== "glm") {
        await persistSession(userId, scope, cand.provider, result.cliSessionId).catch(
          (err) => console.warn("[llm] session persist failed:", err)
        );
      }

      // Optionally persist conversation history
      if (result.ok && opts.persistHistory !== false) {
        await persistHistory(userId, scope, opts.projectId, messages, result, cand.provider).catch(
          (err) => console.warn("[llm] history persist failed:", err)
        );
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn(`[llm] provider ${cand.provider} failed: ${lastError}`);
      // Continue to next candidate
    }
  }

  return {
    ok: false,
    content: "",
    provider,
    model: opts.model ?? "",
    durationMs: Date.now() - start,
    fallback: true,
    error: lastError ?? `All ${candidates.length} providers failed`,
  };
}

function renderFlatPrompt(systemMsg: string | undefined, turns: LlmMessage[]): string {
  // CLI runners (hermes/codex/claude/codebuddy/...) all consume stdin as
  // the user's query. They DON'T have a separate "system" channel like
  // the OpenAI Chat Completions API does, AND putting a multi-thousand-
  // char system prompt into argv via `-q "..."` would hit ENAMETOOLONG
  // on Windows once the system prompt + history exceeds ~16KB.
  //
  // Strategy:
  //   1. Keep prior turns OFF the wire. CLI sessions maintain their own
  //      context via --resume <sessionId>; re-sending history duplicates
  //      it and trips prompt-cache invalidation.
  //   2. The single user query is the LAST element of `turns`.
  //   3. The system prompt is dropped here — it would be too large for
  //      argv anyway. Long-form system instructions should be loaded
  //      into the CLI's own context (e.g. write them to
  //      D:\AI-web-app\Molcraft\AGENTS.md so hermes auto-injects them,
  //      or attach via --skills / a project-scoped skill). For now the
  //      CLI gets just the user message; if you need the full MolCraft
  //      analysis instructions in-session, point hermes at a project
  //      AGENTS.md (see scripts/install-molcraft-agent-md.sh).
  const currentQuery = turns.length > 0 ? turns[turns.length - 1] : null;

  if (currentQuery) {
    return currentQuery.content;
  }
  if (systemMsg) {
    // No user query but we have a system prompt — the caller probably
    // wants a zero-shot system execution. Surface the first line so the
    // CLI has something to act on.
    return systemMsg.split("\n").slice(0, 3).join("\n");
  }
  return "（请继续）";
}

// ---------------------------------------------------------------------------
// Z.ai SDK call
// ---------------------------------------------------------------------------

async function callZai(
  flatPrompt: string,
  messages: LlmMessage[],
  opts: ChatOptions
): Promise<LlmResult> {
  let ZAI: any;
  try {
    const mod = await import("z-ai-web-dev-sdk");
    ZAI = (mod as any).default ?? mod;
  } catch (err) {
    throw new Error(
      `z-ai-web-dev-sdk not installed. Run \`bun add z-ai-web-dev-sdk\`. (${err instanceof Error ? err.message : err})`
    );
  }

  const zai = await ZAI.create();
  const completion = await zai.chat.completions.create({
    messages,
    temperature: 0.4,
    max_tokens: 4096,
    thinking: { type: "disabled" },
  });
  const content = completion?.choices?.[0]?.message?.content ?? "";
  return {
    ok: true,
    content,
    provider: "glm",
    model: opts.model ?? "glm-4.6",
    durationMs: 0, // filled in by caller
    fallback: false,
    usage: completion?.usage,
  };
}

// ---------------------------------------------------------------------------
// CLI call (with optional session resume)
// ---------------------------------------------------------------------------

async function callCli(
  cliId: string,
  prompt: string,
  opts: ChatOptions,
  persistedSessionId?: string
): Promise<LlmResult> {
  const adapter = CLI_ADAPTERS.find((a) => a.id === cliId);
  if (!adapter) throw new Error(`Unknown CLI adapter: ${cliId}`);

  const probes = await probeAll();
  const probe = probes[cliId];
  if (!probe?.ok) {
    throw new Error(`${adapter.label} not available: ${(probe as ProbeErr | undefined)?.reason ?? "unknown"}`);
  }

  // Build argv. hermes/codex/claude all use the -q "..." positional for
  // the user query. We pass the rendered prompt (system+history+user)
  // there directly. The caller is responsible for keeping this short
  // enough to avoid ENAMETOOLONG on Windows (~16KB argv limit).
  let args = adapter.callArgs(opts.model ?? adapter.defaultModel, prompt);
  if (persistedSessionId && adapter.resumeArg) {
    args = [...args, ...adapter.resumeArg(persistedSessionId)];
  }

  const timeout = opts.timeoutMs ?? adapter.callTimeoutMs ?? 240_000;

  return new Promise<LlmResult>((resolve) => {
    // CRITICAL: prompt goes via argv (callArgs already included it). On
    // Windows CreateProcess has a ~32K argv limit; the caller must keep
    // the rendered prompt under that. No stdin pipe needed here.
    const child = adapter.needsNode
      ? spawn(process.execPath, [probe.bin, ...args], {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ...adapter.extraEnv },
        })
      : spawn(probe.bin, args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, ...adapter.extraEnv },
        });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (b) => (stdout += b.toString()));
    child.stderr?.on("data", (b) => (stderr += b.toString()));

    const killTimer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({
        ok: false,
        content: "",
        provider: `cli:${cliId}`,
        model: opts.model ?? adapter.defaultModel ?? "",
        durationMs: 0,
        fallback: false,
        error: `${adapter.label} timed out after ${Math.round(timeout / 1000)}s`,
      });
    }, timeout);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      resolve({
        ok: false,
        content: "",
        provider: `cli:${cliId}`,
        model: opts.model ?? adapter.defaultModel ?? "",
        durationMs: 0,
        fallback: false,
        error: `spawn error: ${err.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(killTimer);
      const raw = adapter.outputStream === "both" ? stdout + stderr : stdout;
      const sessionId =
        adapter.parseSessionId?.(raw) ?? persistedSessionId ?? undefined;
      const content = (adapter.stripBanner ?? ((r) => r.trim()))(raw);

      if (code !== 0 && content.length === 0) {
        resolve({
          ok: false,
          content: "",
          provider: `cli:${cliId}`,
          model: opts.model ?? adapter.defaultModel ?? "",
          durationMs: 0,
          fallback: false,
          cliSessionId: sessionId,
          error: `${adapter.label} exited ${code}: ${stderr.slice(0, 500)}`,
        });
        return;
      }
      resolve({
        ok: true,
        content,
        provider: `cli:${cliId}`,
        model: opts.model ?? adapter.defaultModel ?? "",
        durationMs: 0,
        fallback: false,
        cliSessionId: sessionId,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Vision (image + text) — only Z.ai supports it today; CLIs without vision
// capabilities are listed in the providers but rejected at call time.
// ---------------------------------------------------------------------------

export interface VlmOptions extends ChatOptions {
  image: string; // data URL or http URL
}

export async function vlmChat(
  userId: string,
  messages: LlmMessage[],
  opts: VlmOptions
): Promise<LlmResult> {
  // For now, route to GLM vision; CLI providers without multimodal support
  // will return a clear error rather than silently dropping the image.
  if (opts.provider !== "glm" && opts.provider !== "zai") {
    return {
      ok: false,
      content: "",
      provider: opts.provider,
      model: "",
      durationMs: 0,
      fallback: false,
      error: `VLM (vision-language) calls currently only support the Z.ai GLM backend. "${opts.provider}" is text-only.`,
    };
  }
  const start = Date.now();
  try {
    const mod = await import("z-ai-web-dev-sdk");
    const ZAI = (mod as any).default ?? mod;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.createVision({
      model: "glm-5v-turbo",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: messages.map((m) => `${m.role}: ${m.content}`).join("\n") },
            { type: "image_url", image_url: { url: opts.image } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    });
    const content = completion?.choices?.[0]?.message?.content ?? "";
    if (opts.persistHistory !== false) {
      await persistHistory(userId, "vlm", opts.projectId, messages, {
        ok: true,
        content,
        provider: "glm",
        model: "glm-5v-turbo",
        durationMs: Date.now() - start,
        fallback: false,
      }, "glm").catch(() => {});
    }
    return {
      ok: true,
      content,
      provider: "glm",
      model: "glm-5v-turbo",
      durationMs: Date.now() - start,
      fallback: false,
      usage: completion?.usage,
    };
  } catch (err) {
    return {
      ok: false,
      content: "",
      provider: "glm",
      model: "glm-5v-turbo",
      durationMs: Date.now() - start,
      fallback: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function persistSession(
  userId: string,
  scope: Scope,
  provider: string,
  cliSessionId: string
): Promise<void> {
  await db.lLMSession.upsert({
    where: {
      userId_scope_provider: { userId, scope, provider },
    },
    create: { userId, scope, provider, cliSessionId, lastUsedAt: new Date() },
    update: { cliSessionId, lastUsedAt: new Date() },
  });
}

async function persistHistory(
  userId: string,
  scope: Scope,
  projectId: string | undefined,
  messages: LlmMessage[],
  result: LlmResult,
  provider: string
): Promise<void> {
  const data: any[] = [];
  for (const m of messages) {
    data.push({
      userId,
      scope,
      projectId: projectId ?? null,
      role: m.role,
      content: m.content,
      provider: m.role === "user" ? null : provider,
      model: m.role === "user" ? null : result.model,
    });
  }
  if (result.ok) {
    data.push({
      userId,
      scope,
      projectId: projectId ?? null,
      role: "assistant",
      content: result.content,
      provider,
      model: result.model,
    });
  }
  if (data.length > 0) {
    await db.conversationTurn.createMany({ data });
  }
}
