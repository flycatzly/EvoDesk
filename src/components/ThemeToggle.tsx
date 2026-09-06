"use client";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => {
    // 挂载后从 DOM 同步实际主题(SSR 渲染默认深色);推迟到下一帧调用 setState 以符合 react-hooks/set-state-in-effect
    const raf = requestAnimationFrame(() => setDark(document.documentElement.classList.contains("dark")));
    return () => cancelAnimationFrame(raf);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("evodesk-theme", next ? "dark" : "light");
  };
  return (
    <button onClick={toggle} className="ghost-btn px-3 py-1.5 text-sm" aria-label="切换主题">
      {dark ? "🌙" : "☀️"}
    </button>
  );
}
