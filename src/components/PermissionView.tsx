"use client";
import { useCallback, useEffect, useState } from "react";
import { GROUPS } from "@/components/nav-registry";
import { modulePermsFromKv, type ModulePerms } from "@/lib/domain/module-visibility";

type CanvasMeta = { id: string; name: string; columns: string; locked: boolean };

function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

const ALL_ITEMS = GROUPS.flatMap((g) => g.items.map((it) => ({ ...it, group: g.label })));

// 权限管控:模块展示控制——
// 1) 全局模块开关:隐藏后从侧栏/移动导航消失;
// 2) 工作台差异化:为每个工作台(画布)配置可见模块白名单,切换工作台即切换模块组合。
// 仅控制导航展示(本地单用户,不做接口鉴权);「工作台」首页恒可见,防止锁死。
export function PermissionView() {
  const [perms, setPerms] = useState<ModulePerms>({ globalHidden: [], canvasVisible: {} });
  const [canvases, setCanvases] = useState<CanvasMeta[]>([]);
  const [selCanvas, setSelCanvas] = useState<string>("__global__");
  const [draft, setDraft] = useState<ModulePerms | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [sRes, cRes] = await Promise.all([fetch("/api/settings"), fetch("/api/canvases")]);
      const sData = await sRes.json();
      setPerms(modulePermsFromKv(sData.settings?.module_perms));
      const cData = await cRes.json();
      setCanvases(((cData as { canvases?: CanvasMeta[] }).canvases ?? []).filter((c) => !c.locked));
    } catch {
      setError("加载失败,请刷新重试");
    }
  }, []);
  useEffect(() => {
    const raf = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const draftPerms = draft ?? perms;
  const override = selCanvas !== "__global__" ? draftPerms.canvasVisible[selCanvas] : undefined;

  const toggleGlobal = (href: string) => {
    const next: ModulePerms = { ...draftPerms, globalHidden: draftPerms.globalHidden.includes(href) ? draftPerms.globalHidden.filter((h) => h !== href) : [...draftPerms.globalHidden, href] };
    setDraft(next);
  };
  const toggleCanvasItem = (href: string) => {
    const cur = override ?? [];
    const nextList = cur.includes(href) ? cur.filter((h) => h !== href) : [...cur, href];
    setDraft({ ...draftPerms, canvasVisible: { ...draftPerms.canvasVisible, [selCanvas]: nextList } });
  };
  const setCanvasMode = (mode: "follow" | "custom") => {
    const nextCanvas = { ...draftPerms.canvasVisible };
    if (mode === "follow") delete nextCanvas[selCanvas];
    else nextCanvas[selCanvas] = nextCanvas[selCanvas] ?? ALL_ITEMS.map((it) => it.href);
    setDraft({ ...draftPerms, canvasVisible: nextCanvas });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ module_perms: draftPerms }) });
      if (!res.ok) {
        setError(errorOf(await res.json().catch(() => null), "保存失败"));
        return;
      }
      setPerms(draftPerms);
      setDraft(null);
      setNotice("已保存,导航即时生效");
      window.dispatchEvent(new Event("evodesk-canvas-change"));
    } catch {
      setError("保存请求失败");
    } finally {
      setSaving(false);
    }
  };

  const selCanvasName = canvases.find((c) => c.id === selCanvas)?.name ?? "全局默认";

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">权限管控</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        控制各模块在导航中的展示:全局开关统一隐藏/恢复;为不同工作台(画布)配置不同可见模块,
        切换工作台即切换功能组合。仅控制导航展示,不影响数据与接口(本地单用户)。「工作台」首页恒可见。
      </p>

      {error && <div className="text-xs mb-3" style={{ color: "var(--danger)" }}>{error}</div>}
      {notice && <div className="text-xs mb-3" style={{ color: "var(--accent)" }}>{notice}</div>}

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-3">
          <span className="text-sm font-medium">1️⃣ 全局模块开关</span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>取消勾选 = 全局隐藏该模块</span>
        </div>
        <div className="grid md:grid-cols-2 gap-1.5">
          {ALL_ITEMS.map((it) => {
            const inCanvasOverride = selCanvas !== "__global__" && override !== undefined;
            const checkedGlobal = !draftPerms.globalHidden.includes(it.href);
            const checked = inCanvasOverride ? (override!.includes(it.href) || it.href === "/") : checkedGlobal;
            return (
              <label key={it.href} className="flex items-center gap-2 text-sm rounded px-2 py-1 cursor-pointer" style={{ background: "var(--surface-2)" }}>
                <input type="checkbox" checked={checked} disabled={it.href === "/" || (inCanvasOverride && it.href === "/")}
                  onChange={() => (inCanvasOverride ? toggleCanvasItem(it.href) : toggleGlobal(it.href))} />
                <span className="text-xs px-1 rounded" style={{ color: "var(--muted)" }}>{it.group}</span>
                <span className="truncate">{it.label}</span>
                {it.href === "/" && <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>恒可见</span>}
              </label>
            );
          })}
        </div>
      </div>

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <span className="text-sm font-medium">2️⃣ 工作台差异化</span>
          <select className="input text-xs max-w-56" value={selCanvas} onChange={(e) => setSelCanvas(e.target.value)} aria-label="选择工作台">
            <option value="__global__">全局默认(所有工作台)</option>
            {canvases.map((c) => <option key={c.id} value={c.id}>工作台:{c.name}</option>)}
          </select>
          {selCanvas !== "__global__" && (
            <div className="flex gap-1.5 text-xs">
              <button className={`ghost-btn px-2 py-1 ${override === undefined ? "ring-1" : ""}`}
                style={override === undefined ? { color: "var(--accent)" } : undefined}
                onClick={() => setCanvasMode("follow")}>跟随全局</button>
              <button className={`ghost-btn px-2 py-1 ${override !== undefined ? "ring-1" : ""}`}
                style={override !== undefined ? { color: "var(--accent)" } : undefined}
                onClick={() => setCanvasMode("custom")}>自定义模块组合</button>
            </div>
          )}
        </div>
        {selCanvas === "__global__" ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            选择一个工作台后,可为其配置独立可见模块组合;左侧勾选区会切换为该工作台的白名单编辑。
            切换工作台(首页工作台切换器)时,导航自动切换到对应组合。
          </div>
        ) : override === undefined ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>「{selCanvasName}」当前跟随全局默认;点「自定义模块组合」开始差异化配置。</div>
        ) : (
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            正在编辑「{selCanvasName}」的白名单:上方勾选区即为该工作台可见模块(当前 {override.length} 个),修改后点下方保存。
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button className="accent-btn text-xs px-4 py-1.5" onClick={() => void save()} disabled={saving || draft === null}>
          {saving ? "保存中…" : draft === null ? "无改动" : "保存配置"}
        </button>
        {draft !== null && <button className="ghost-btn text-xs px-4 py-1.5" onClick={() => { setDraft(null); }}>放弃改动</button>}
      </div>
    </div>
  );
}
