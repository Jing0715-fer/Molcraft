import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MolCraft AI — 结构分析与作图工作台",
  description:
    "基于 Molstar 的蛋白质/核酸结构分析、测量、互作分析与作图工作台，配合 LLM 实现自然语言驱动的可视化调整与图文报告生成。",
  keywords: [
    "Molstar",
    "结构生物学",
    "蛋白质结构",
    "PDB",
    "互作分析",
    "结构比对",
    "AI 作图",
  ],
  authors: [{ name: "MolCraft AI" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* Molstar viewer prebuilt CSS */}
        <link rel="stylesheet" href="/molstar.css" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <SonnerToaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
