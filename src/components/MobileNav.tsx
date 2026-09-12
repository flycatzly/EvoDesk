"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { GROUPS, NavLinks } from "./Sidebar";

const byHref = new Map(GROUPS.flatMap((g) => g.items).map((it) => [it.href, it]));
const BOTTOM_ITEMS = ["/", "/inbox", "/tasks", "/chat"].flatMap((href) => {
  const it = byHref.get(href);
  return it && it.ready ? [it] : [];
});

/** 移动端抽屉:汉堡按钮(md 以下显示)+ 左侧滑入面板 + 遮罩;遮罩点击/Esc/路由变化均关闭。 */
export function MobileDrawer() {
  const pathname = usePathname();
  // 记录打开抽屉时的路径,open 由其派生:路由一变自动关闭,无需 effect
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const close = () => setOpenAt(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenAt(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button type="button" aria-label="打开导航" aria-expanded={open} onClick={() => setOpenAt(pathname)}
        className="md:hidden p-1 -ml-1 rounded-lg" style={{ color: "var(--text)" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
      </button>
      {open && <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={close} />}
      <div
        onClickCapture={close}
        className={`md:hidden fixed inset-y-0 left-0 w-64 z-50 p-4 flex flex-col gap-4 transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background: "var(--surface)", borderRight: "1px solid var(--border)" }}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="flex items-center justify-between">
          <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>EvoDesk</div>
          <button type="button" aria-label="关闭导航" onClick={close} className="p-1 rounded-lg" style={{ color: "var(--muted)" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        <NavLinks variant="drawer" />
      </div>
    </>
  );
}

/** 移动端底部导航:4 个最高频入口(图标 + 小字),当前页 accent 高亮;桌面端隐藏。 */
export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="快捷导航"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 flex pb-[env(safe-area-inset-bottom)]"
      style={{ background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
      {BOTTOM_ITEMS.map((it) => (
        <Link key={it.href} href={it.href}
          className="flex-1 flex flex-col items-center gap-0.5 py-2 text-xs"
          aria-current={pathname === it.href ? "page" : undefined}
          style={pathname === it.href ? { color: "var(--accent)" } : { color: "var(--muted)" }}>
          {it.icon}
          <span>{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}
