import { WidgetEmpty } from "./WidgetEmpty";
import type { WidgetData } from "@/lib/domain/canvas-data";

const CATEGORY_LABEL: Record<string, string> = { reading: "阅读", fitness: "健身", project: "项目", custom: "自定义" };

// 目标进度组件:进度条列表(超额显示 ✓)
export function GoalsWidget({ data }: { data: WidgetData["goals"] }) {
  if (data.goals.length === 0) {
    return <WidgetEmpty text="还没有目标。" href="/goals" linkLabel="去创建 →" />;
  }
  return (
    <div className="space-y-2.5">
      {data.goals.map((g) => {
        const pct = g.target === 0 ? 0 : Math.min(100, Math.round((g.current / g.target) * 100));
        const done = g.current >= g.target;
        return (
          <div key={g.id}>
            <div className="flex justify-between text-sm mb-0.5">
              <span className="truncate" title={g.title}>
                <span className="text-xs mr-1" style={{ color: "var(--muted)" }}>{CATEGORY_LABEL[g.category] ?? g.category}</span>
                {g.title}
              </span>
              <span className="shrink-0 text-xs" style={{ color: "var(--muted)" }}>
                {g.current}/{g.target}{g.unit} {done ? "✓" : `${pct}%`}
              </span>
            </div>
            <div className="h-2 rounded" style={{ background: "var(--surface-2)" }}>
              <div
                className="h-2 rounded"
                style={{ width: `${pct}%`, background: done ? "var(--ok)" : g.color || "linear-gradient(90deg, var(--accent), var(--accent-2))" }}
              />
            </div>
            {g.deadline && <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>截止 {g.deadline}</div>}
          </div>
        );
      })}
    </div>
  );
}
