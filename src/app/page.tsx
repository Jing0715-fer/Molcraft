"use client";

import dynamic from "next/dynamic";

// Molstar needs the browser; load the shell only on the client.
const AppShell = dynamic(
  () => import("@/components/layout/app-shell").then((m) => m.AppShell),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="relative h-12 w-12">
            <div className="absolute inset-0 rounded-full border-2 border-primary/30" />
            <div className="absolute inset-0 rounded-full border-t-2 border-primary animate-spin" />
          </div>
          <p className="text-sm">正在初始化 MolCraft AI…</p>
        </div>
      </div>
    ),
  }
);

export default function Home() {
  return <AppShell />;
}
