"use client";

import { useState, useRef } from "react";
import {
  Ruler,
  Palette,
  Zap,
  GitCompareArrows,
  Download,
  MousePointerClick,
  Loader2,
  Trash2,
  Box,
  Upload,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";
import {
  REPRESENTATION_PRESETS,
  REPRESENTATION_TYPES,
  COLOR_THEMES,
  SELECTION_GRANULARITY,
  COLOR_SWATCHES,
  SNAPSHOT_TYPES,
} from "@/lib/molstar/presets";
import type { LlmCommand, ResidueRef } from "@/lib/llm/command-schema";

export function ToolsPanel() {
  const [tab, setTab] = useState("display");

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <MousePointerClick className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">分析工具</span>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid h-auto w-full grid-cols-6 rounded-none border-b bg-transparent p-0">
          <TabsTrigger
            value="display"
            className="flex flex-col items-center gap-0.5 rounded-none border-b-2 border-transparent py-2 text-[10px] data-[state=active]:border-primary data-[state=active]:bg-accent/40"
          >
            <Palette className="h-3.5 w-3.5" />
            显示
          </TabsTrigger>
          <TabsTrigger
            value="measure"
            className="flex flex-col items-center gap-0.5 rounded-none border-b-2 border-transparent py-2 text-[10px] data-[state=active]:border-primary data-[state=active]:bg-accent/40"
          >
            <Ruler className="h-3.5 w-3.5" />
            测量
          </TabsTrigger>
          <TabsTrigger
            value="interactions"
            className="flex flex-col items-center gap-0.5 rounded-none border-b-2 border-transparent py-2 text-[10px] data-[state=active]:border-primary data-[state=active]:bg-accent/40"
          >
            <Zap className="h-3.5 w-3.5" />
            互作
          </TabsTrigger>
          <TabsTrigger
            value="align"
            className="flex flex-col items-center gap-0.5 rounded-none border-b-2 border-transparent py-2 text-[10px] data-[state=active]:border-primary data-[state=active]:bg-accent/40"
          >
            <GitCompareArrows className="h-3.5 w-3.5" />
            比对
          </TabsTrigger>
          <TabsTrigger
            value="volume"
            className="flex flex-col items-center gap-0.5 rounded-none border-b-2 border-transparent py-2 text-[10px] data-[state=active]:border-primary data-[state=active]:bg-accent/40"
          >
            <Box className="h-3.5 w-3.5" />
            体积
          </TabsTrigger>
          <TabsTrigger
            value="export"
            className="flex flex-col items-center gap-0.5 rounded-none border-b-2 border-transparent py-2 text-[10px] data-[state=active]:border-primary data-[state=active]:bg-accent/40"
          >
            <Download className="h-3.5 w-3.5" />
            导出
          </TabsTrigger>
        </TabsList>

        <ScrollArea className="flex-1 min-h-0 scrollbar-thin">
          <TabsContent value="display" className="m-0 p-3">
            <DisplayTab />
          </TabsContent>
          <TabsContent value="measure" className="m-0 p-3">
            <MeasureTab />
          </TabsContent>
          <TabsContent value="interactions" className="m-0 p-3">
            <InteractionsTab />
          </TabsContent>
          <TabsContent value="align" className="m-0 p-3">
            <AlignTab />
          </TabsContent>
          <TabsContent value="volume" className="m-0 p-3">
            <VolumeTab />
          </TabsContent>
          <TabsContent value="export" className="m-0 p-3">
            <ExportTab />
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </div>
  );
}

// ============================================================
// shared helper
// ============================================================

function useRunCommand() {
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const logCommand = useAppStore((s) => s.logCommand);
  const [busy, setBusy] = useState(false);

  const run = async (cmd: LlmCommand) => {
    if (!viewer) {
      toast("查看器尚未就绪", "error");
      return null;
    }
    setBusy(true);
    try {
      const res = await executeCommand(viewer, cmd);
      logCommand({ type: cmd.type, ok: res.ok, detail: res.detail });
      if (res.ok) {
        toast(res.detail ?? "完成", "success");
      } else {
        toast(res.detail ?? "失败", "error");
      }
      return res;
    } finally {
      setBusy(false);
    }
  };

  return { run, busy };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-1.5 first:mt-0">
      <div className="h-3 w-1 rounded-full bg-primary" />
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </h3>
    </div>
  );
}

// ============================================================
// Display tab
// ============================================================

function DisplayTab() {
  const { run, busy } = useRunCommand();
  const [preset, setPreset] = useState("polymer-and-ligand");
  const [colorTheme, setColorTheme] = useState("chain");
  const [uniformColor, setUniformColor] = useState("#10b981");
  const [granularity, setGranularity] = useState("residue");
  const [spin, setSpin] = useState(false);
  const [spinSpeed, setSpinSpeed] = useState(0.3);
  const [rock, setRock] = useState(false);

  return (
    <div className="space-y-3">
      <SectionTitle>表示方式 (Representation)</SectionTitle>
      <Select value={preset} onValueChange={setPreset}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {REPRESENTATION_PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              <div className="flex flex-col">
                <span className="font-medium">{p.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {p.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => run({ type: "set_representation", preset, structures: "all" })}
      >
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
        应用表示
      </Button>

      <SectionTitle>着色方案 (Color Theme)</SectionTitle>
      <Select value={colorTheme} onValueChange={setColorTheme}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {COLOR_THEMES.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <div className="flex flex-col">
                <span className="font-medium">{c.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {c.description}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        disabled={busy}
        onClick={() => run({ type: "set_color_theme", theme: colorTheme, structures: "all" })}
      >
        应用着色
      </Button>

      <SectionTitle>统一颜色</SectionTitle>
      <div className="grid grid-cols-4 gap-1.5">
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c.value}
            onClick={() => setUniformColor(`#${c.value.toString(16).padStart(6, "0")}`)}
            className={`aspect-square rounded-md border-2 transition ${
              uniformColor === `#${c.value.toString(16).padStart(6, "0")}`
                ? "border-foreground"
                : "border-transparent hover:border-muted-foreground/50"
            }`}
            style={{ backgroundColor: `#${c.value.toString(16).padStart(6, "0")}` }}
            title={c.name}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="color"
          value={uniformColor}
          onChange={(e) => setUniformColor(e.target.value)}
          className="h-9 w-12 cursor-pointer p-1"
        />
        <Input
          value={uniformColor}
          onChange={(e) => setUniformColor(e.target.value)}
          className="h-9 flex-1 font-mono text-sm"
        />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => run({ type: "set_uniform_color", color: uniformColor, structures: "all" })}
        >
          应用
        </Button>
      </div>

      <SectionTitle>选择粒度</SectionTitle>
      <Select value={granularity} onValueChange={(v) => { setGranularity(v); run({ type: "set_granularity", granularity: v }); }}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SELECTION_GRANULARITY.map((g) => (
            <SelectItem key={g.id} value={g.id}>
              {g.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <SectionTitle>动画</SectionTitle>
      <div className="space-y-2 rounded-lg border p-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="spin" className="text-sm">Spin 旋转</Label>
          <Switch
            id="spin"
            checked={spin}
            onCheckedChange={(v) => {
              setSpin(v);
              setRock(false);
              run({ type: v ? "toggle_spin" : "stop_animation", speed: spinSpeed });
            }}
          />
        </div>
        {spin && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground w-10">速度</span>
            <Slider
              value={[spinSpeed]}
              min={0.05}
              max={2}
              step={0.05}
              onValueChange={(v) => setSpinSpeed(v[0])}
              className="flex-1"
            />
            <span className="w-10 text-right font-mono text-[11px]">
              {spinSpeed.toFixed(2)}
            </span>
          </div>
        )}
        <Separator />
        <div className="flex items-center justify-between">
          <Label htmlFor="rock" className="text-sm">Rock 摇摆</Label>
          <Switch
            id="rock"
            checked={rock}
            onCheckedChange={(v) => {
              setRock(v);
              setSpin(false);
              run({ type: v ? "toggle_rock" : "stop_animation" });
            }}
          />
        </div>
      </div>

      <SectionTitle>视角</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" onClick={() => run({ type: "reset_camera" })}>
          重置
        </Button>
        <Button size="sm" variant="outline" onClick={() => run({ type: "focus_selection" })}>
          聚焦选择
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// Measure tab
// ============================================================

function ResidueInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ResidueRef;
  onChange: (v: ResidueRef) => void;
}) {
  return (
    <div className="rounded-lg border p-2">
      <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="grid grid-cols-3 gap-1.5">
        <div>
          <Label className="text-[10px] text-muted-foreground">Chain</Label>
          <Input
            value={value.chain ?? ""}
            onChange={(e) => onChange({ ...value, chain: e.target.value || undefined })}
            placeholder="A"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">ResNo</Label>
          <Input
            type="number"
            value={value.resno ?? ""}
            onChange={(e) =>
              onChange({ ...value, resno: e.target.value ? Number(e.target.value) : undefined })
            }
            placeholder="145"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">Atom</Label>
          <Input
            value={value.atom ?? ""}
            onChange={(e) => onChange({ ...value, atom: e.target.value || undefined })}
            placeholder="CA"
            className="h-8 text-sm"
          />
        </div>
      </div>
    </div>
  );
}

function MeasureTab() {
  const { run, busy } = useRunCommand();

  const [a, setA] = useState<ResidueRef>({ chain: "A", resno: 145, atom: "CA" });
  const [b, setB] = useState<ResidueRef>({ chain: "A", resno: 150, atom: "CA" });
  const [c, setC] = useState<ResidueRef>({ chain: "A", resno: 155, atom: "CA" });
  const [d, setD] = useState<ResidueRef>({ chain: "A", resno: 160, atom: "CA" });

  const [labelTarget, setLabelTarget] = useState<ResidueRef>({ chain: "A", resno: 145 });
  const [labelText, setLabelText] = useState("");

  return (
    <div className="space-y-3">
      <SectionTitle>距离测量 (Distance)</SectionTitle>
      <ResidueInput label="原子 A" value={a} onChange={setA} />
      <ResidueInput label="原子 B" value={b} onChange={setB} />
      <Button
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => run({ type: "measure_distance", a, b })}
      >
        测量 A–B 距离
      </Button>

      <SectionTitle>角度测量 (Angle)</SectionTitle>
      <ResidueInput label="原子 A" value={a} onChange={setA} />
      <ResidueInput label="原子 B" value={b} onChange={setB} />
      <ResidueInput label="原子 C" value={c} onChange={setC} />
      <Button
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => run({ type: "measure_angle", a, b, c })}
      >
        测量 ∠ABC
      </Button>

      <SectionTitle>二面角 (Dihedral)</SectionTitle>
      <ResidueInput label="原子 A" value={a} onChange={setA} />
      <ResidueInput label="原子 B" value={b} onChange={setB} />
      <ResidueInput label="原子 C" value={c} onChange={setC} />
      <ResidueInput label="原子 D" value={d} onChange={setD} />
      <Button
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => run({ type: "measure_dihedral", a, b, c, d })}
      >
        测量 A–B–C–D 二面角
      </Button>

      <SectionTitle>标签 (Label)</SectionTitle>
      <ResidueInput label="目标残基" value={labelTarget} onChange={setLabelTarget} />
      <Input
        value={labelText}
        onChange={(e) => setLabelText(e.target.value)}
        placeholder="标签文本（可留空）"
        className="h-9 text-sm"
      />
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        disabled={busy}
        onClick={() => run({ type: "label_residue", target: labelTarget, text: labelText || undefined })}
      >
        添加标签
      </Button>

      <SectionTitle>清除</SectionTitle>
      <Button
        size="sm"
        variant="destructive"
        className="w-full"
        onClick={() => run({ type: "clear_measurements" })}
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        清除所有测量
      </Button>
    </div>
  );
}

// ============================================================
// Interactions tab
// ============================================================

function InteractionsTab() {
  const { run, busy } = useRunCommand();
  const [target, setTarget] = useState<ResidueRef>({ chain: "A", resno: 145 });
  const [radius, setRadius] = useState(8);

  // Detailed analysis (recipes)
  const structures = useAppStore((s) => s.structures);
  const primaryPdbId = structures[0]?.id;
  const [analysisChain1, setAnalysisChain1] = useState("A");
  const [analysisChain2, setAnalysisChain2] = useState("B");
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);
  const [analysisKind, setAnalysisKind] = useState<
    "hbonds" | "salt_bridges" | "hydrophobic_contacts" | null
  >(null);

  const runDetailedAnalysis = async (
    recipe: "hbonds" | "salt_bridges" | "hydrophobic_contacts"
  ) => {
    if (!primaryPdbId) {
      useAppStore.getState().toast("请先加载一个 PDB 结构", "error");
      return;
    }
    setAnalysisKind(recipe);
    setAnalysisResult(null);
    try {
      const res = await fetch("/api/analyze/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pdbId: primaryPdbId,
          recipe,
          params: {
            chain1: analysisChain1,
            chain2: analysisChain2,
            ...(recipe === "hbonds"
              ? { distanceCutoff: 3.5 }
              : { cutoff: recipe === "salt_bridges" ? 4.0 : 4.5 }),
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.data) {
        if (recipe === "hbonds") {
          const d = data.data;
          setAnalysisResult(
            `氢键总数: ${d.total_hbonds}\nTop 残基对:\n${(d.top_residue_pairs || [])
              .slice(0, 5)
              .map((p: { pair: string; count: number }) => `  ${p.pair}: ${p.count}`)
              .join("\n")}`
          );
        } else if (recipe === "salt_bridges") {
          const d = data.data;
          setAnalysisResult(
            `盐桥总数: ${d.total_salt_bridges}\n${(d.salt_bridges || [])
              .slice(0, 5)
              .map(
                (b: {
                  pos_resname: string;
                  pos_resno: number;
                  pos_chain: string;
                  neg_resname: string;
                  neg_resno: number;
                  neg_chain: string;
                  distance_A: number;
                }) =>
                  `  ${b.pos_resname}${b.pos_resno}(${b.pos_chain}) ↔ ${b.neg_resname}${b.neg_resno}(${b.neg_chain}): ${b.distance_A}Å`
              )
              .join("\n")}`
          );
        } else {
          const d = data.data;
          setAnalysisResult(
            `原子接触数: ${d.total_atom_contacts}\n残基对数: ${d.total_residue_pairs}\nTop 残基对:\n${(d.top_residue_pairs || [])
              .slice(0, 5)
              .map((p: { pair: string; contacts: number }) => `  ${p.pair}: ${p.contacts} 接触`)
              .join("\n")}`
          );
        }
      } else {
        setAnalysisResult(`无数据 (stderr: ${data.stderr ?? "none"})`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAnalysisResult(`错误: ${msg}`);
    } finally {
      setAnalysisKind(null);
    }
  };

  return (
    <div className="space-y-3">
      <SectionTitle>非共价相互作用 (查看器可视化)</SectionTitle>
      <p className="rounded-lg bg-accent/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        在 3D 查看器中显示指定残基周围半径范围内的所有相互作用：
        <span className="font-medium text-foreground"> 氢键、盐桥、疏水接触、π-堆积、阳离子-π、卤键、金属配位</span>。
      </p>
      <ResidueInput label="中心残基" value={target} onChange={setTarget} />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-sm">半径 (Å)</Label>
          <span className="font-mono text-sm">{radius.toFixed(1)}</span>
        </div>
        <Slider
          value={[radius]}
          min={3}
          max={20}
          step={0.5}
          onValueChange={(v) => setRadius(v[0])}
        />
      </div>

      <Button
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => run({ type: "show_interactions", target, radius })}
      >
        <Zap className="mr-1.5 h-3.5 w-3.5" />
        显示相互作用
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => run({ type: "show_interactions", target: "selection", radius })}
        >
          基于选择
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => run({ type: "show_interactions", target: "ligand", radius })}
        >
          基于配体
        </Button>
      </div>

      <SectionTitle>详细互作分析 (本地 Biopython)</SectionTitle>
      <p className="rounded-lg bg-primary/5 p-2 text-[10px] leading-relaxed text-muted-foreground">
        使用本地 Biopython 对两条链之间的特定相互作用进行精确检测，返回原子级详情和残基对统计。
      </p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground">链 1</Label>
          <Input
            value={analysisChain1}
            onChange={(e) => setAnalysisChain1(e.target.value)}
            className="h-8 text-sm font-mono"
          />
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground">链 2</Label>
          <Input
            value={analysisChain2}
            onChange={(e) => setAnalysisChain2(e.target.value)}
            className="h-8 text-sm font-mono"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Button
          size="sm"
          variant="outline"
          className="flex flex-col items-center gap-0.5 py-2 text-[10px]"
          disabled={analysisKind !== null || !primaryPdbId}
          onClick={() => runDetailedAnalysis("hbonds")}
        >
          {analysisKind === "hbonds" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-sky-500" />
          )}
          氢键
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex flex-col items-center gap-0.5 py-2 text-[10px]"
          disabled={analysisKind !== null || !primaryPdbId}
          onClick={() => runDetailedAnalysis("salt_bridges")}
        >
          {analysisKind === "salt_bridges" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-amber-500" />
          )}
          盐桥
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex flex-col items-center gap-0.5 py-2 text-[10px]"
          disabled={analysisKind !== null || !primaryPdbId}
          onClick={() => runDetailedAnalysis("hydrophobic_contacts")}
        >
          {analysisKind === "hydrophobic_contacts" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-emerald-600" />
          )}
          疏水
        </Button>
      </div>

      {analysisResult && (
        <div className="rounded-lg border bg-emerald-500/5 p-2.5">
          <div className="mb-1 text-[10px] font-medium text-muted-foreground">
            分析结果
          </div>
          <pre className="whitespace-pre-wrap font-mono text-[10px] leading-relaxed">
            {analysisResult}
          </pre>
        </div>
      )}

      <SectionTitle>互作类型图例</SectionTitle>
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        {[
          { name: "氢键", color: "bg-sky-500" },
          { name: "盐桥", color: "bg-amber-500" },
          { name: "疏水接触", color: "bg-emerald-600" },
          { name: "π-堆积", color: "bg-violet-500" },
          { name: "阳离子-π", color: "bg-rose-500" },
          { name: "卤键", color: "bg-cyan-400" },
          { name: "金属配位", color: "bg-fuchsia-500" },
          { name: "水桥", color: "bg-blue-300" },
        ].map((x) => (
          <div key={x.name} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${x.color}`} />
            <span className="text-muted-foreground">{x.name}</span>
          </div>
        ))}
      </div>

      <SectionTitle>清除</SectionTitle>
      <Button
        size="sm"
        variant="destructive"
        className="w-full"
        onClick={() => run({ type: "clear_interactions" })}
      >
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
        清除相互作用
      </Button>
    </div>
  );
}

// ============================================================
// Align tab
// ============================================================

function AlignTab() {
  const { run, busy } = useRunCommand();
  const structures = useAppStore((s) => s.structures);
  const [refIdx, setRefIdx] = useState("0");
  const [mobIdx, setMobIdx] = useState("1");
  const [method, setMethod] = useState<"superpose" | "tm-align">("tm-align");
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <SectionTitle>结构比对 (Superposition)</SectionTitle>
      <p className="rounded-lg bg-accent/30 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
        将两个已加载的结构在 3D 空间中叠合。<span className="font-medium text-foreground">TM-align</span> 会先做序列比对再叠合并返回 TM-score / RMSD。
      </p>

      {structures.length < 2 ? (
        <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          需要至少加载 2 个结构才能进行比对。
          <br />
          当前已加载 {structures.length} 个。
        </div>
      ) : (
        <>
          <div>
            <Label className="text-xs">参考结构 (Reference)</Label>
            <Select value={refIdx} onValueChange={setRefIdx}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {structures.map((s, i) => (
                  <SelectItem key={s.id} value={String(i)}>
                    [{i}] {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">移动结构 (Mobile)</Label>
            <Select value={mobIdx} onValueChange={setMobIdx}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {structures.map((s, i) => (
                  <SelectItem key={s.id} value={String(i)}>
                    [{i}] {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">方法</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as "superpose" | "tm-align")}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tm-align">TM-align (返回 TM-score)</SelectItem>
                <SelectItem value="superpose">Superpose (序列已知)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            size="sm"
            className="w-full"
            disabled={busy || refIdx === mobIdx}
            onClick={async () => {
              const res = await run({
                type: "align_structures",
                ref: Number(refIdx),
                mobile: Number(mobIdx),
                method,
              });
              if (res?.data) {
                const d = res.data as { tmScore?: number; rmsd?: number };
                setResult(
                  `TM-score: ${d.tmScore?.toFixed(3) ?? "N/A"} · RMSD: ${d.rmsd?.toFixed(2) ?? "N/A"} Å`
                );
              }
            }}
          >
            <GitCompareArrows className="mr-1.5 h-3.5 w-3.5" />
            执行比对
          </Button>

          {result && (
            <div className="rounded-lg border bg-emerald-500/5 p-3 text-sm">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">比对结果</div>
              <div className="font-mono text-sm">{result}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Volume tab
// ============================================================

const VOLUME_PRESETS = [
  {
    id: "emd-30210",
    label: "EMD-30210 (EM)",
    url: "https://www.ebi.ac.uk/pdbe/densities/em/emd-30210/cell?detail=6",
    format: "dscif",
    isBinary: true,
    defaultIso: 0.05,
    entryId: "EMD-30210",
  },
  {
    id: "1tqn-xray",
    label: "1TQN X-ray 2Fo-Fc",
    url: "https://www.ebi.ac.uk/pdbe/densities/x-ray/1tqn/cell?detail=3",
    format: "dscif",
    isBinary: true,
    defaultIso: 1.5,
    entryId: "2FO-FC",
  },
];

const VOLUME_COLORS = [
  { name: "Cyan", value: 0x3377aa },
  { name: "Blue", value: 0x3362b2 },
  { name: "Green", value: 0x33bb33 },
  { name: "Red", value: 0xbb3333 },
  { name: "Magenta", value: 0xaa3377 },
  { name: "Orange", value: 0xff7733 },
];

function VolumeTab() {
  const { run, busy } = useRunCommand();
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [emdbId, setEmdbId] = useState("");
  const [detail, setDetail] = useState(3);
  const [isoValue, setIsoValue] = useState(0.05);
  const [colorIdx, setColorIdx] = useState(0);
  const [opacity, setOpacity] = useState(0.5);
  const [loadedVolumes, setLoadedVolumes] = useState<
    Array<{ id: string; iso: number; color: string }>
  >([]);

  const handleLoadEmdb = async () => {
    if (!viewer) {
      toast("查看器未就绪", "error");
      return;
    }
    const id = emdbId.trim().toUpperCase();
    if (!id) {
      toast("请输入 EMDB ID", "error");
      return;
    }
    const emdbNum = id.replace(/^EMD-?/i, "");
    const url = `https://www.ebi.ac.uk/pdbe/densities/em/emd-${emdbNum.toLowerCase()}/cell?detail=${detail}`;
    try {
      await run({
        type: "load_volume_url",
        url,
        format: "dscif",
        isBinary: true,
        isoValue,
        color: `#${VOLUME_COLORS[colorIdx].value.toString(16).padStart(6, "0")}`,
      });
      setLoadedVolumes((prev) => [
        ...prev,
        {
          id: `EMD-${emdbNum}`,
          iso: isoValue,
          color: VOLUME_COLORS[colorIdx].name,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`加载失败: ${msg}`, "error");
    }
  };

  const handleLoadPreset = async (preset: (typeof VOLUME_PRESETS)[0]) => {
    if (!viewer) return;
    try {
      await run({
        type: "load_volume_url",
        url: preset.url,
        format: preset.format,
        isBinary: preset.isBinary,
        isoValue: preset.defaultIso,
        color: `#${VOLUME_COLORS[colorIdx].value.toString(16).padStart(6, "0")}`,
      });
      setLoadedVolumes((prev) => [
        ...prev,
        {
          id: preset.entryId,
          iso: preset.defaultIso,
          color: VOLUME_COLORS[colorIdx].name,
        },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`加载失败: ${msg}`, "error");
    }
  };

  return (
    <div className="space-y-3">
      <SectionTitle>加载密度图</SectionTitle>
      <p className="rounded-lg bg-primary/5 p-2 text-[10px] leading-relaxed text-muted-foreground">
        从 PDBe Density Server 加载冷冻电镜或 X-射线密度图，叠加显示在结构上。可调整 iso level 控制等值面。
      </p>

      <div>
        <Label className="text-xs">EMDB ID</Label>
        <div className="flex gap-2">
          <Input
            value={emdbId}
            onChange={(e) => setEmdbId(e.target.value)}
            placeholder="EMD-30210"
            className="h-9 flex-1 text-sm"
          />
          <Button
            size="sm"
            className="h-9"
            disabled={busy || !viewer || !emdbId.trim()}
            onClick={handleLoadEmdb}
          >
            <Box className="mr-1.5 h-3.5 w-3.5" />
            加载
          </Button>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Detail (0-6)</Label>
          <span className="font-mono text-xs">{detail}</span>
        </div>
        <Slider
          value={[detail]}
          min={0}
          max={6}
          step={1}
          onValueChange={(v) => setDetail(v[0])}
          className="mt-1"
        />
        <div className="flex justify-between text-[9px] text-muted-foreground">
          <span>低 (快)</span>
          <span>高 (慢)</span>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Iso Level</Label>
          <span className="font-mono text-xs">{isoValue.toFixed(3)}</span>
        </div>
        <Slider
          value={[isoValue]}
          min={0.01}
          max={2}
          step={0.01}
          onValueChange={(v) => setIsoValue(v[0])}
          className="mt-1"
        />
      </div>

      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs">Opacity</Label>
          <span className="font-mono text-xs">{opacity.toFixed(2)}</span>
        </div>
        <Slider
          value={[opacity]}
          min={0.1}
          max={1}
          step={0.05}
          onValueChange={(v) => setOpacity(v[0])}
          className="mt-1"
        />
      </div>

      <div>
        <Label className="text-xs">颜色</Label>
        <div className="grid grid-cols-6 gap-1">
          {VOLUME_COLORS.map((c, i) => (
            <button
              key={c.name}
              onClick={() => setColorIdx(i)}
              className={`aspect-square rounded-md border-2 transition ${
                colorIdx === i ? "border-foreground" : "border-transparent hover:border-muted-foreground/50"
              }`}
              style={{ backgroundColor: `#${c.value.toString(16).padStart(6, "0")}` }}
              title={c.name}
            />
          ))}
        </div>
      </div>

      <SectionTitle>快速加载预设</SectionTitle>
      <div className="space-y-1.5">
        {VOLUME_PRESETS.map((p) => (
          <button
            key={p.id}
            onClick={() => handleLoadPreset(p)}
            disabled={busy || !viewer}
            className="flex w-full items-center justify-between rounded-lg border p-2.5 text-left transition hover:border-primary/50 hover:bg-accent/30 disabled:opacity-50"
          >
            <div>
              <div className="text-xs font-medium">{p.label}</div>
              <div className="font-mono text-[9px] text-muted-foreground">
                iso: {p.defaultIso} · {p.format}
              </div>
            </div>
            <Box className="h-3.5 w-3.5 text-primary" />
          </button>
        ))}
      </div>

      {loadedVolumes.length > 0 && (
        <>
          <SectionTitle>已加载密度图 ({loadedVolumes.length})</SectionTitle>
          <div className="space-y-1">
            {loadedVolumes.map((v, i) => (
              <div
                key={i}
                className="flex items-center justify-between rounded-md border bg-accent/20 px-2 py-1.5 text-[11px]"
              >
                <span className="font-mono">{v.id}</span>
                <span className="text-muted-foreground">
                  iso: {v.iso} · {v.color}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <Separator />
      <div className="text-[10px] text-muted-foreground">
        <Badge variant="outline" className="mr-1">提示</Badge>
        EM 密度图来自 PDBe Density Server，detail=6 为最高分辨率（加载较慢）；X-射线密度图通常有 2Fo-Fc 和 Fo-Fc 两套。
      </div>
    </div>
  );
}

// ============================================================
// Export tab
// ============================================================

function ExportTab() {
  const { run, busy } = useRunCommand();
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [snapshotType, setSnapshotType] = useState<"molj" | "molx">("molj");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSessionSave = async () => {
    if (!viewer) return;
    try {
      await viewer.plugin.managers.snapshots?.downloadToFile(snapshotType);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      useAppStore.getState().toast(`保存失败: ${msg}`, "error");
    }
  };

  const handleSessionRestore = async (files: FileList | null) => {
    if (!viewer || !files || files.length === 0) return;
    const file = files[0];
    const name = file.name.toLowerCase();
    const ext = name.endsWith(".molx") ? "molx" : "molj";
    try {
      await viewer.plugin.managers.snapshots?.openFile(file);
      toast(`会话已恢复 (${ext})`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`恢复失败: ${msg}`, "error");
    }
  };

  const handleSnapshotFromUrl = async () => {
    if (!viewer) return;
    const url = window.prompt("输入会话文件 URL (.molj 或 .molx):");
    if (!url) return;
    const ext = url.toLowerCase().endsWith(".molx") ? "molx" : "molj";
    try {
      await viewer.plugin.managers.snapshots?.openUrl(url, ext);
      toast(`会话已从 URL 恢复`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`恢复失败: ${msg}`, "error");
    }
  };

  return (
    <div className="space-y-3">
      <SectionTitle>PNG 截图</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs">宽度</Label>
          <Input
            type="number"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
            className="h-9 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">高度</Label>
          <Input
            type="number"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
            className="h-9 text-sm"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {[
          { label: "720p", w: 1280, h: 720 },
          { label: "1080p", w: 1920, h: 1080 },
          { label: "4K", w: 3840, h: 2160 },
        ].map((p) => (
          <Button
            key={p.label}
            size="sm"
            variant="outline"
            onClick={() => {
              setWidth(p.w);
              setHeight(p.h);
            }}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <Button
        size="sm"
        className="w-full"
        disabled={busy}
        onClick={() => run({ type: "export_snapshot", width, height })}
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        下载 PNG
      </Button>

      <SectionTitle>会话保存 (Session)</SectionTitle>
      <Select value={snapshotType} onValueChange={(v) => setSnapshotType(v as "molj" | "molx")}>
        <SelectTrigger className="h-9 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SNAPSHOT_TYPES.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <div className="flex flex-col">
                <span className="font-medium">{t.label}</span>
                <span className="text-[11px] text-muted-foreground">{t.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        onClick={handleSessionSave}
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        保存会话
      </Button>

      <SectionTitle>会话恢复 (Restore)</SectionTitle>
      <input
        ref={fileInputRef}
        type="file"
        accept=".molj,.molx"
        className="hidden"
        onChange={(e) => handleSessionRestore(e.target.files)}
      />
      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        onClick={() => fileInputRef.current?.click()}
        disabled={!viewer}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        从文件恢复
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={handleSnapshotFromUrl}
        disabled={!viewer}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        从 URL 恢复
      </Button>

      <Separator />
      <div className="text-[11px] text-muted-foreground">
        <Badge variant="outline" className="mr-1">提示</Badge>
        截图分辨率不受浏览器窗口限制；4K 截图需要稍等几秒。会话文件可保存当前所有结构、表示、测量、视角状态。
      </div>
    </div>
  );
}
