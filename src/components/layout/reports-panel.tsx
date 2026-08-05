"use client";

import { useState, useRef } from "react";
import {
  FileText,
  Trash2,
  Download,
  Loader2,
  ImageIcon,
  Sparkles,
  Printer,
  Save,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Minimal markdown → HTML converter for export (HTML/PDF). */
function mdToHtml(md: string): string {
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Code blocks
  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    "<pre><code>$2</code></pre>"
  );
  // Tables (GFM) — simple two-row tables with header | sep | rows
  html = html.replace(
    /(?:^\|.*\|\s*\n)+/gm,
    (block: string) => {
      const lines = block.trim().split("\n").map((l) => l.trim());
      if (lines.length < 2) return block;
      // skip separator row (|---|---|)
      const rows = lines.filter((l, i) => i !== 1);
      const cells = rows.map((l) =>
        l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim())
      );
      const header = cells[0] ?? [];
      const body = cells.slice(1);
      const thead = `<thead><tr>${header
        .map((c) => `<th>${c}</th>`)
        .join("")}</tr></thead>`;
      const tbody = `<tbody>${body
        .map(
          (r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`
        )
        .join("")}</tbody>`;
      return `<table>${thead}${tbody}</table>`;
    }
  );
  // Headings
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
  // Paragraphs (lines not part of other elements)
  html = html
    .split("\n\n")
    .map((block) => {
      if (
        block.startsWith("<h") ||
        block.startsWith("<ul") ||
        block.startsWith("<pre") ||
        block.startsWith("<table")
      )
        return block;
      if (block.trim() === "") return "";
      return `<p>${block.replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");
  return html;
}

export function ReportsPanel() {
  const reports = useAppStore((s) => s.reports);
  const removeReport = useAppStore((s) => s.removeReport);
  const addReport = useAppStore((s) => s.addReport);
  const structures = useAppStore((s) => s.structures);
  const lastSnapshot = useAppStore((s) => s.lastSnapshot);
  const toast = useAppStore((s) => s.toast);
  const saveSession = useAppStore((s) => s.saveSession);
  const loadSession = useAppStore((s) => s.loadSession);
  const [notes, setNotes] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const sessionFileInputRef = useRef<HTMLInputElement>(null);

  const generateReport = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/llm/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes,
          structures: structures.map((s) => ({ id: s.id, label: s.label })),
          snapshot: lastSnapshot,
          extraInstructions: extra,
          fetchRealData: true, // ★ auto-fetch real RCSB data
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { markdown: string };
      addReport({
        id: `r-${Date.now()}`,
        title:
          data.markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "分析报告",
        markdown: data.markdown,
        snapshot: lastSnapshot ?? undefined,
        createdAt: Date.now(),
      });
      toast("报告已生成", "success");
      setNotes("");
      setExtra("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`报告生成失败: ${msg}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const downloadMarkdown = (r: { title: string; markdown: string }) => {
    const blob = new Blob([r.markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadImage = (r: { title: string; snapshot?: string }) => {
    if (!r.snapshot) return;
    const a = document.createElement("a");
    a.href = r.snapshot;
    a.download = `${r.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.png`;
    a.click();
  };

  /** Compose a multi-panel publication-quality figure from screenshots.
   *  Supports 1-4 snapshots arranged in a grid:
   *  - 1 image: full size with title bar
   *  - 2 images: side by side
   *  - 3-4 images: 2x2 grid
   *  Each panel gets a letter label (A, B, C, D) and optional caption.
   *  Title bar + scale bar + date stamp are added. */
  const exportMultiPanelFigure = (r: {
    title: string;
    snapshot?: string;
    snapshots?: Array<{ label: string; dataUrl: string }>;
    createdAt: number;
  }) => {
    // Collect all available screenshots
    const allImages: Array<{ url: string; label: string }> = [];
    if (r.snapshots && r.snapshots.length > 0) {
      r.snapshots.forEach((s) => allImages.push({ url: s.dataUrl, label: s.label }));
    }
    if (r.snapshot && allImages.length === 0) {
      allImages.push({ url: r.snapshot, label: "结构截图" });
    }
    if (allImages.length === 0) {
      toast("报告无截图，无法生成多面板图", "error");
      return;
    }

    // Load all images first
    const imagePromises = allImages.map(
      (item) =>
        new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = item.url;
        })
    );

    Promise.all(imagePromises).then((images) => {
      const n = images.length;
      const scale = 2; // 2x for high-res
      const panelW = 800; // target panel width
      const panelH = 450; // target panel height
      const gap = 10;
      const titleH = 44;
      const footerH = 30;

      // Calculate layout
      let cols: number, rows: number;
      if (n === 1) { cols = 1; rows = 1; }
      else if (n === 2) { cols = 2; rows = 1; }
      else { cols = 2; rows = Math.ceil(n / 2); }

      const totalW = cols * panelW + (cols - 1) * gap;
      const totalH = rows * panelH + (rows - 1) * gap + titleH + footerH;

      const canvas = document.createElement("canvas");
      canvas.width = totalW * scale;
      canvas.height = totalH * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(scale, scale);

      // White background
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, totalW, totalH);

      // Title bar
      ctx.fillStyle = "#0f766e";
      ctx.fillRect(0, 0, totalW, titleH);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 16px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(r.title, totalW / 2, 28);

      // Draw each panel
      const labels = ["A", "B", "C", "D", "E", "F"];
      images.forEach((img, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = col * (panelW + gap);
        const y = titleH + row * (panelH + gap);

        // Draw image (maintain aspect ratio, fit within panel)
        const imgAspect = img.width / img.height;
        const panelAspect = panelW / panelH;
        let dw = panelW, dh = panelH, dx = x, dy = y;
        if (imgAspect > panelAspect) {
          dh = panelW / imgAspect;
          dy = y + (panelH - dh) / 2;
        } else {
          dw = panelH * imgAspect;
          dx = x + (panelW - dw) / 2;
        }
        ctx.drawImage(img, dx, dy, dw, dh);

        // Panel label (top-left corner)
        ctx.fillStyle = "rgba(15, 118, 110, 0.9)";
        ctx.fillRect(x, y, 28, 22);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(labels[i] || String(i + 1), x + 14, y + 16);

        // Panel caption (below image)
        if (allImages[i]?.label) {
          ctx.fillStyle = "#666666";
          ctx.font = "11px -apple-system, sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(allImages[i].label, x + panelW / 2, y + panelH - 5);
        }

        // Scale bar on each panel
        ctx.fillStyle = "#000000";
        ctx.fillRect(x + panelW - 70, y + panelH - 25, 50, 3);
        ctx.font = "9px -apple-system, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("10 Å", x + panelW - 45, y + panelH - 12);
      });

      // Footer
      const date = new Date(r.createdAt).toLocaleString("zh-CN");
      ctx.fillStyle = "#999999";
      ctx.font = "10px -apple-system, sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`MolCraft AI · ${date}`, totalW - 10, totalH - 8);

      // Download
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${r.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}_figure.png`;
        a.click();
        URL.revokeObjectURL(url);
        toast(`高清多面板图已导出 (${n} 个面板)`, "success");
      }, "image/png");
    }).catch(() => {
      toast("图片加载失败，无法生成多面板图", "error");
    });
  };

  const downloadHtml = (r: {
    title: string;
    markdown: string;
    snapshot?: string;
    createdAt: number;
  }) => {
    const date = new Date(r.createdAt).toLocaleString("zh-CN");
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${r.title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; color: #1f2937; line-height: 1.6; }
  h1 { color: #10b981; border-bottom: 2px solid #10b981; padding-bottom: 0.3em; }
  h2 { color: #0f766e; margin-top: 1.5em; }
  h3 { color: #0369a1; }
  pre { background: #f3f4f6; padding: 0.75em; border-radius: 6px; overflow-x: auto; }
  code { background: #f3f4f6; padding: 0.1em 0.35em; border-radius: 3px; font-family: ui-monospace, monospace; font-size: 0.9em; }
  pre code { background: transparent; padding: 0; }
  ul { padding-left: 1.5em; }
  li { margin: 0.2em 0; }
  strong { color: #065f46; }
  img { max-width: 100%; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin: 1em 0; }
  .meta { color: #6b7280; font-size: 0.85em; border-top: 1px solid #e5e7eb; padding-top: 0.5em; margin-top: 2em; }
</style>
</head>
<body>
<h1>${r.title}</h1>
${r.snapshot ? `<img src="${r.snapshot}" alt="结构截图">` : ""}
${mdToHtml(r.markdown)}
<div class="meta">生成时间: ${date} · MolCraft AI (Molstar + Z.ai GLM)</div>
</body>
</html>`;
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.title.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.html`;
    a.click();
    URL.revokeObjectURL(url);
    toast("HTML 报告已导出", "success");
  };

  const exportPdf = (r: {
    title: string;
    markdown: string;
    snapshot?: string;
    createdAt: number;
  }) => {
    // Build a print-friendly HTML document and open it in a new window
    // for the user to use the browser's native "Save as PDF" via window.print().
    const date = new Date(r.createdAt).toLocaleString("zh-CN");
    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${r.title}</title>
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2937; line-height: 1.7; font-size: 11pt; }
  h1 { color: #10b981; border-bottom: 2px solid #10b981; padding-bottom: 0.3em; font-size: 18pt; page-break-after: avoid; }
  h2 { color: #0f766e; margin-top: 1.2em; font-size: 14pt; page-break-after: avoid; }
  h3 { color: #0369a1; font-size: 12pt; page-break-after: avoid; }
  pre { background: #f3f4f6; padding: 0.6em 0.8em; border-radius: 4px; overflow-x: auto; font-size: 9.5pt; page-break-inside: avoid; }
  code { background: #f3f4f6; padding: 0.05em 0.3em; border-radius: 3px; font-family: ui-monospace, "SFMono-Regular", monospace; font-size: 0.92em; }
  pre code { background: transparent; padding: 0; }
  ul { padding-left: 1.4em; }
  li { margin: 0.15em 0; }
  strong { color: #065f46; }
  table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 10pt; }
  th, td { border: 1px solid #d1d5db; padding: 4px 8px; text-align: left; }
  th { background: #ecfdf5; color: #065f46; }
  img { max-width: 100%; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin: 0.8em 0; page-break-inside: avoid; }
  .meta { color: #6b7280; font-size: 9pt; border-top: 1px solid #e5e7eb; padding-top: 0.4em; margin-top: 1.5em; }
  .toolbar { position: fixed; top: 8px; right: 8px; padding: 6px 12px; background: #10b981; color: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; box-shadow: 0 2px 6px rgba(0,0,0,0.2); z-index: 9999; }
  @media print { .toolbar { display: none; } }
</style>
</head>
<body>
<div class="toolbar" onclick="window.print()">🖨️ 打印 / 保存为 PDF</div>
<h1>${r.title}</h1>
${r.snapshot ? `<img src="${r.snapshot}" alt="结构截图">` : ""}
${mdToHtml(r.markdown)}
<div class="meta">生成时间: ${date} · MolCraft AI (Molstar + Z.ai GLM)</div>
<script>
  // Auto-open print dialog after images load
  window.addEventListener('load', function() {
    setTimeout(function() { try { window.print(); } catch (e) {} }, 500);
  });
</script>
</body>
</html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) {
      toast("请允许弹出窗口以导出 PDF", "error");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    toast("PDF 预览已打开，使用浏览器打印保存为 PDF", "info");
  };

  const handleSaveSession = () => {
    try {
      const json = saveSession();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
      a.download = `molcraft-session-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast("会话已保存", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast(`保存会话失败: ${msg}`, "error");
    }
  };

  const handleLoadSession = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const f = files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const data = JSON.parse(text);
        loadSession(data);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast(`加载会话失败: ${msg}`, "error");
      }
    };
    reader.onerror = () => toast("读取文件失败", "error");
    reader.readAsText(f);
  };

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="uni-panel-header">
        <FileText className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">分析报告</span>
        <Badge variant="secondary" className="ml-auto text-[10px]">
          {reports.length}
        </Badge>
        {/* Session save / load */}
        <input
          ref={sessionFileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            handleLoadSession(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={handleSaveSession}
          title="保存会话 (结构/测量/比对/报告)"
        >
          <Save className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => sessionFileInputRef.current?.click()}
          title="加载会话"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* New report generator */}
      <div className="shrink-0 border-b bg-accent/20 p-3">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          生成新报告
        </div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="分析笔记：记录观察、测量值、相互作用等。LLM 将基于此撰写报告…"
          className="mb-2 min-h-[60px] max-h-[120px] resize-none text-sm"
        />
        <Textarea
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="额外要求（可选）：如风格、重点、读者…"
          className="mb-2 min-h-[40px] max-h-[80px] resize-none text-sm"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={busy}
            onClick={generateReport}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            生成报告
          </Button>
          {lastSnapshot && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <ImageIcon className="h-3 w-3" />
              含截图
            </Badge>
          )}
        </div>
      </div>

      {/* Reports list */}
      <ScrollArea className="flex-1 min-h-0 scrollbar-thin">
        <div className="space-y-3 p-3">
          {reports.length === 0 ? (
            <div className="py-8 text-center">
              <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">还没有报告</p>
              <p className="mt-1 text-[11px] text-muted-foreground/70">
                通过对话或上方表单生成
              </p>
            </div>
          ) : (
            reports.map((r) => (
              <ReportCard
                key={r.id}
                report={r}
                onRemove={() => removeReport(r.id)}
                onDownloadMd={() => downloadMarkdown(r)}
                onDownloadImg={() => downloadImage(r)}
                onDownloadHtml={() => downloadHtml(r)}
                onExportPdf={() => exportPdf(r)}
                onExportFigure={() => exportMultiPanelFigure(r)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ReportCard({
  report,
  onRemove,
  onDownloadMd,
  onDownloadImg,
  onDownloadHtml,
  onExportPdf,
  onExportFigure,
}: {
  report: {
    id: string;
    title: string;
    markdown: string;
    snapshot?: string;
    snapshots?: Array<{ label: string; dataUrl: string }>;
    createdAt: number;
  };
  onRemove: () => void;
  onDownloadMd: () => void;
  onDownloadImg: () => void;
  onDownloadHtml: () => void;
  onExportPdf: () => void;
  onExportFigure: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      {report.snapshot && (
        <img
          src={report.snapshot}
          alt={report.title}
          className="h-32 w-full object-cover"
        />
      )}
      <div className="p-3">
        <div className="mb-1 flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold leading-tight">{report.title}</h3>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {new Date(report.createdAt).toLocaleString("zh-CN", {
              hour: "2-digit",
              minute: "2-digit",
              month: "2-digit",
              day: "2-digit",
            })}
          </span>
        </div>
        <div className="prose-chat mb-2 text-xs">
          {expanded ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {report.markdown}
            </ReactMarkdown>
          ) : (
            <p className="line-clamp-3 text-muted-foreground">
              {report.markdown.replace(/^#{1,6}\s+.+$/m, "").trim().slice(0, 180)}
              …
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "收起" : "展开"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onDownloadMd}
          >
            <Download className="mr-1 h-3 w-3" />
            MD
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onDownloadHtml}
          >
            <Download className="mr-1 h-3 w-3" />
            HTML
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px]"
            onClick={onExportPdf}
          >
            <Printer className="mr-1 h-3 w-3" />
            PDF
          </Button>
          {report.snapshot && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={onDownloadImg}
            >
              <ImageIcon className="mr-1 h-3 w-3" />
              PNG
            </Button>
          )}
          {report.snapshot && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={onExportFigure}
              title="导出带标题和比例尺的高清图"
            >
              <ImageIcon className="mr-1 h-3 w-3" />
              Figure
            </Button>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 px-0 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
