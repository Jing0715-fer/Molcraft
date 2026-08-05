"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlignLeft,
  Loader2,
  Play,
  Info,
  Download,
} from "lucide-react";
import { useAppStore, selectActiveStructure } from "@/lib/store";

interface AlignmentBlock {
  seq1: string;
  match: string;
  seq2: string;
  start: number;
}

interface AlignmentData {
  chain1: string;
  chain2: string;
  seq1_length: number;
  seq2_length: number;
  alignment_length: number;
  identity_pct: number;
  similarity_pct: number;
  gap_pct: number;
  score: number;
  matches: number;
  similar: number;
  gaps: number;
  blocks: AlignmentBlock[];
}

export function SequenceAlignment() {
  const activeStructure = useAppStore(selectActiveStructure);
  const structureFileCache = useAppStore((s) => s.structureFileCache);
  const toast = useAppStore((s) => s.toast);
  const [chain1, setChain1] = useState("A");
  const [chain2, setChain2] = useState("B");
  const [data, setData] = useState<AlignmentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeId = activeStructure?.id;
  const isPdbId = activeId ? /^[a-zA-Z0-9]{4}$/.test(activeId) : false;
  const hasFileCache = activeId ? !!structureFileCache[activeId] : false;

  const runAlignment = useCallback(async () => {
    if (!activeId) {
      toast("请先加载一个结构", "error");
      return;
    }
    const body: Record<string, unknown> = {
      recipe: "sequence_align",
      params: { chain1, chain2 },
    };
    if (isPdbId) {
      body.pdbId = activeId;
    } else if (hasFileCache) {
      body.fileContent = structureFileCache[activeId].content;
      body.fileFormat = structureFileCache[activeId].format;
    } else {
      setError(
        `当前结构 (${activeId}) 不是 PDB ID 且无本地文件缓存，无法运行序列比对。请上传本地 .pdb/.cif 文件后再试。`
      );
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
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
      toast(`比对失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [activeId, isPdbId, hasFileCache, structureFileCache, chain1, chain2, toast]);

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <AlignLeft className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-sm font-semibold">序列比对</span>
          {activeId && (
            <Badge variant="outline" className="truncate font-mono text-[9px]">
              {activeStructure?.label ?? activeId}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <Badge variant="secondary" className="text-[10px]">
              {data.identity_pct}% 相同
            </Badge>
          )}
          {data && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (!data) return;
                const lines: string[] = [];
                lines.push(`# Sequence Alignment: ${activeId} chain ${data.chain1} vs ${data.chain2}`);
                lines.push(`# Identity: ${data.identity_pct}%  Similarity: ${data.similarity_pct}%  Gaps: ${data.gap_pct}%`);
                lines.push(`# Length: ${data.seq1_length} vs ${data.seq2_length}  Score: ${data.score}`);
                lines.push("");
                for (const block of data.blocks) {
                  lines.push(`# Position ${block.start}`);
                  lines.push(block.seq1);
                  lines.push(block.match);
                  lines.push(block.seq2);
                  lines.push("");
                }
                const blob = new Blob([lines.join("\n")], {
                  type: "text/plain",
                });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.download = `alignment-${activeId}-${data.chain1}-${data.chain2}.txt`;
                link.href = url;
                link.click();
                URL.revokeObjectURL(url);
              }}
              title="导出比对文本"
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

        <Button
          size="sm"
          className="w-full"
          onClick={runAlignment}
          disabled={loading || !activeId}
        >
          {loading ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" />
          )}
          运行全局比对
        </Button>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && <Skeleton className="h-32 w-full" />}

        {/* Results */}
        {data && (
          <div className="space-y-2">
            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-1.5">
              <div className="rounded-md border bg-emerald-500/5 p-1.5 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">
                  相同度
                </div>
                <div className="font-mono text-sm font-bold text-emerald-600">
                  {data.identity_pct}%
                </div>
              </div>
              <div className="rounded-md border bg-sky-500/5 p-1.5 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">
                  相似度
                </div>
                <div className="font-mono text-sm font-bold text-sky-600">
                  {data.similarity_pct}%
                </div>
              </div>
              <div className="rounded-md border bg-amber-500/5 p-1.5 text-center">
                <div className="text-[9px] uppercase text-muted-foreground">
                  空位
                </div>
                <div className="font-mono text-sm font-bold text-amber-600">
                  {data.gap_pct}%
                </div>
              </div>
            </div>

            {/* Detail stats */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 rounded-md bg-accent/20 p-2 text-[10px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">链 {data.chain1} 长度:</span>
                <span className="font-mono">{data.seq1_length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">链 {data.chain2} 长度:</span>
                <span className="font-mono">{data.seq2_length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">比对长度:</span>
                <span className="font-mono">{data.alignment_length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">比对分数:</span>
                <span className="font-mono">{data.score}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">相同残基:</span>
                <span className="font-mono text-emerald-600">{data.matches}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">相似残基:</span>
                <span className="font-mono text-sky-600">{data.similar}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">空位数:</span>
                <span className="font-mono text-amber-600">{data.gaps}</span>
              </div>
            </div>

            {/* Alignment view */}
            <div>
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                比对结果
              </div>
              <div className="max-h-48 overflow-auto scrollbar-thin rounded-md border bg-white p-2">
                <pre className="font-mono text-[10px] leading-relaxed whitespace-pre">
                  {data.blocks.map((block, i) => (
                    <div key={i} className="mb-2 last:mb-0">
                      <div className="flex">
                        <span className="w-8 shrink-0 text-right text-muted-foreground">
                          {block.start}
                        </span>
                        <span className="ml-2 break-all text-foreground">
                          {block.seq1}
                        </span>
                      </div>
                      <div className="flex">
                        <span className="w-8 shrink-0" />
                        <span className="ml-2 break-all text-muted-foreground">
                          {block.match}
                        </span>
                      </div>
                      <div className="flex">
                        <span className="w-8 shrink-0 text-right text-muted-foreground">
                          {block.start}
                        </span>
                        <span className="ml-2 break-all text-foreground">
                          {block.seq2}
                        </span>
                      </div>
                    </div>
                  ))}
                </pre>
              </div>
            </div>

            <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
              <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              <div>
                全局比对 (Needleman-Wunsch) 使用 match=+2, mismatch=-1, gap_open=-2, gap_extend=-0.5。| 表示相同，. 表示相似 (同组氨基酸)，空格表示空位。
              </div>
            </div>
          </div>
        )}

        {!data && !error && !loading && (
          <div className="flex items-start gap-1.5 rounded-md bg-primary/5 p-2 text-[10px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
            <div>
              对两条链的蛋白序列进行全局比对 (Needleman-Wunsch)，返回相同度/相似度/空位率 + 分块比对视图。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
