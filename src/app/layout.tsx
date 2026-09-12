import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/domain/theme";

export const metadata: Metadata = { title: "EvoDesk · 个人工作台", description: "EvoFlow 式本地优先个人 AI 工作台" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // 默认深色(SSR 兜底);boot 脚本在首帧前按 localStorage 的主题预设注入 8 个 CSS 变量
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} /></head>
      <body className="flex min-h-screen">{children}</body>
    </html>
  );
}
