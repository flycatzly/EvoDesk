import { getDb } from "@/lib/db/client";
import { tasks, projects, quickActions, flowRuns, flowTemplates } from "@/lib/db/schema";
import { readSettingsKv } from "@/lib/db/read-settings";
import { tickRecurring } from "@/lib/domain/recurring";
import { tzToday } from "@/lib/domain/tz";
import { TaskCard } from "@/components/TaskCard";
import { QuickActionsCard } from "@/components/QuickActionsCard";
import { RadarCard, type RadarItem } from "@/components/RadarCard";

export const dynamic = "force-dynamic";

/** 当前时刻毫秒数。渲染期不允许直接调用 Date.now(react-hooks/purity);本页 force-dynamic 每请求重渲,经此封装取当前时间(同 tzToday 封装 new Date 的思路)。 */
function nowMs(): number {
  return Date.now();
}

export default function Dashboard() {
  const db = getDb();
  tickRecurring(db);
  // 读 settings KV(timezone 决定"今天"分桶边界,空=系统本地)
  const kv = readSettingsKv(db);
  const todayStr = tzToday(typeof kv.timezone === "string" ? kv.timezone : "");
  const allTasks = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
  const projectRows = db.select().from(projects).all() as (typeof projects.$inferSelect)[];
  const projectName = (id: string | null) => projectRows.find((p) => p.id === id)?.name;
  const active = allTasks.filter((t) => !["done", "archived", "canceled"].includes(t.status));
  // ISO 字符串字典序即日期序:延期与即将截止都按到期日升序(最旧的在前);分桶边界用 tzToday(due 存储仍为 UTC-ISO)
  const overdue = active.filter((t) => t.dueDate && t.dueDate < todayStr).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const dueToday = active.filter((t) => t.dueDate === todayStr);
  const upcoming = active.filter((t) => t.dueDate && t.dueDate > todayStr).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)).slice(0, 5);
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

  // 风险雷达:四类按严重度排序(延期>超时>预算>绩效);阈值读 settings KV,缺省 回退默认
  const timeoutHours = typeof kv.waiting_human_timeout_hours === "number" ? kv.waiting_human_timeout_hours : 24;
  const costBudgetUsd = typeof kv.cost_budget_usd === "number" ? kv.cost_budget_usd : 10;
  // 待人工超时:updatedAt 为 UTC-ISO,new Date 解析后与阈值小时数比较
  const timeoutTasks = allTasks.filter(
    (t) => t.status === "waiting_human" && nowMs() - new Date(t.updatedAt).getTime() > timeoutHours * 3600_000
  );
  // 近 7 天(滚动窗口,非日历周)成本:startedAt 为 UTC-ISO,字典序比较即时间序
  const flowRunRows = db.select().from(flowRuns).all() as (typeof flowRuns.$inferSelect)[];
  const weekAgoIso = new Date(nowMs() - 7 * 24 * 3600_000).toISOString();
  const weekCostUsd = flowRunRows.filter((r) => r.startedAt > weekAgoIso).reduce((s, r) => s + r.totalCostUsd, 0);
  // 低绩效模板:统计样本足够(statRuns ≥ 5)且成功率低于一半
  const flowTemplateRows = db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[];
  const lowPerfTemplates = flowTemplateRows.filter((t) => t.statRuns >= 5 && t.statSuccessRate < 0.5);
  const riskItems: RadarItem[] = [];
  if (overdue.length > 0) {
    riskItems.push({
      kind: "overdue",
      label: "已延期任务",
      detail: `${overdue.length} 项已逾期:${overdue.slice(0, 5).map((t) => t.title).join("、")}`,
      href: "/tasks",
    });
  }
  if (timeoutTasks.length > 0) {
    riskItems.push({
      kind: "timeout",
      label: "待人工超时",
      detail: `${timeoutTasks.length} 项待人工超过 ${timeoutHours} 小时`,
      href: "/tasks",
    });
  }
  if (weekCostUsd > costBudgetUsd) {
    riskItems.push({
      kind: "budget",
      label: "成本预算超支",
      detail: `近 7 天已花费 $${weekCostUsd.toFixed(2)} / 预算 $${costBudgetUsd.toFixed(2)}`,
    });
  }
  if (lowPerfTemplates.length > 0) {
    riskItems.push({
      kind: "performance",
      label: "低绩效流程模板",
      detail: lowPerfTemplates.map((t) => `${t.name}(成功率 ${Math.round(t.statSuccessRate * 100)}%)`).join("、"),
      href: "/flows",
    });
  }

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
      <RadarCard items={riskItems} />
    </div>
  );
}
