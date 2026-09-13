// 模块可见性(权限管控):全局隐藏集 + 按工作台(画布)白名单覆盖。
// 纯函数;UI(Sidebar/MobileNav)消费本模块的计算结果。仅控制导航展示,不做接口鉴权(本地单用户)。

export type ModulePerms = {
  /** 全局隐藏的模块 href(缺省 []) */
  globalHidden: string[];
  /** 每个工作台(画布)可见模块白名单;未配置的工作台跟随全局 */
  canvasVisible: Record<string, string[]>;
};

export const EMPTY_PERMS: ModulePerms = { globalHidden: [], canvasVisible: {} };

/** settings.module_perms 安全解析(坏数据回退默认) */
export function modulePermsFromKv(raw: unknown): ModulePerms {
  if (!raw || typeof raw !== "object") return EMPTY_PERMS;
  const o = raw as Record<string, unknown>;
  const globalHidden = Array.isArray(o.globalHidden) ? o.globalHidden.filter((x): x is string => typeof x === "string") : [];
  const canvasVisible: Record<string, string[]> = {};
  if (o.canvasVisible && typeof o.canvasVisible === "object") {
    for (const [k, v] of Object.entries(o.canvasVisible as Record<string, unknown>)) {
      if (typeof k === "string" && k && Array.isArray(v)) {
        canvasVisible[k] = v.filter((x): x is string => typeof x === "string");
      }
    }
  }
  return { globalHidden, canvasVisible };
}

/** 工作台固定可见(防止把自己完全锁在门外) */
export const ALWAYS_VISIBLE = ["/"];

/**
 * 计算可见模块集合:
 * - 当前工作台存在白名单覆盖 → 可见 = 白名单(并上 ALWAYS_VISIBLE);
 * - 否则可见 = 全部 − 全局隐藏集(并上 ALWAYS_VISIBLE)。
 */
export function visibleHrefs(allHrefs: string[], perms: ModulePerms, activeCanvasId?: string | null): Set<string> {
  const always = new Set(ALWAYS_VISIBLE);
  const override = activeCanvasId ? perms.canvasVisible[activeCanvasId] : undefined;
  const visible = new Set<string>(always);
  if (Array.isArray(override)) {
    for (const href of override) visible.add(href);
  } else {
    for (const href of allHrefs) {
      if (!perms.globalHidden.includes(href)) visible.add(href);
    }
  }
  return visible;
}
