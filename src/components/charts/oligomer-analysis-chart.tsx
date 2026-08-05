"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Boxes, RefreshCw, Loader2, Info, Network } from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";

interface ChainInfo {
  chain: string;
  residue_count: number;
  atom_count: number;
  first_resno: number | null;
  last_resno: number | null;
}

interface InterfaceInfo {
  chain1: string;
  chain2: string;
  contact_atoms: number;
  min_distance_A: number;
}

interface OligomerData {
  n_chains: number;
  oligomer_type: string;
  is_homomer: boolean;
  n_interfaces: number;
  chains: ChainInfo[];
  interfaces: InterfaceInfo[];
}

const HOMOMER_COLORS: Record<string, string> = {
  monomer: "#6b7280",
  homodimer: "#10b981",
  homotrimer: "#06b6d4",
  homotetramer: "#3b82f6",
  heterodimer: "#f59e0b",
  heterotrimer: "#f97316",
  heterotetramer: "#ef4444",
};

const CHAIN_COLORS = [
  "#ef4444", "#3b82f6", "#10b981", "#f59e0b",
  "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16",
];

export function OligomerAnalysisChart() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const [data, setData] = useState<OligomerData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const fetchData = useCallback(async () => {
    if (!activeId) {
      setData(null);
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "oligomer_analysis",
      params: {},
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法分析寡聚体。请上传本地 .pdb/.cif 文件后再试。`
      );
      setData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
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
      if (json.data) {
        if (json.data.error) {
          setError(`分析失败: ${json.data.error}`);
          setData(null);
        } else {
          setData(json.data);
        }
      } else {
        setError(json.stderr || "无数据返回");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`寡聚体分析失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const chainColor = (chain: string) => {
    const idx = chain.charCodeAt(0) - 65;
    return CHAIN_COLORS[idx % CHAIN_COLORS.length] ?? "#999";
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Boxes className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">寡聚体分析</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.n_chains} 链
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={fetchData}
            disabled={loading}
            title="重新分析"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {loading && <Skeleton className="h-32 w-full" />}

        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {!loading && !error && !data && !activeId && (
          <div className="py-4 text-center text-[11px] text-muted-foreground">
            加载一个结构以分析寡聚体
          </div>
        )}

        {!loading && !error && data && (
          <div className="space-y-2">
            {/* Oligomer type banner */}
            <div
              className="rounded-md border p-2.5 text-center"
              style={{
                borderColor: (HOMOMER_COLORS[data.oligomer_type] ?? "#6b7280") + "60",
                background: `linear-gradient(135deg, ${(HOMOMER_COLORS[data.oligomer_type] ?? "#6b7280")}20 0%, transparent 70%)`,
              }}
            >
              <div className="text-[9px] uppercase text-muted-foreground">寡聚类型</div>
              <div
                className="text-base font-bold"
                style={{ color: HOMOMER_COLORS[data.oligomer_type] ?? "#6b7280" }}
              >
                {data.oligomer_type}
              </div>
              <div className="text-[9px] text-muted-foreground">
                {data.is_homomer ? "同源寡聚体" : "异源寡聚体"} · {data.n_chains} 条链
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md border bg-blue-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">链数</div>
                <div className="font-mono text-base font-bold text-blue-600">
                  {data.n_chains}
                </div>
              </div>
              <div className="rounded-md border bg-emerald-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">界面数</div>
                <div className="font-mono text-base font-bold text-emerald-600">
                  {data.n_interfaces}
                </div>
              </div>
              <div className="rounded-md border bg-violet-500/5 p-2 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">对称性</div>
                <div className="font-mono text-[10px] font-bold text-violet-600 leading-tight pt-1">
                  {data.is_homomer ? "同源" : "异源"}
                </div>
              </div>
            </div>

            {/* Chain list */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                链信息
              </div>
              <div className="space-y-0.5">
                {data.chains.map((chain) => (
                  <div
                    key={chain.chain}
                    className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent/20"
                  >
                    <span
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-[9px] font-bold text-white"
                      style={{ backgroundColor: chainColor(chain.chain) }}
                    >
                      {chain.chain}
                    </span>
                    <span className="font-mono">
                      {chain.residue_count} 残基
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {chain.atom_count} 原子
                    </span>
                    {chain.first_resno !== null && chain.last_resno !== null && (
                      <span className="ml-auto font-mono text-[9px] text-muted-foreground">
                        {chain.first_resno}-{chain.last_resno}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Interface list */}
            {data.interfaces.length > 0 && (
              <div>
                <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  链间界面 (接触原子数)
                </div>
                <div className="space-y-0.5">
                  {data.interfaces.map((iface, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10px] hover:bg-accent/20"
                    >
                      <Network className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span
                        className="grid h-4 w-4 place-items-center rounded text-[8px] font-bold text-white"
                        style={{ backgroundColor: chainColor(iface.chain1) }}
                      >
                        {iface.chain1}
                      </span>
                      <span className="text-muted-foreground">↔</span>
                      <span
                        className="grid h-4 w-4 place-items-center rounded text-[8px] font-bold text-white"
                        style={{ backgroundColor: chainColor(iface.chain2) }}
                      >
                        {iface.chain2}
                      </span>
                      <Badge variant="outline" className="ml-auto font-mono text-[9px]">
                        {iface.contact_atoms} 接触
                      </Badge>
                      <span className="font-mono text-[9px] text-muted-foreground">
                        {iface.min_distance_A.toFixed(1)} Å
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                寡聚体分析检测链间界面 (接触原子距离 &lt; 5Å)。同源寡聚体 (homomer) 由相同链组成,异源寡聚体 (heteromer) 由不同链组成。
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
