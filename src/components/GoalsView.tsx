"use client";
import { useCallback, useEffect, useState } from "react";

type GoalRow = {
  id: string; title: string; category: string; target: number; current: number;
  unit: string; deadline: string | null; color: string | null; archived: boolean;
};

const CATEGORY_LABEL: Record<string, string> = { reading: "阅读", fitness: "健身", project: "项目", custom: "自定义" };
const FILTERS = ["all", "reading", "fitness", "project", "custom"] as const;

// 目标进度管理:进度条 + current 步进/直接输入、归档、类别筛选
export function GoalsView() {
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [form, setForm] = useState({ title: "", category: "reading", target: 10, unit: "", deadline: "" });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/goals${showArchived ? "?archived=1" : ""}`);
      const data = (await res.json()) as { goals?: GoalRow[] };
      setGoals(data.goals ?? []);
    } catch {
      setError("加载失败,请刷新重试");
    } finally {
      setLoading(false);
    }
  }, [showArchived]);
  // 下一帧加载:避免 effect 内同步 setState(react-hooks/set-state-in-effect)
  useEffect(() => {
    const raf = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const add = async () => {
    setError(null);
    const res = await fetch("/api/goals", {
      method: "POST",
      body: JSON.stringify({ ...form, target: Number(form.target), deadline: form.deadline || null }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "创建失败");
      return;
    }
    setForm({ title: "", category: form.category, target: 10, unit: "", deadline: "" });
    void load();
  };
  const patch = async (id: string, body: Record<string, unknown>) => {
    const res = await fetch(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (res.ok) void load();
    else setError("保存失败");
  };
  const remove = async (id: string) => {
    if (!window.confirm("删除该目标?进度记录不可恢复。")) return;
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    void load();
  };

  const shown = filter === "all" ? goals : goals.filter((g) => g.category === filter);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">目标进度</h1>

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <input className="input text-sm flex-1 min-w-32" placeholder="目标名称" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="input text-sm w-24" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.entries(CATEGORY_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
          <input className="input text-sm w-20" type="number" min={1} placeholder="目标值" value={form.target}
            onChange={(e) => setForm({ ...form, target: Number(e.target.value) })} />
          <input className="input text-sm w-20" placeholder="单位" value={form.unit}
            onChange={(e) => setForm({ ...form, unit: e.target.value })} />
          <input className="input text-sm w-36" type="date" value={form.deadline}
            onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          <button className="accent-btn text-xs" onClick={() => void add()} disabled={!form.title.trim() || !(form.target > 0)}>创建</button>
        </div>
        {error && <div className="text-xs mt-2" style={{ color: "var(--danger)" }}>{error}</div>}
      </div>

      <div className="flex gap-1.5 mb-3 flex-wrap items-center">
        {FILTERS.map((f) => (
          <button key={f} className="ghost-btn text-xs" style={filter === f ? { color: "var(--accent)" } : undefined}
            onClick={() => setFilter(f)}>{f === "all" ? "全部" : CATEGORY_LABEL[f]}</button>
        ))}
        <label className="ml-auto text-xs flex items-center gap-1" style={{ color: "var(--muted)" }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          显示已归档
        </label>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: "var(--muted)" }}>加载中…</div>
      ) : shown.length === 0 ? (
        <div className="surface p-6 text-sm text-center" style={{ color: "var(--muted)" }}>
          没有目标 —— 读书、健身、项目里程碑,建一个看得见的进度条。
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((g) => {
            const pct = g.target === 0 ? 0 : Math.min(100, Math.round((g.current / g.target) * 100));
            const done = g.current >= g.target;
            return (
              <div key={g.id} className="surface p-3" style={g.archived ? { opacity: 0.6 } : undefined}>
                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                  <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
                    {CATEGORY_LABEL[g.category] ?? g.category}
                  </span>
                  <span className="font-medium text-sm flex-1 truncate">{g.title}</span>
                  {done && <span className="text-xs" style={{ color: "var(--ok)" }}>✓ 已达成</span>}
                  {g.deadline && <span className="text-xs" style={{ color: "var(--muted)" }}>截止 {g.deadline}</span>}
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{g.current}/{g.target}{g.unit}</span>
                </div>
                <div className="h-2.5 rounded mb-2" style={{ background: "var(--surface-2)" }}>
                  <div className="h-2.5 rounded" style={{ width: `${pct}%`, background: done ? "var(--ok)" : g.color || "linear-gradient(90deg, var(--accent), var(--accent-2))" }} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span style={{ color: "var(--muted)" }}>进度</span>
                  <button className="ghost-btn" onClick={() => void patch(g.id, { current: Math.max(0, g.current - 1) })} disabled={g.current <= 0}>−1</button>
                  <input className="input w-16 text-xs" type="number" min={0} value={g.current}
                    onChange={(e) => { const v = Number(e.target.value); if (v >= 0) void patch(g.id, { current: v }); }} />
                  <button className="ghost-btn" onClick={() => void patch(g.id, { current: g.current + 1 })}>+1</button>
                  <span className="ml-auto flex gap-1.5">
                    <button className="ghost-btn" onClick={() => void patch(g.id, { archived: !g.archived })}>
                      {g.archived ? "取消归档" : "归档"}
                    </button>
                    <button className="ghost-btn" style={{ color: "var(--danger)" }} onClick={() => void remove(g.id)}>删除</button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
