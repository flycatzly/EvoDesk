"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const I = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const GROUPS: { label: string; items: { href: string; label: string; icon: ReactNode; ready: boolean }[] }[] = [
  { label: "核心", items: [
    { href: "/", label: "仪表盘", icon: I("M3 12l9-9 9 9M5 10v10h14V10"), ready: true },
    { href: "/inbox", label: "收件箱", icon: I("M22 12h-6l-2 3h-4l-2-3H2M5 5h14l3 7v7H2v-7z"), ready: true },
    { href: "/tasks", label: "任务看板", icon: I("M4 4h6v16H4zM14 4h6v10h-6z"), ready: true },
    { href: "/calendar", label: "日历", icon: I("M8 2v4M16 2v4M3 8h18M5 4h14v18H5z"), ready: false },
  ]},
  { label: "AI", items: [
    { href: "/chat", label: "对话台", icon: I("M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z"), ready: false },
  ]},
  { label: "资产", items: [
    { href: "/flows", label: "流程库", icon: I("M4 6h16M4 12h10M4 18h7"), ready: false },
    { href: "/executors", label: "执行器", icon: I("M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 100 8 4 4 0 000-8z"), ready: false },
    { href: "/notes", label: "笔记", icon: I("M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"), ready: false },
    { href: "/vault", label: "知识库", icon: I("M4 19V5a2 2 0 012-2h14v18H6a2 2 0 01-2-2zM8 7h8M8 11h8"), ready: false },
  ]},
  { label: "系统", items: [
    { href: "/settings", label: "设置", icon: I("M12 8a4 4 0 100 8 4 4 0 000-8zM19 12a7 7 0 00-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 00-1.7-1L14.5 3h-5l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.5L5.1 11a7 7 0 000 2l-2 1.5 2 3.5 2.4-1a7 7 0 001.7 1l.3 2.5h5l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.5-2-1.5c.06-.33.1-.66.1-1z"), ready: true },
  ]},
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex flex-col gap-4 w-52 shrink-0 p-4" style={{ borderRight: "1px solid var(--border)" }}>
      <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>EvoDesk</div>
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="text-xs uppercase mb-1" style={{ color: "var(--muted)" }}>{g.label}</div>
          {g.items.map((it) =>
            it.ready ? (
              <Link key={it.href} href={it.href}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm my-0.5"
                style={pathname === it.href ? { background: "var(--surface-2)", color: "var(--accent)" } : { color: "var(--text)" }}>
                {it.icon}{it.label}
              </Link>
            ) : (
              <span key={it.href} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm my-0.5 opacity-40 cursor-not-allowed" title="后续版本上线">
                {it.icon}{it.label}
              </span>
            ),
          )}
        </div>
      ))}
    </aside>
  );
}
