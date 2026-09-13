"use client";
import { useEffect, useMemo, useState } from "react";
import { modulePermsFromKv, visibleHrefs, type ModulePerms } from "@/lib/domain/module-visibility";
import { GROUPS } from "./nav-registry";

const STORAGE_KEY = "evodesk-active-canvas";
export const CANVAS_CHANGE_EVENT = "evodesk-canvas-change";

const ALL_HREFS = GROUPS.flatMap((g) => g.items.map((it) => it.href));

/** 当前可见模块集合:监听 settings(module_perms)与当前工作台(localStorage + 自定义事件) */
export function useModuleVisibility() {
  const [perms, setPerms] = useState<ModulePerms>({ globalHidden: [], canvasVisible: {} });
  const [activeCanvas, setActiveCanvas] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/settings");
        const data = (await res.json()) as { settings?: Record<string, unknown> };
        setPerms(modulePermsFromKv(data.settings?.module_perms));
      } catch { /* 读取失败按全可见 */ }
    };
    const readCanvas = () => {
      try { setActiveCanvas(localStorage.getItem(STORAGE_KEY)); } catch { setActiveCanvas(null); }
    };
    const raf = requestAnimationFrame(() => { void load(); readCanvas(); });
    const onChange = () => { void load(); readCanvas(); };
    window.addEventListener(CANVAS_CHANGE_EVENT, onChange);
    return () => { cancelAnimationFrame(raf); window.removeEventListener(CANVAS_CHANGE_EVENT, onChange); };
  }, []);

  const visible = useMemo(() => visibleHrefs(ALL_HREFS, perms, activeCanvas), [perms, activeCanvas]);
  const hasCanvasOverride = !!(activeCanvas && perms.canvasVisible[activeCanvas]);
  return { visible, activeCanvas, hasCanvasOverride };
}
