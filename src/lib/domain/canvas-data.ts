// 画布组件数据源:RSC 一次性收集画布用到的各组件数据,序列化后传给客户端 CanvasBoard。
// 只读查询,绝不写库;vault 统计对无效路径容错(计数为 0),不让画布因知识库未配置而崩。
import type { Db } from "@/lib/db/test-util";
import { tasks, projects, notes, links, goals, quickActions, flowRuns, flowTemplates } from "@/lib/db/schema";
import { readSettingsKv } from "@/lib/db/read-settings";
import { tzToday } from "@/lib/domain/tz";
import { getVaultRoot } from "@/lib/domain/vault";
import { readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WidgetType } from "@/lib/domain/canvas";

export type TaskLite = {
  id: string; title: string; priority: number; dueDate: string | null;
  status: string; overdue: boolean; projectName: string | null;
};
export type RadarItem = { kind: "overdue" | "timeout" | "budget" | "performance"; label: string; detail: string; href?: string };

export type WidgetData = {
  counters: {
    today: number; overdue: number; running: number; waitingHuman: number; inbox: number; notes: number;
    projects: { name: string; total: number; done: number; pct: number; color: string }[];
  };
  todo: { tasks: TaskLite[] };
  calendar: { today: string; monthLabel: string; dayCounts: Record<string, number> };
  notesWidget: { notes: { id: string; title: string; updatedAt: string }[] };
  links: { groups: { category: string; links: { id: string; title: string; url: string }[] }[] };
  goalsWidget: { goals: { id: string; title: string; current: number; target: number; unit: string; color: string | null; deadline: string | null; category: string }[] };
  vault: { configured: boolean; rootName: string; noteCount: number; dirCount: number };
  radar: { items: RadarItem[] };
  quickactions: { actions: { id: string; name: string; type: string; icon: string | null }[] };
};
export type WidgetDataBundle = { [K in WidgetType]?: WidgetData[K] };

/** 风险雷达四类项(从旧仪表盘 page.tsx 原样抽取,口径不变) */
export function buildRadarItems(db: Db, allTasks: (typeof tasks.$inferSelect)[], overdueCount: number, overdueTitles: string[], now: Date): RadarItem[] {
  const kv = readSettingsKv(db);
  const timeoutHours = typeof kv.waiting_human_timeout_hours === "number" ? kv.waiting_human_timeout_hours : 24;
  const costBudgetUsd = typeof kv.cost_budget_usd === "number" ? kv.cost_budget_usd : 10;
  const timeoutTasks = allTasks.filter(
    (t) => t.status === "waiting_human" && now.getTime() - new Date(t.updatedAt).getTime() > timeoutHours * 3600_000
  );
  const flowRunRows = db.select().from(flowRuns).all() as (typeof flowRuns.$inferSelect)[];
  const weekAgoIso = new Date(now.getTime() - 7 * 24 * 3600_000).toISOString();
  const weekCostUsd = flowRunRows.filter((r) => r.startedAt > weekAgoIso).reduce((s, r) => s + r.totalCostUsd, 0);
  const flowTemplateRows = db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[];
  const lowPerfTemplates = flowTemplateRows.filter((t) => t.statRuns >= 5 && t.statSuccessRate < 0.5);

  const items: RadarItem[] = [];
  if (overdueCount > 0) {
    items.push({ kind: "overdue", label: "已延期任务", detail: `${overdueCount} 项已逾期:${overdueTitles.slice(0, 5).join("、")}`, href: "/tasks" });
  }
  if (timeoutTasks.length > 0) {
    items.push({ kind: "timeout", label: "待人工超时", detail: `${timeoutTasks.length} 项待人工超过 ${timeoutHours} 小时`, href: "/tasks" });
  }
  if (weekCostUsd > costBudgetUsd) {
    items.push({ kind: "budget", label: "成本预算超支", detail: `近 7 天已花费 $${weekCostUsd.toFixed(2)} / 预算 $${costBudgetUsd.toFixed(2)}` });
  }
  if (lowPerfTemplates.length > 0) {
    items.push({ kind: "performance", label: "低绩效流程模板", detail: lowPerfTemplates.map((t) => `${t.name}(成功率 ${Math.round(t.statSuccessRate * 100)}%)`).join("、"), href: "/flows" });
  }
  return items;
}

/** vault 概览统计:遍历上限 500 项,异常(路径不存在/无权限)一律按未配置处理 */
function vaultStats(db: Db): WidgetData["vault"] {
  const root = getVaultRoot(db);
  if (!root || !existsSync(root)) return { configured: false, rootName: "", noteCount: 0, dirCount: 0 };
  let noteCount = 0;
  let dirCount = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || noteCount + dirCount > 500) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        dirCount++;
        walk(full, depth + 1);
      } else if (name.toLowerCase().endsWith(".md")) {
        noteCount++;
      }
    }
  };
  walk(root, 0);
  return { configured: true, rootName: root.split(/[\\/]/).filter(Boolean).pop() ?? root, noteCount, dirCount };
}

/** 按画布用到的组件类型收集数据;未请求的类型不出现在结果里 */
export function collectWidgetData(db: Db, types: WidgetType[], timezone?: string | null, now: Date = new Date()): WidgetDataBundle {
  const wanted = new Set<WidgetType>(types);
  const needsTasks = wanted.has("counters") || wanted.has("todo") || wanted.has("calendar") || wanted.has("radar");
  const allTasks = needsTasks ? (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]) : [];
  const todayStr = tzToday(typeof timezone === "string" ? timezone : "", now);
  const active = allTasks.filter((t) => !["done", "archived", "canceled"].includes(t.status));
  const overdue = active.filter((t) => t.dueDate && t.dueDate < todayStr).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const dueToday = active.filter((t) => t.dueDate === todayStr);
  const projectRows = (db.select().from(projects).all() as (typeof projects.$inferSelect)[]).filter((p) => !p.archived);
  const projectName = (id: string | null) => projectRows.find((p) => p.id === id)?.name ?? null;
  const toLite = (t: typeof tasks.$inferSelect): TaskLite => ({
    id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, status: t.status,
    overdue: !!(t.dueDate && t.dueDate < todayStr), projectName: projectName(t.projectId),
  });

  const bundle: WidgetDataBundle = {};

  if (wanted.has("counters")) {
    bundle.counters = {
      today: dueToday.length + overdue.length,
      overdue: overdue.length,
      running: allTasks.filter((t) => t.status === "running").length,
      waitingHuman: allTasks.filter((t) => t.status === "waiting_human").length,
      inbox: allTasks.filter((t) => t.status === "inbox").length,
      notes: (db.select().from(notes).all() as unknown[]).length,
      projects: projectRows.map((p) => {
        const pt = allTasks.filter((t) => t.projectId === p.id);
        const done = pt.filter((t) => ["done", "archived"].includes(t.status)).length;
        return { name: p.name, total: pt.length, done, pct: pt.length === 0 ? 0 : Math.round((done / pt.length) * 100), color: p.color };
      }),
    };
  }
  if (wanted.has("todo")) {
    bundle.todo = { tasks: [...overdue, ...dueToday].map(toLite) };
  }
  if (wanted.has("calendar")) {
    // 当月逐日任务数(dueDate 为 yyyy-mm-dd,直接按前缀聚合计数)
    const monthPrefix = todayStr.slice(0, 7);
    const dayCounts: Record<string, number> = {};
    for (const t of allTasks) {
      if (t.dueDate && t.dueDate.startsWith(monthPrefix)) dayCounts[t.dueDate] = (dayCounts[t.dueDate] ?? 0) + 1;
    }
    const [y, m] = monthPrefix.split("-").map(Number);
    bundle.calendar = { today: todayStr, monthLabel: `${y} 年 ${m} 月`, dayCounts };
  }
  if (wanted.has("notes")) {
    const rows = (db.select().from(notes).all() as (typeof notes.$inferSelect)[])
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5)
      .map((n) => ({ id: n.id, title: n.title, updatedAt: n.updatedAt }));
    bundle.notesWidget = { notes: rows };
  }
  if (wanted.has("links")) {
    const rows = (db.select().from(links).all() as (typeof links.$inferSelect)[])
      .sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
    const byCat = new Map<string, { id: string; title: string; url: string }[]>();
    for (const l of rows) {
      const list = byCat.get(l.category) ?? [];
      list.push({ id: l.id, title: l.title, url: l.url });
      byCat.set(l.category, list);
    }
    bundle.links = { groups: [...byCat.entries()].map(([category, ls]) => ({ category, links: ls })) };
  }
  if (wanted.has("goals")) {
    bundle.goalsWidget = {
      goals: (db.select().from(goals).all() as (typeof goals.$inferSelect)[])
        .filter((g) => !g.archived)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((g) => ({ id: g.id, title: g.title, current: g.current, target: g.target, unit: g.unit, color: g.color, deadline: g.deadline, category: g.category })),
    };
  }
  if (wanted.has("vault")) {
    bundle.vault = vaultStats(db);
  }
  if (wanted.has("radar")) {
    bundle.radar = { items: buildRadarItems(db, allTasks, overdue.length, overdue.map((t) => t.title), now) };
  }
  if (wanted.has("quickactions")) {
    bundle.quickactions = {
      actions: (db.select().from(quickActions).all() as (typeof quickActions.$inferSelect)[])
        .filter((a) => a.enabled)
        .sort((a, b) => (a.sort !== b.sort ? a.sort - b.sort : a.createdAt.localeCompare(b.createdAt)))
        .map((a) => ({ id: a.id, name: a.name, type: a.type, icon: a.icon })),
    };
  }
  return bundle;
}
