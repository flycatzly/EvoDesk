import Link from "next/link";
import type { WidgetData } from "@/lib/domain/canvas-data";

// 核心指标格:今日待办/逾期/执行中/待人工/收件箱/灵感数 + 项目进度条
export function CountersWidget({ data }: { data: WidgetData["counters"] }) {
  const items = [
    { label: "今日待办", value: data.today, warn: data.today > 0 },
    { label: "逾期", value: data.overdue, warn: data.overdue > 0 },
    { label: "执行中", value: data.running, warn: false },
    { label: "待人工", value: data.waitingHuman, warn: data.waitingHuman > 0 },
    { label: "收件箱", value: data.inbox, warn: false },
    { label: "灵感数量", value: data.notes, warn: false },
  ];
  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {items.map((it) => (
          <div key={it.label} className="rounded p-2" style={{ background: "var(--surface-2)" }}>
            <div className="text-lg font-bold" style={it.warn && it.value > 0 ? { color: "var(--warn)" } : undefined}>{it.value}</div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>{it.label}</div>
          </div>
        ))}
      </div>
      {data.projects.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {data.projects.map((p) => (
            <div key={p.name}>
              <div className="flex justify-between text-xs mb-0.5">
                <span>{p.name}</span>
                <span style={{ color: "var(--muted)" }}>{p.done}/{p.total} · {p.pct}%</span>
              </div>
              <div className="h-1.5 rounded" style={{ background: "var(--surface-2)" }}>
                <div className="h-1.5 rounded" style={{ width: `${p.pct}%`, background: p.color || "var(--accent)" }} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-xs">
        <Link href="/tasks" className="hover:opacity-80" style={{ color: "var(--accent)" }}>查看任务 →</Link>
      </div>
    </div>
  );
}
