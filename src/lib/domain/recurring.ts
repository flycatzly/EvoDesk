import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { recurringRules, tasks } from "@/lib/db/schema";

export type Freq = "daily" | "weekdays" | "weekly";

// 统一 UTC-ISO 约定(见 schema.ts 头注):全程 UTC 运算 —— UTC 日历 +1 天后截到 UTC 零点。
// 禁止混用本地时区方法(setDate/getDate):DST 跳变日会把结果拨回 from 本身,导致 tick 死循环补齐。
export function nextRunAfter(freq: Freq, weekday: number | null, from: Date): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  if (freq === "daily") return d.toISOString();
  if (freq === "weekdays") {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }
  // schema 无 CHECK 约束,越界 weekday(如 7)会使 while 永不终止;先归一化到 0-6(Task 13 zod 会在入口再校验)
  const target = (weekday ?? 1) % 7;
  while (d.getUTCDay() !== target) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// 周期投放:扫描启用规则,把到期的 next_run_at 补齐生成任务(带原到期日,上限 31 防爆炸),
// 推进 next_run_at。漏掉的实例按原日期落库,仪表盘自然显示为已延期(规格 §5.11)。
export function tickRecurring(db: Db, now: Date = new Date()): number {
  const rules = db.select().from(recurringRules).where(eq(recurringRules.enabled, true)).all() as (typeof recurringRules.$inferSelect)[];
  let created = 0;
  for (const r of rules) {
    let guard = 0;
    let lastId: string | null = null;
    while (new Date(r.nextRunAt) <= now && guard < 31) {
      const due = r.nextRunAt.slice(0, 10);
      const id = crypto.randomUUID();
      db.insert(tasks).values({
        id, title: r.title, description: r.description, tags: r.tags, complexity: r.complexity,
        priority: r.priority, projectId: r.projectId, recurringRuleId: r.id,
        status: "inbox", dueDate: due, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      }).run();
      lastId = id;
      created++;
      r.nextRunAt = nextRunAfter(r.freq as Freq, r.weekday, new Date(r.nextRunAt));
      guard++;
    }
    if (guard > 0) db.update(recurringRules).set({ nextRunAt: r.nextRunAt, lastTaskId: lastId }).where(eq(recurringRules.id, r.id)).run();
  }
  return created;
}
