"use client";

import { useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import {
  Wrench,
  MessageSquare,
  Dna,
  Activity,
  FileText,
  Search,
} from "lucide-react";
import { ToolsPanel } from "./tools-panel";
import { ChatPanel } from "./chat-panel";
import { SequenceViewer } from "./sequence-viewer";
import { ReportsPanel } from "./reports-panel";
import { UnifiedLeftPanel } from "./unified-left-panel";
import { useAppStore } from "@/lib/store";

type MobilePanel = "tools" | "chat" | "sequence" | "analysis" | "reports";

const PANELS: Array<{
  id: MobilePanel;
  label: string;
  icon: typeof Wrench;
}> = [
  { id: "tools", label: "工具", icon: Wrench },
  { id: "chat", label: "AI 助手", icon: MessageSquare },
  { id: "sequence", label: "序列", icon: Dna },
  { id: "analysis", label: "分析", icon: Activity },
  { id: "reports", label: "报告", icon: FileText },
];

export function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [openPanel, setOpenPanel] = useState<MobilePanel | null>(null);
  const [sheetSide, setSheetSide] = useState<"left" | "right">("right");

  const openSheet = (panel: MobilePanel, side: "left" | "right") => {
    setSheetSide(side);
    setOpenPanel(panel);
  };

  const renderPanel = (panel: MobilePanel) => {
    switch (panel) {
      case "tools":
        return <ToolsPanel />;
      case "chat":
        return <ChatPanel />;
      case "sequence":
        return <SequenceViewer />;
      case "analysis":
        // Reuse the desktop UnifiedLeftPanel which now hosts the compact
        // analysis charts grid (including the new SASA / disulfide / SS charts).
        return <UnifiedLeftPanel />;
      case "reports":
        return <ReportsPanel />;
    }
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Viewer fills the space */}
      <div className="relative flex-1 min-h-0">{children}</div>

      {/* Bottom navigation bar */}
      <nav className="flex shrink-0 items-stretch border-t bg-card/95 backdrop-blur">
        {PANELS.map((p) => {
          const Icon = p.icon;
          return (
            <Sheet
              key={p.id}
              open={openPanel === p.id}
              onOpenChange={(o) => {
                if (!o) setOpenPanel(null);
              }}
            >
              <SheetTrigger asChild>
                <button
                  onClick={() => openSheet(p.id, p.id === "tools" ? "left" : "right")}
                  className="flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <Icon className="h-4 w-4" />
                  {p.label}
                </button>
              </SheetTrigger>
              <SheetContent
                side={sheetSide}
                className="w-[85vw] max-w-sm p-0"
              >
                <SheetHeader className="sr-only">
                  <SheetTitle>{PANELS.find((x) => x.id === openPanel)?.label ?? "面板"}</SheetTitle>
                  <SheetDescription>
                    {PANELS.find((x) => x.id === openPanel)?.label ?? "面板"} 面板内容
                  </SheetDescription>
                </SheetHeader>
                <div className="h-full">
                  {openPanel && renderPanel(openPanel)}
                </div>
              </SheetContent>
            </Sheet>
          );
        })}
      </nav>
    </div>
  );
}
