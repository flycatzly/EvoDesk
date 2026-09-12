import { getDb } from "@/lib/db/client";
import { tasks, settings } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";
import { tzToday } from "@/lib/domain/tz";
import { CalendarView } from "@/components/CalendarView";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { m } = await searchParams;
  const db = getDb();
  tickRecurring(db); // 到期补投,保证循环任务的未来 dueDate 上墙(同仪表盘/GET /api/tasks 口径)
  // 读 settings KV(模式同仪表盘):timezone 决定"今天"边界与非法 m 回退时的"当月"
  const settingRows = db.select().from(settings).all() as { key: string; value: string }[];
  const kv: Record<string, unknown> = {};
  for (const r of settingRows) { try { kv[r.key] = JSON.parse(r.value); } catch { kv[r.key] = r.value; } }
  const todayStr = tzToday(typeof kv.timezone === "string" ? kv.timezone : "");
  // 非法 m(非 YYYY-MM 格式,或月份越界如 2026-13)回退当月
  const monthValid = typeof m === "string" && /^\d{4}-\d{2}$/.test(m) && Number(m.slice(5, 7)) >= 1 && Number(m.slice(5, 7)) <= 12;
  const month = monthValid ? m : todayStr.slice(0, 7);
  // 全量 dueDate 非空任务,取消除外;完成/归档仍上墙但条目淡显(计数点/状态徽章可辨)
  const dueTasks = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).filter(
    (t) => t.dueDate && t.status !== "canceled"
  );

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-4">日历</h1>
      <CalendarView tasks={dueTasks} month={month} todayStr={todayStr} />
    </div>
  );
}
