"use client";

import { useState, useCallback, useRef } from "react";
import {
  Search,
  Loader2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/lib/store";

interface SearchResult {
  identifier: string;
  title?: string;
  resolution?: number;
  method?: string;
  organism?: string;
  weight?: number;
  releaseDate?: string;
}

type SearchType =
  | "text"
  | "sequence"
  | "motif"
  | "structure";

const SEARCH_TYPES: Array<{ value: SearchType; label: string; placeholder: string }> = [
  { value: "text", label: "关键词", placeholder: "如: hemoglobin kinase GPCR..." },
  { value: "sequence", label: "序列", placeholder: "粘贴蛋白序列 (单字母)" },
  { value: "motif", label: "基序", placeholder: "如: Cx{2,4}C 锌指基序" },
  { value: "structure", label: "结构 (PDB ID)", placeholder: "如: 1CBS (找同源结构)" },
];

export function StructureSearch() {
  const [query, setQuery] = useState("");
  const [searchType, setSearchType] = useState<SearchType>("text");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [sortBy, setSortBy] = useState<"resolution" | "date" | "weight">("resolution");
  const [expanded, setExpanded] = useState(true);
  const cancelRef = useRef(false);

  const toast = useAppStore((s) => s.toast);
  const addStructure = useAppStore((s) => s.addStructure);
  const viewer = useAppStore((s) => s.viewer);
  const executeCommandImport = useRef<Promise<typeof import("@/lib/molstar/commands")> | null>(null);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) {
      setError("请输入搜索内容");
      return;
    }
    setLoading(true);
    setError(null);
    setHasSearched(true);
    cancelRef.current = false;
    setResults([]);

    try {
      // Build RCSB search query based on type
      let requestBody: Record<string, unknown>;
      if (searchType === "text") {
        requestBody = {
          query: {
            type: "group",
            logical_operator: "and",
            nodes: [
              {
                type: "terminal",
                service: "full_text",
                parameters: {
                  value: q,
                },
              },
            ],
          },
          return_type: "entry",
          request_options: {
            sort: [
              { sort_by: "rcsb_entry_info.resolution_combined", direction: "asc" },
            ],
            paginate: { start: 0, rows: 30 },
          },
        };
      } else if (searchType === "sequence") {
        // Sequence search via RCSB sequence service
        requestBody = {
          query: {
            type: "terminal",
            service: "sequence",
            parameters: {
              evalue: 1,
              identity: 0.3,
              sequence_type: "protein",
              sequence: q,
            },
          },
          return_type: "entry",
          request_options: {
            paginate: { start: 0, rows: 30 },
          },
        };
      } else if (searchType === "motif") {
        requestBody = {
          query: {
            type: "terminal",
            service: "motif",
            parameters: {
              value: q,
            },
          },
          return_type: "entry",
          request_options: {
            paginate: { start: 0, rows: 30 },
          },
        };
      } else {
        // structure — find structural homologs
        // Use structure search (needs PDB ID)
        const pdbId = q.toUpperCase().slice(0, 4);
        requestBody = {
          query: {
            type: "terminal",
            service: "structure",
            parameters: {
              value: {
                entry_id: pdbId,
                assembly_id: "1",
              },
              operator: "relaxed_shape_match",
            },
          },
          return_type: "entry",
          request_options: {
            paginate: { start: 0, rows: 30 },
          },
        };
      }

      const res = await fetch("https://search.rcsb.org/rcsbsearch/v2/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`RCSB 搜索失败 (${res.status}): ${errText.slice(0, 200)}`);
      }
      const data = await res.json();
      if (cancelRef.current) return;

      const total = data.total_count ?? 0;
      const resultSet: Array<SearchResult> = (data.result_set ?? []).map(
        (r: { identifier: string }) => ({
          identifier: r.identifier,
        })
      );

      // Fetch details for each result (batch)
      const detailed: SearchResult[] = [];
      for (const r of resultSet) {
        if (cancelRef.current) break;
        try {
          const metaRes = await fetch(
            `https://data.rcsb.org/rest/v1/core/entry/${r.identifier}`
          );
          if (metaRes.ok) {
            const meta = await metaRes.json();
            const info = meta.rcsb_entry_info ?? {};
            detailed.push({
              identifier: r.identifier,
              title: meta.struct?.title ?? r.identifier,
              resolution: info.resolution_combined?.[0] ?? null,
              method: info.experimental_method?.[0] ?? null,
              weight: info.molecular_weight ?? null,
              releaseDate: meta.rcsb_accession_info?.initial_release_date ?? null,
            });
          } else {
            detailed.push({ identifier: r.identifier });
          }
        } catch {
          detailed.push({ identifier: r.identifier });
        }
      }
      if (cancelRef.current) return;

      // Sort
      detailed.sort((a, b) => {
        if (sortBy === "resolution") {
          return (a.resolution ?? 999) - (b.resolution ?? 999);
        }
        if (sortBy === "date") {
          return (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
        }
        return (b.weight ?? 0) - (a.weight ?? 0);
      });

      setResults(detailed);
      toast(`找到 ${total} 个结果，加载前 ${detailed.length} 个详情`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast(`搜索失败: ${msg}`, "error");
    } finally {
      setLoading(false);
    }
  }, [query, searchType, sortBy, toast]);

  const handleLoadResult = async (id: string) => {
    if (!viewer) {
      toast("查看器未就绪", "error");
      return;
    }
    if (!executeCommandImport.current) {
      executeCommandImport.current = import("@/lib/molstar/commands");
    }
    const { executeCommand } = await executeCommandImport.current;
    try {
      await executeCommand(viewer, { type: "load_pdb", id });
      addStructure({
        id,
        label: id.toUpperCase(),
        source: "pdb",
        loadedAt: Date.now(),
      });
      toast(`已加载 ${id.toUpperCase()}`, "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`加载失败: ${msg}`, "error");
    }
  };

  const currentType = SEARCH_TYPES.find((t) => t.value === searchType)!;

  return (
    <div className="rounded-lg border bg-card shadow-sm">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between border-b px-3 py-2 text-left transition hover:bg-accent/30"
      >
        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">结构搜索 (RCSB)</span>
        </div>
        {expanded ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="space-y-2 p-3">
          {/* Search type selector */}
          <div className="flex flex-wrap gap-1">
            {SEARCH_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setSearchType(t.value)}
                className={`rounded px-2 py-0.5 text-[10px] font-medium transition ${
                  searchType === t.value
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-accent"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div className="flex gap-1.5">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSearch();
                }
              }}
              placeholder={currentType.placeholder}
              className="h-8 flex-1 text-xs"
              disabled={loading}
            />
            <Button
              size="sm"
              className="h-8 px-2.5"
              onClick={handleSearch}
              disabled={loading || !query.trim()}
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
            </Button>
            {query && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  setHasSearched(false);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Sort selector */}
          {results.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="text-muted-foreground">排序:</span>
              <Select
                value={sortBy}
                onValueChange={(v) => setSortBy(v as typeof sortBy)}
              >
                <SelectTrigger className="h-7 w-24 text-[10px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="resolution">分辨率</SelectItem>
                  <SelectItem value="date">发布日期</SelectItem>
                  <SelectItem value="weight">分子量</SelectItem>
                </SelectContent>
              </Select>
              <span className="ml-auto text-muted-foreground">
                {results.length} 个结果
              </span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[10px] text-destructive">
              {error}
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <ScrollArea className="max-h-80 scrollbar-thin">
              <div className="space-y-1">
                {results.map((r) => (
                  <div
                    key={r.identifier}
                    className="group rounded-md border bg-background p-2 transition hover:border-primary/50 hover:bg-accent/20"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-xs font-semibold">
                            {r.identifier}
                          </span>
                          {r.method && (
                            <Badge
                              variant="outline"
                              className="px-1 py-0 text-[9px]"
                            >
                              {r.method === "X-ray diffraction"
                                ? "X-RAY"
                                : r.method === "Electron Microscopy"
                                ? "EM"
                                : r.method.slice(0, 6).toUpperCase()}
                            </Badge>
                          )}
                          {r.resolution && (
                            <Badge
                              variant="secondary"
                              className="px-1 py-0 text-[9px] font-mono"
                            >
                              {r.resolution}Å
                            </Badge>
                          )}
                        </div>
                        {r.title && (
                          <div className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                            {r.title}
                          </div>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-1.5 text-[10px]"
                          onClick={() => handleLoadResult(r.identifier)}
                          disabled={!viewer}
                          title="加载到查看器"
                        >
                          加载
                        </Button>
                        <a
                          href={`https://www.rcsb.org/structure/${r.identifier}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="grid h-6 place-items-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          title="在 RCSB 打开"
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Empty state */}
          {!loading && !error && hasSearched && results.length === 0 && (
            <div className="py-4 text-center text-[11px] text-muted-foreground">
              无结果
            </div>
          )}

          {/* Hint */}
          {!hasSearched && (
            <div className="text-[10px] text-muted-foreground">
              支持 RCSB 全文搜索、序列搜索、基序搜索、结构相似性搜索。
            </div>
          )}
        </div>
      )}
    </div>
  );
}
