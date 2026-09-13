"use client";
import { useEffect, useRef, useState } from "react";
import { THEMES, resolveTheme, applyThemeVars, type Theme } from "@/lib/domain/theme";

// 7 套主题选择器:双色预览圆点(accent + bg);选择即时生效并写 localStorage
export function ThemePicker({ compact = false }: { compact?: boolean }) {
  const [themeId, setThemeId] = useState<string>("dark-tech");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 下一帧同步实际主题(boot 脚本已应用),避免 SSR 与 localStorage 不一致告警
    const raf = requestAnimationFrame(() => {
      const stored = typeof window !== "undefined" ? window.localStorage.getItem("evodesk-theme") : null;
      setThemeId(resolveTheme(stored).id);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = (t: Theme) => {
    setThemeId(t.id);
    applyThemeVars(document, t);
    try {
      window.localStorage.setItem("evodesk-theme", t.id);
    } catch {
      /* 隐私模式等存储不可用:仅本次会话生效 */
    }
    // 广播主题变化(桌宠等主题联动组件监听)
    window.dispatchEvent(new Event("evodesk-theme-change"));
    setOpen(false);
  };

  const current = resolveTheme(themeId);
  return (
    <div ref={boxRef} className="relative">
      <button
        className="ghost-btn text-xs flex items-center gap-1.5"
        onClick={() => setOpen((v) => !v)}
        aria-label="切换主题风格"
        title="主题风格"
      >
        <span className="inline-flex rounded-full overflow-hidden shrink-0" style={{ width: 14, height: 14 }}>
          <span className="flex-1" style={{ background: current.vars.accent }} />
          <span className="flex-1" style={{ background: current.vars.bg }} />
        </span>
        {!compact && <span>{current.label}</span>}
        <span style={{ color: "var(--muted)" }}>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 surface p-1 shadow-lg z-30 min-w-44">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className="flex items-center gap-2 w-full text-left text-sm px-2 py-1.5 rounded hover:opacity-80"
              style={t.id === themeId ? { background: "var(--surface-2)", color: "var(--accent)" } : undefined}
              onClick={() => pick(t)}
            >
              <span className="inline-flex rounded-full overflow-hidden shrink-0" style={{ width: 16, height: 16 }}>
                <span className="flex-1" style={{ background: t.vars.accent }} />
                <span className="flex-1" style={{ background: t.vars.bg }} />
              </span>
              {t.label}
              {t.id === themeId && <span className="ml-auto">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
