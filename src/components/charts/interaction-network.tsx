"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Network,
  RefreshCw,
  Loader2,
  Info,
  Maximize2,
  Download,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAppStore, selectActiveStructure } from "@/lib/store";
import { executeCommand } from "@/lib/molstar/commands";

interface InteractionNode {
  id: string; // "A:ALA30" or "B:ARG31"
  chain: string;
  resno: number;
  resname: string;
  x: number;
  y: number;
  degree: number;
}

interface InteractionEdge {
  source: string;
  target: string;
  type: "hbond" | "saltbridge" | "hydrophobic";
  distance: number;
  count: number;
}

interface GraphData {
  nodes: InteractionNode[];
  edges: InteractionEdge[];
}

type InteractionKind = "hbonds" | "salt_bridges" | "hydrophobic_contacts";

const EDGE_COLORS: Record<InteractionKind, string> = {
  hbonds: "#0ea5e9", // sky-500
  salt_bridges: "#f59e0b", // amber-500
  hydrophobic_contacts: "#10b981", // emerald-500
};

const EDGE_LABELS: Record<InteractionKind, string> = {
  hbonds: "氢键",
  salt_bridges: "盐桥",
  hydrophobic_contacts: "疏水",
};

const CHAIN_COLORS = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#84cc16", // lime
];

export function InteractionNetwork() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const viewer = useAppStore((s) => s.viewer);
  const toast = useAppStore((s) => s.toast);
  const [chain1, setChain1] = useState("A");
  const [chain2, setChain2] = useState("B");
  const [activeKind, setActiveKind] = useState<InteractionKind | null>(null);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<InteractionNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgSize, setSvgSize] = useState({ w: 320, h: 280 });
  const animationRef = useRef<number | null>(null);
  const positionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.min(entries[0].contentRect.width, 360);
      setSvgSize({ w, h: Math.max(260, w * 0.85) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fetchInteractions = useCallback(
    async (kind: InteractionKind) => {
      if (!activeId) {
        toast("请先加载一个结构", "error");
        return;
      }
      setActiveKind(kind);
      setGraph(null);
      setError(null);
      try {
        // Use Mills-Dean params for hbonds, standard cutoffs for others
        const params =
          kind === "hbonds"
            ? { chain1, chain2, distanceCutoff: 0.4, angleTolerance: 20.0 }
            : {
                chain1,
                chain2,
                cutoff: kind === "salt_bridges" ? 4.0 : 4.5,
              };
        const body: Record<string, unknown> = {
          recipe: kind,
          params,
        };
        if (isPdbId) {
          body.pdbId = activeId;
        } else if (hasFileCache) {
          body.fileContent = structureFileCache[activeId].content;
          body.fileFormat = structureFileCache[activeId].format;
        } else {
          setError(
            `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法运行互作分析。请上传本地 .pdb/.cif 文件后再试。`
          );
          setActiveKind(null);
          return;
        }
        const res = await fetch("/api/analyze/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        if (!json.data) {
          setError(json.stderr || "无数据返回");
          return;
        }
        if (json.data.error) {
          setError(`分析失败: ${json.data.error}`);
          return;
        }
        const g = parseInteractionData(json.data, kind, chain1, chain2);
        if (g.nodes.length === 0) {
          setError("未检测到该类型相互作用");
          return;
        }
        // Initialize positions in a circle
        const cx = svgSize.w / 2;
        const cy = svgSize.h / 2;
        const r = Math.min(svgSize.w, svgSize.h) * 0.35;
        positionsRef.current = new Map();
        g.nodes.forEach((node, i) => {
          const angle = (i / g.nodes.length) * Math.PI * 2;
          positionsRef.current.set(node.id, {
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
            vx: 0,
            vy: 0,
          });
        });
        setGraph(g);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        toast(`互作分析失败: ${msg}`, "error");
      } finally {
        setActiveKind(null);
      }
    },
    [activeId, isPdbId, hasFileCache, structureFileCache, chain1, chain2, svgSize, toast]
  );

  // Force-directed layout simulation (simple)
  useEffect(() => {
    if (!graph) return;
    const { w, h } = svgSize;
    const cx = w / 2;
    const cy = h / 2;
    const maxIter = 200;
    let iter = 0;

    const tick = () => {
      const positions = positionsRef.current;
      if (!positions || positions.size === 0) return;
      const k = 0.06; // temperature
      const repulsion = 800;
      const attraction = 0.02;
      const edgeLen = 50;

      // Reset forces
      positions.forEach((p) => {
        p.vx = 0;
        p.vy = 0;
      });

      // Repulsion (all pairs)
      const nodes = Array.from(positions.entries());
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const [idA, pA] = nodes[i];
          const [idB, pB] = nodes[j];
          let dx = pA.x - pB.x;
          let dy = pA.y - pB.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          const force = repulsion / (dist * dist);
          dx = (dx / dist) * force;
          dy = (dy / dist) * force;
          pA.vx += dx;
          pA.vy += dy;
          pB.vx -= dx;
          pB.vy -= dy;
        }
      }

      // Attraction (edges)
      const edgeMap = new Set<string>();
      graph.edges.forEach((e) => {
        edgeMap.add(`${e.source}|${e.target}`);
        const pA = positions.get(e.source);
        const pB = positions.get(e.target);
        if (!pA || !pB) return;
        let dx = pB.x - pA.x;
        let dy = pB.y - pA.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const force = (dist - edgeLen) * attraction;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        pA.vx += dx;
        pA.vy += dy;
        pB.vx -= dx;
        pB.vy -= dy;
      });

      // Center gravity + boundary
      positions.forEach((p) => {
        p.vx += (cx - p.x) * 0.005;
        p.vy += (cy - p.y) * 0.005;
        p.x += p.vx * k;
        p.y += p.vy * k;
        // Boundary
        const margin = 20;
        p.x = Math.max(margin, Math.min(w - margin, p.x));
        p.y = Math.max(margin, Math.min(h - margin, p.y));
      });

      iter++;
      // Trigger re-render by updating state (shallow copy)
      if (iter < maxIter) {
        // Force update via state
        setGraph((prev) => (prev ? { ...prev, nodes: prev.nodes.map((n) => ({ ...n, x: positions.get(n.id)?.x ?? n.x, y: positions.get(n.id)?.y ?? n.y })) } : prev));
        animationRef.current = requestAnimationFrame(tick);
      } else if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [graph?.nodes.length, svgSize.w, svgSize.h]);

  const handleNodeClick = async (node: InteractionNode) => {
    setSelectedNode(node.id);
    if (!viewer) return;
    try {
      await executeCommand(viewer, {
        type: "focus_residue",
        chain: node.chain,
        resno: node.resno,
      });
      toast(`聚焦 ${node.resname}${node.resno} (${node.chain})`, "info");
    } catch {
      toast("聚焦失败", "error");
    }
  };

  const chainColor = (chain: string) => {
    const idx = chain.charCodeAt(0) - 65;
    return CHAIN_COLORS[idx % CHAIN_COLORS.length] ?? "#999";
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Network className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">互作网络</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {graph && (
            <Badge variant="secondary" className="text-[10px]">
              {graph.nodes.length} 节点 · {graph.edges.length} 边
            </Badge>
          )}
          {graph && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                const svg = svgRef.current;
                if (!svg) return;
                const serializer = new XMLSerializer();
                const svgStr = serializer.serializeToString(svg);
                const blob = new Blob([svgStr], { type: "image/svg+xml" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.download = `interaction-network-${activeId ?? "graph"}.svg`;
                link.href = url;
                link.click();
                URL.revokeObjectURL(url);
              }}
              title="导出 SVG"
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-2 p-3">
        {/* Chain inputs */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-[10px] text-muted-foreground">链 1</Label>
            <Input
              value={chain1}
              onChange={(e) => setChain1(e.target.value.toUpperCase())}
              className="h-8 text-sm font-mono"
              maxLength={2}
            />
          </div>
          <div>
            <Label className="text-[10px] text-muted-foreground">链 2</Label>
            <Input
              value={chain2}
              onChange={(e) => setChain2(e.target.value.toUpperCase())}
              className="h-8 text-sm font-mono"
              maxLength={2}
            />
          </div>
        </div>

        {/* Interaction type buttons */}
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(EDGE_LABELS) as InteractionKind[]).map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant="outline"
              className="flex flex-col items-center gap-0.5 py-2 text-[10px]"
              disabled={activeKind !== null || !activeId}
              onClick={() => fetchInteractions(kind)}
            >
              {activeKind === kind ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: EDGE_COLORS[kind] }}
                />
              )}
              {EDGE_LABELS[kind]}
            </Button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {/* SVG graph */}
        {graph && (
          <div ref={containerRef} className="flex justify-center">
            <svg
              ref={svgRef}
              width={svgSize.w}
              height={svgSize.h}
              className="rounded-md border bg-white shadow-sm"
            >
              {/* Edges */}
              {graph.edges.map((edge, i) => {
                const s = positionsRef.current.get(edge.source);
                const t = positionsRef.current.get(edge.target);
                if (!s || !t) return null;
                return (
                  <line
                    key={i}
                    x1={s.x}
                    y1={s.y}
                    x2={t.x}
                    y2={t.y}
                    stroke={EDGE_COLORS[edge.type] ?? "#999"}
                    strokeWidth={Math.min(1 + edge.count * 0.5, 4)}
                    strokeOpacity={0.5}
                  />
                );
              })}
              {/* Nodes */}
              {graph.nodes.map((node) => {
                const p = positionsRef.current.get(node.id);
                if (!p) return null;
                const isHovered = hoveredNode?.id === node.id;
                const isSelected = selectedNode === node.id;
                const r = 4 + Math.min(node.degree * 1.5, 8);
                return (
                  <g key={node.id}>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={r}
                      fill={chainColor(node.chain)}
                      stroke={isSelected ? "#000" : "#fff"}
                      strokeWidth={isSelected ? 2 : 1}
                      className="cursor-pointer transition-all"
                      style={{
                        filter: isHovered
                          ? "drop-shadow(0 0 4px rgba(0,0,0,0.4))"
                          : undefined,
                      }}
                      onMouseEnter={() => setHoveredNode(node)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={() => handleNodeClick(node)}
                    />
                    {(isHovered || isSelected || node.degree >= 3) && (
                      <text
                        x={p.x}
                        y={p.y - r - 3}
                        textAnchor="middle"
                        fontSize={8}
                        fontFamily="ui-monospace, monospace"
                        fill="#374151"
                        className="pointer-events-none select-none"
                      >
                        {node.resname}
                        {node.resno}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Hovered node info */}
        {hoveredNode && (
          <div className="rounded-md border bg-accent/30 px-2.5 py-1.5 text-[10px]">
            <span className="font-mono font-medium">
              {hoveredNode.resname}
              {hoveredNode.resno} ({hoveredNode.chain})
            </span>
            <span className="ml-2 text-muted-foreground">
              度: {hoveredNode.degree} · 点击聚焦
            </span>
          </div>
        )}

        {/* Legend */}
        {graph && (
          <div className="flex flex-wrap items-center gap-2 text-[10px]">
            <span className="text-muted-foreground">边类型:</span>
            {(Object.keys(EDGE_LABELS) as InteractionKind[]).map((kind) => (
              <div key={kind} className="flex items-center gap-1">
                <span
                  className="h-0.5 w-4"
                  style={{ backgroundColor: EDGE_COLORS[kind] }}
                />
                <span className="text-muted-foreground">
                  {EDGE_LABELS[kind]}
                </span>
              </div>
            ))}
            <span className="ml-2 text-muted-foreground">| 链颜色:</span>
            {Array.from(
              new Set(graph.nodes.map((n) => n.chain))
            ).map((chain) => (
              <div key={chain} className="flex items-center gap-1">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: chainColor(chain) }}
                />
                <span className="font-mono">{chain}</span>
              </div>
            ))}
          </div>
        )}

        {/* Hint */}
        {!graph && !error && (
          <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <div>
              选择两条链和互作类型，生成力导向网络图。节点大小反映连接度，边粗细反映接触数。点击节点在查看器中聚焦。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Parse the recipe output into a graph data structure. */
function parseInteractionData(
  data: Record<string, unknown>,
  kind: InteractionKind,
  chain1: string,
  chain2: string
): GraphData {
  const nodeMap = new Map<string, InteractionNode>();
  const edges: InteractionEdge[] = [];
  const edgeCount = new Map<string, number>();

  const ensureNode = (
    chain: string,
    resno: number,
    resname: string
  ): InteractionNode => {
    const id = `${chain}:${resname}${resno}`;
    if (!nodeMap.has(id)) {
      nodeMap.set(id, {
        id,
        chain,
        resno,
        resname,
        x: 0,
        y: 0,
        degree: 0,
      });
    }
    return nodeMap.get(id)!;
  };

  if (kind === "hbonds") {
    const hbonds = (data.hbonds as Array<Record<string, unknown>>) ?? [];
    for (const h of hbonds) {
      const dChain = String(h.donor_chain ?? "");
      const dResno = Number(h.donor_resno ?? 0);
      const dResname = String(h.donor_resname ?? "");
      const aChain = String(h.acceptor_chain ?? "");
      const aResno = Number(h.acceptor_resno ?? 0);
      const aResname = String(h.acceptor_resname ?? "");
      if (!dResno || !aResno) continue;
      const n1 = ensureNode(dChain, dResno, dResname);
      const n2 = ensureNode(aChain, aResno, aResname);
      const key = [n1.id, n2.id].sort().join("|");
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      edges.push({
        source: n1.id,
        target: n2.id,
        type: "hbond",
        distance: Number(h.distance_A ?? 0),
        count: 1,
      });
    }
  } else if (kind === "salt_bridges") {
    const bridges = (data.salt_bridges as Array<Record<string, unknown>>) ?? [];
    for (const b of bridges) {
      const pChain = String(b.pos_chain ?? "");
      const pResno = Number(b.pos_resno ?? 0);
      const pResname = String(b.pos_resname ?? "");
      const nChain = String(b.neg_chain ?? "");
      const nResno = Number(b.neg_resno ?? 0);
      const nResname = String(b.neg_resname ?? "");
      if (!pResno || !nResno) continue;
      const n1 = ensureNode(pChain, pResno, pResname);
      const n2 = ensureNode(nChain, nResno, nResname);
      const key = [n1.id, n2.id].sort().join("|");
      edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      edges.push({
        source: n1.id,
        target: n2.id,
        type: "saltbridge",
        distance: Number(b.distance_A ?? 0),
        count: 1,
      });
    }
  } else {
    // hydrophobic_contacts — has top_residue_pairs
    const pairs =
      (data.top_residue_pairs as Array<Record<string, unknown>>) ?? [];
    for (const p of pairs) {
      const pairStr = String(p.pair ?? "");
      // Parse "PHE47(K) <-> VAL112(L)"
      const match = pairStr.match(
        /(\w+?)(\d+)\(([A-Z])\)\s*<->\s*(\w+?)(\d+)\(([A-Z])\)/
      );
      if (!match) continue;
      const [, name1, no1, ch1, name2, no2, ch2] = match;
      const n1 = ensureNode(ch1, Number(no1), name1);
      const n2 = ensureNode(ch2, Number(no2), name2);
      const key = [n1.id, n2.id].sort().join("|");
      const count = Number(p.contacts ?? 1);
      edgeCount.set(key, count);
      edges.push({
        source: n1.id,
        target: n2.id,
        type: "hydrophobic",
        distance: 0,
        count,
      });
    }
  }

  // Deduplicate edges and compute degree
  const seenEdges = new Set<string>();
  const dedupedEdges: InteractionEdge[] = [];
  for (const e of edges) {
    const key = [e.source, e.target].sort().join("|");
    if (seenEdges.has(key)) continue;
    seenEdges.add(key);
    e.count = edgeCount.get(key) ?? 1;
    dedupedEdges.push(e);
    const n1 = nodeMap.get(e.source);
    const n2 = nodeMap.get(e.target);
    if (n1) n1.degree++;
    if (n2) n2.degree++;
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: dedupedEdges,
  };
}
