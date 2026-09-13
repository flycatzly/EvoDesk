"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useModuleVisibility } from "./use-module-visibility";
import { GROUPS } from "./nav-registry";


/** 桌面侧栏与移动抽屉共用的导航组渲染:同数据、同高亮逻辑(pathname === href)。
 *  接入权限管控:按 全局隐藏 + 当前工作台白名单 过滤模块展示(useModuleVisibility)。 */
export function NavLinks({ variant }: { variant: "desktop" | "drawer" }) {
  const pathname = usePathname();
  const { visible } = useModuleVisibility();
  const pad = variant === "drawer" ? "py-2" : "py-1.5";
  return (
    <>
      {GROUPS.map((g) => {
        const items = g.items.filter((it) => visible.has(it.href));
        if (items.length === 0) return null; // 整组被隐藏则不渲染组头
        return (
          <div key={g.label}>
            <div className="text-xs uppercase mb-1" style={{ color: "var(--muted)" }}>{g.label}</div>
            {items.map((it) =>
              it.ready ? (
                <Link key={it.href} href={it.href}
                  className={`flex items-center gap-2 px-2 ${pad} rounded-lg text-sm my-0.5`}
                  style={pathname === it.href ? { background: "var(--surface-2)", color: "var(--accent)" } : { color: "var(--text)" }}>
                  {it.icon}{it.label}
                </Link>
              ) : (
                <span key={it.href} className={`flex items-center gap-2 px-2 ${pad} rounded-lg text-sm my-0.5 opacity-40 cursor-not-allowed`} title="后续版本上线">
                  {it.icon}{it.label}
                </span>
              ),
            )}
          </div>
        );
      })}
    </>
  );
}

export function Sidebar() {
  return (
    <aside className="hidden md:flex flex-col gap-4 w-52 shrink-0 p-4" style={{ borderRight: "1px solid var(--border)" }}>
      <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>EvoDesk</div>
      <NavLinks variant="desktop" />
    </aside>
  );
}
