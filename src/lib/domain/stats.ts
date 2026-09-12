import type { Db } from "@/lib/db/test-util";
import { tasks, flowRuns, flowTemplates, notes } from "@/lib/db/schema";
import { weekDates, inWeek, localDateIso } from "./week";

export type DayPoint = { date: string; count: number };
export type CostPoint = { date: string; cost: number };
export type TemplateStat = { name: string; runs: number; successRate: number; avgCost: number; avgSatisfaction: number };
export type WeekReview = {
  completionRate: number | null; // 本周完成 /(本周完成 + 本周截止未完成);分母 0 → null
  dailyDone: DayPoint[]; // 本周 7 天(本地日,周一 → 周日)done 计数
  newTasks: number; // 本周新增任务(createdAt)
  newNotes: number; // 本周新增笔记(createdAt)
};

export type StatsPayload = {
  completions: DayPoint[]; // 近 14 天 done 任务按 updatedAt UTC 日计数,空日补零
  costs: CostPoint[]; // 近 14 天 flow_runs.totalCostUsd 按 startedAt UTC 日求和,空日补零
  templates: TemplateStat[]; // statRuns > 0 的模板(数值来自 refreshTemplateStats 维护的 stat 列)
  week: WeekReview; // 本周复盘(timezone 感知,周一为一周始)
};

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;
/** UTC 日键(schema 约定:DB 时间列恒存 UTC-ISO,统计口径同为 UTC 日,不做时区换算) */
const dayKey = (iso: string) => iso.slice(0, 10);

/**
 * 一次聚合出统计页数据段。读全量后 JS 分桶(个人规模可接受,与既有读全量过滤模式一致)。
 * `now` 可注入以便测试固定 14 天窗口;默认当前时间。`timezone` 仅影响 week 段的本地周边界。
 */
export function buildStats(db: Db, now: Date = new Date(), timezone?: string | null): StatsPayload {
  // 14 天窗口:起点 = now - 14*24h(含),桶为「今天往前 14 个 UTC 日」(旧→新,供折线顺序展示)
  const windowStartMs = now.getTime() - WINDOW_DAYS * DAY_MS;
  const buckets = Array.from({ length: WINDOW_DAYS }, (_, i) =>
    new Date(now.getTime() - (WINDOW_DAYS - 1 - i) * DAY_MS).toISOString().slice(0, 10),
  );
  const counts = new Map<string, number>(buckets.map((d) => [d, 0]));
  const costs = new Map<string, number>(buckets.map((d) => [d, 0]));
  // 窗口双重过滤:时间戳落在 [now-14d, now] 且其 UTC 日键属于 14 个桶(窗口首日的零点段落在桶外,自然丢弃)
  const inWindow = (iso: string) => {
    const ts = Date.parse(iso);
    return ts >= windowStartMs && ts <= now.getTime() && counts.has(dayKey(iso));
  };

  for (const t of db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]) {
    if (t.status !== "done" || !inWindow(t.updatedAt)) continue;
    counts.set(dayKey(t.updatedAt), counts.get(dayKey(t.updatedAt))! + 1);
  }
  for (const r of db.select().from(flowRuns).all() as (typeof flowRuns.$inferSelect)[]) {
    if (!inWindow(r.startedAt)) continue;
    costs.set(dayKey(r.startedAt), costs.get(dayKey(r.startedAt))! + r.totalCostUsd);
  }

  const templates = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[])
    .filter((t) => t.statRuns > 0)
    .map((t) => ({
      name: t.name,
      runs: t.statRuns,
      successRate: t.statSuccessRate,
      avgCost: t.statAvgCostUsd,
      avgSatisfaction: t.statAvgSatisfaction,
    }));

  // —— 本周复盘段(timezone 感知周一始)——
  const dates = weekDates(now.toISOString(), timezone);
  const dateSet = new Set(dates);
  const doneByLocalDay = new Map<string, number>(dates.map((d) => [d, 0]));
  let doneInWeek = 0;
  let unmetInWeek = 0;
  let newTasksCount = 0;
  const nowIso = now.toISOString();
  for (const t of db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]) {
    if (inWeek(t.createdAt, nowIso, timezone)) newTasksCount++;
    if (t.status === "done") {
      if (inWeek(t.updatedAt, nowIso, timezone)) {
        doneInWeek++;
        const day = localDateIso(t.updatedAt, timezone);
        if (doneByLocalDay.has(day)) doneByLocalDay.set(day, doneByLocalDay.get(day)! + 1);
      }
    } else if (t.status !== "canceled" && t.status !== "archived" && t.dueDate && dateSet.has(t.dueDate)) {
      unmetInWeek++;
    }
  }
  const newNotesCount = (db.select().from(notes).all() as (typeof notes.$inferSelect)[])
    .filter((n) => inWeek(n.createdAt, nowIso, timezone)).length;
  const weekDenominator = doneInWeek + unmetInWeek;

  return {
    completions: buckets.map((d) => ({ date: d, count: counts.get(d)! })),
    costs: buckets.map((d) => ({ date: d, cost: costs.get(d)! })),
    templates,
    week: {
      completionRate: weekDenominator === 0 ? null : doneInWeek / weekDenominator,
      dailyDone: dates.map((d) => ({ date: d, count: doneByLocalDay.get(d)! })),
      newTasks: newTasksCount,
      newNotes: newNotesCount,
    },
  };
}
