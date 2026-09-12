import { getDb } from "@/lib/db/client";
import { tasks, projects, quickActions } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";
import { TaskCard } from "@/components/TaskCard";
import { QuickActionsCard } from "@/components/QuickActionsCard";

export const dynamic = "force-dynamic";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const db = getDb();
  tickRecurring(db);
  const allTasks = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
  const projectRows = db.select().from(projects).all() as (typeof projects.$inferSelect)[];
  const projectName = (id: string | null) => projectRows.find((p) => p.id === id)?.name;
  const active = allTasks.filter((t) => !["done", "archived", "canceled"].includes(t.status));
  // ISO 字符串字典序即日期序:延期与即将截止都按到期日升序(最旧的在前)
  const overdue = active.filter((t) => t.dueDate && t.dueDate < today()).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const dueToday = active.filter((t) => t.dueDate === today());
  const upcoming = active.filter((t) => t.dueDate && t.dueDate > today()).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)).slice(0, 5);
  const counters = [
    { label: "今日待办", value: dueToday.length + overdue.length },
    { label: "执行中", value: allTasks.filter((t) => t.status === "running").length },
    { label: "待人工", value: allTasks.filter((t) => t.status === "waiting_human").length },
    { label: "收件箱", value: allTasks.filter((t) => t.status === "inbox").length },
  ];
  // 仅启用项;排序与 /api/quick-actions GET 一致:sort asc → createdAt asc(enabled 已过滤)
  const quickActionRows = (db.select().from(quickActions).all() as (typeof quickActions.$inferSelect)[])
    .filter((a) => a.enabled)
    .sort((a, b) => (a.sort !== b.sort ? a.sort - b.sort : a.createdAt.localeCompare(b.createdAt)));

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-4">仪表盘</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {counters.map((c) => (
          <div key={c.label} className="surface p-4">
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>{c.label}</div>
          </div>
        ))}
      </div>
      <QuickActionsCard actions={quickActionRows} />
      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-2">今日清单(含延期置顶)</h2>
          {[...overdue, ...dueToday].length === 0
            ? <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>今天没有截止任务,安排点小事或休息。</div>
            : [...overdue, ...dueToday].map((t) => <TaskCard key={t.id} task={t} projectName={projectName(t.projectId)} />)}
        </section>
        <section>
          <h2 className="font-semibold mb-2">项目进度</h2>
          {projectRows.map((p) => {
            const pt = allTasks.filter((t) => t.projectId === p.id);
            const done = pt.filter((t) => ["done", "archived"].includes(t.status)).length;
            const pct = pt.length === 0 ? 0 : Math.round((done / pt.length) * 100);
            return (
              <div key={p.id} className="surface p-3 mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span>{p.name}</span>
                  <span style={{ color: "var(--muted)" }}>{done}/{pt.length} · {pct}%</span>
                </div>
                <div className="h-2 rounded" style={{ background: "var(--surface-2)" }}>
                  <div className="h-2 rounded" style={{ width: `${pct}%`, background: `linear-gradient(90deg, var(--accent), var(--accent-2))` }} />
                </div>
              </div>
            );
          })}
          <h2 className="font-semibold mb-2 mt-4">即将截止</h2>
          {upcoming.length === 0
            ? <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>暂无</div>
            : upcoming.map((t) => <TaskCard key={t.id} task={t} projectName={projectName(t.projectId)} />)}
        </section>
      </div>
    </div>
  );
}
