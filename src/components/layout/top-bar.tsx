"use client";

import { useState, useCallback, useRef } from "react";
import {
  Boxes,
  FileUp,
  FlaskConical,
  ImageIcon,
  Loader2,
  RotateCcw,
  Search,
  Sparkles,
  Sun,
  Moon,
  Settings,
  Languages,
  Play,
  Pause,
  Crosshair,
  Download,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore } from "@/lib/store";
import type { LoadedStructure } from "@/lib/store";
import { parsePdb } from "@/lib/structure-utils";
import { EXAMPLE_STRUCTURES, SELECTION_GRANULARITY } from "@/lib/molstar/presets";
import { executeCommand } from "@/lib/molstar/commands";
import { SettingsDialog } from "./settings-dialog";
import { StructureSearch } from "./structure-search";
import { setLang, getLang } from "@/lib/i18n";

export function TopBar() {
  const [pdbId, setPdbId] = useState("");
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const viewer = useAppStore((s) => s.viewer);
  const addStructure = useAppStore((s) => s.addStructure);
  const setStructureFileCache = useAppStore((s) => s.setStructureFileCache);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);
  const setRightPanelTab = useAppStore((s) => s.setRightPanelTab);
  const viewerBgDark = useAppStore((s) => s.viewerBgDark);
  const setViewerBgDark = useAppStore((s) => s.setViewerBgDark);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  // Global display controls state (moved from UnifiedLeftPanel)
  const [granularity, setGranularity] = useState("residue");
  const [spin, setSpin] = useState(false);

  const handleLoadPdb = useCallback(
    async (id: string, source: "pdb" | "alphafold" | "emdb" = "pdb") => {
      if (!viewer || !id) return;
      setLoading(true);
      try {
        if (source === "pdb") {
          const res = await executeCommand(viewer, { type: "load_pdb", id });
          if (!res.ok) {
            toast(`加载失败: ${res.detail}`, "error");
            return;
          }
          // Fetch PDB text for client-side alignment
          let pdbText = "";
          try {
            const pdbRes = await fetch(`https://files.rcsb.org/download/${id.toUpperCase()}.pdb`);
            if (pdbRes.ok) pdbText = await pdbRes.text();
          } catch {}
          // Parse metadata
          let metadata: LoadedStructure["metadata"] | undefined;
          if (pdbText) {
            try {
              const parsed = parsePdb(pdbText);
              metadata = {
                chains: parsed.chains,
                numAtoms: parsed.numAtoms,
                numResidues: parsed.numResidues,
                title: parsed.title || undefined,
              };
            } catch {}
          }
          addStructure({
            id,
            label: id.toUpperCase(),
            source: "pdb",
            loadedAt: Date.now(),
            pdbText: pdbText || undefined,
            metadata,
          });
        } else if (source === "alphafold") {
          await executeCommand(viewer, { type: "load_alphafold", uniprotId: id });
          addStructure({
            id,
            label: `AF-${id}`,
            source: "alphafold",
            loadedAt: Date.now(),
          });
        } else if (source === "emdb") {
          await executeCommand(viewer, { type: "load_emdb", emdbId: id, detail: 3 });
          addStructure({
            id,
            label: id.toUpperCase(),
            source: "emdb",
            loadedAt: Date.now(),
          });
        }
        logCommand({ type: `load_${source}`, ok: true, detail: id });
        toast(`已加载 ${id}`, "success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logCommand({ type: `load_${source}`, ok: false, detail: msg });
        toast(`加载失败: ${msg}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [viewer, addStructure, toast, logCommand]
  );

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!viewer || !files || files.length === 0) return;
      setLoading(true);
      try {
        // Read + cache file contents so analysis recipes and alignment can run on them.
        const fileData: Array<{ name: string; text: string; format: "pdb" | "cif" }> = [];
        for (const f of Array.from(files)) {
          try {
            const text = await f.text();
            const ext = f.name.split(".").pop()?.toLowerCase() ?? "pdb";
            const format: "pdb" | "cif" =
              ext === "cif" || ext === "mmcif" ? "cif" : "pdb";
            setStructureFileCache(f.name, text, format);
            fileData.push({ name: f.name, text, format });
          } catch {
            // ignore — viewer can still load it
          }
        }
        await viewer.loadFiles(Array.from(files));
        for (const f of Array.from(files)) {
          const fd = fileData.find((d) => d.name === f.name);
          // Parse metadata from PDB text
          let metadata: LoadedStructure["metadata"] | undefined;
          let pdbText: string | undefined;
          if (fd && fd.format === "pdb") {
            pdbText = fd.text;
            try {
              const parsed = parsePdb(fd.text);
              metadata = {
                chains: parsed.chains,
                numAtoms: parsed.numAtoms,
                numResidues: parsed.numResidues,
                title: parsed.title || undefined,
              };
            } catch {}
          }
          addStructure({
            id: f.name,
            label: f.name,
            source: "file",
            loadedAt: Date.now(),
            pdbText,
            metadata,
          });
        }
        toast(`已加载 ${files.length} 个文件`, "success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`文件加载失败: ${msg}`, "error");
      } finally {
        setLoading(false);
      }
    },
    [viewer, addStructure, toast, setStructureFileCache]
  );

  const handleSnapshot = useCallback(async () => {
    if (!viewer) return;
    try {
      await executeCommand(viewer, {
        type: "export_snapshot",
        width: 1920,
        height: 1080,
      });
      toast("截图已下载", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`截图失败: ${msg}`, "error");
    }
  }, [viewer, toast]);

  const handleResetCamera = useCallback(async () => {
    if (!viewer) return;
    await executeCommand(viewer, { type: "reset_camera" });
    toast("视角已重置", "info");
  }, [viewer, toast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const id = pdbId.trim();
    if (!id) return;
    // Auto-detect source
    const upper = id.toUpperCase();
    if (upper.startsWith("EMD-")) {
      handleLoadPdb(upper, "emdb");
    } else if (upper.length === 4 && /^[A-Z0-9]{4}$/.test(upper)) {
      // 4-char PDB ID
      handleLoadPdb(upper, "pdb");
    } else if (/^[A-Z][0-9][A-Z0-9]{4,8}$/.test(upper) && upper.length >= 6) {
      // UniProt ID (6+ chars: letter + digit + alnum)
      handleLoadPdb(id, "alphafold");
    } else {
      // Default: try as PDB
      handleLoadPdb(upper, "pdb");
    }
    setPdbId("");
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      {/* Brand */}
      <div className="flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-primary to-primary/70 text-primary-foreground shadow-sm">
          <FlaskConical className="h-5 w-5" />
        </div>
        <div className="hidden flex-col leading-tight sm:flex">
          <span className="text-sm font-semibold tracking-tight">
            MolCraft AI
          </span>
          <span className="text-[10px] text-muted-foreground">
            结构分析 · 测量 · 作图 · LLM 协同
          </span>
        </div>
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      {/* PDB / structure loader */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={pdbId}
            onChange={(e) => setPdbId(e.target.value)}
            placeholder="PDB ID / UniProt / EMD-xxxx"
            className="h-9 w-56 pl-8 text-sm"
            disabled={loading || !viewer}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          className="h-9"
          disabled={loading || !viewer || !pdbId.trim()}
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Boxes className="mr-1.5 h-3.5 w-3.5" />
          )}
          加载
        </Button>
      </form>

      {/* Examples dropdown */}
      <Select
        onValueChange={(v) => {
          const ex = EXAMPLE_STRUCTURES.find((e) => e.id === v);
          if (ex) handleLoadPdb(ex.id, ex.source);
        }}
        disabled={loading || !viewer}
      >
        <SelectTrigger className="hidden h-9 w-44 text-sm md:flex">
          <SelectValue placeholder="加载示例结构" />
        </SelectTrigger>
        <SelectContent>
          {EXAMPLE_STRUCTURES.map((ex) => (
            <SelectItem key={ex.id} value={ex.id}>
              <div className="flex flex-col">
                <span className="font-medium">{ex.label}</span>
                <span className="text-xs text-muted-foreground">
                  {ex.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* File upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".pdb,.cif,.mmcif,.gro,.sdf,.mol2,.bcif,.pdb,.mol,.mmtf"
        className="hidden"
        onChange={(e) => handleFileUpload(e.target.files)}
      />
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => fileInputRef.current?.click()}
              disabled={!viewer}
            >
              <FileUp className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>上传本地结构文件</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Structure search (RCSB) */}
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => setShowSearch(true)}
              disabled={!viewer}
            >
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>RCSB 结构搜索</TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Spacer */}
      <div className="flex-1" />

      {/* ===== Global display controls (moved from UnifiedLeftPanel) ===== */}
      <div className="hidden items-center gap-1.5 lg:flex">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                <Layers className="mr-1 h-3.5 w-3.5 text-muted-foreground" />
                <Select
                  value={granularity}
                  onValueChange={(v) => {
                    setGranularity(v);
                    if (viewer) executeCommand(viewer, { type: "set_granularity", granularity: v });
                  }}
                >
                  <SelectTrigger className="h-8 w-24 text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SELECTION_GRANULARITY.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.label.split(" ")[0]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TooltipTrigger>
            <TooltipContent>选择粒度</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={handleResetCamera}
                disabled={!viewer}
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>重置视角</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={spin ? "default" : "ghost"}
                size="icon"
                className="h-9 w-9"
                onClick={() => {
                  if (!viewer) return;
                  const newSpin = !spin;
                  setSpin(newSpin);
                  executeCommand(viewer, {
                    type: newSpin ? "toggle_spin" : "stop_animation",
                    speed: 0.3,
                  });
                }}
                disabled={!viewer}
              >
                {spin ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{spin ? "停止旋转" : "自动旋转"}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={handleSnapshot}
                disabled={!viewer}
              >
                <ImageIcon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>下载 PNG 截图</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="mx-1 hidden h-6 w-px bg-border lg:block" />

      {/* Right cluster */}
      <div className="flex items-center gap-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setRightPanelTab("chat")}
              >
                <Sparkles className="h-4 w-4 text-primary" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>打开 AI 助手</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setRightPanelTab("reports")}
              >
                <Download className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>查看分析报告</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Background toggle */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={async () => {
                  if (!viewer) return;
                  const newDark = !viewerBgDark;
                  setViewerBgDark(newDark);
                  // Set background via Molstar canvas3d
                  const plugin = viewer.plugin as any;
                  const canvas3d = plugin.canvas3d;
                  if (canvas3d?.setProps) {
                    canvas3d.setProps((p: any) => {
                      p.renderer = p.renderer || {};
                      p.renderer.backgroundColor = newDark ? 0x0a0a0a : 0xffffff;
                    });
                  }
                  // Also set the viewer backdrop CSS
                  const backdrop = document.querySelector(".viewer-backdrop") as HTMLElement;
                  if (backdrop) {
                    backdrop.style.background = newDark ? "#0a0a0a" : "";
                  }
                }}
                disabled={!viewer}
              >
                {viewerBgDark ? (
                  <Sun className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {viewerBgDark ? "切换白底" : "切换黑底"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Language toggle */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => {
                  const newLang = getLang() === "zh" ? "en" : "zh";
                  setLang(newLang);
                  toast(newLang === "zh" ? "已切换到中文" : "Switched to English", "info");
                }}
              >
                <Languages className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {getLang() === "zh" ? "Switch to English" : "切换到中文"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Settings */}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setShowSettings(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>设置 (工具安装与管理)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {showSettings && <SettingsDialog onClose={() => setShowSettings(false)} />}
      {showSearch && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-16" onClick={() => setShowSearch(false)}>
          <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <StructureSearch />
          </div>
        </div>
      )}
    </header>
  );
}

// Unused but reserved for future "live mode" indicator
export function LiveIndicator({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Crosshair className="h-3 w-3 animate-spin text-primary" />
      live
    </div>
  );
}
