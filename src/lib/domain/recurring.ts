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
  // schema 无 CHECK 约束,越界 weekday(如 7)会使 while 永不终止;先归一化到 0-6
  // (API 入口在 recurring-rules/route.ts 已手写校验:weekly 必须带整数 weekday 0-6,负数靠这里的取模兜底)
  const target = (((weekday ?? 1) % 7) + 7) % 7;
  while (d.getUTCDay() !== target) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

// 周期投放:扫描启用规则,把到期的 next_run_at 补齐生成任务(带原到期日,上限 31 防爆炸),
// 推进 next_run_at。漏掉的实例按原日期落库,仪表盘自然显示为已延期(规格 §5.11)。
//
// 并发安全:本函数在每次页面 SSR/GET 都会执行,dev+prod 双进程同时触发时,
// "读 next_run_at → 插任务 → 推进"的 check-then-insert 会产生同日重复投放。
// 对策:预检(无到期不开事务)→ immediate 写锁事务内**重读** next_run_at 再插入;
// 后到进程排到锁后看到已推进的 next_run_at,自然跳过。
export function tickRecurring(db: Db, now: Date = new Date()): number {
  const rules = db.select().from(recurringRules).where(eq(recurringRules.enabled, true)).all() as (typeof recurringRules.$inferSelect)[];
  const dueIds = rules.filter((r) => new Date(r.nextRunAt) <= now).map((r) => r.id);
  if (dueIds.length === 0) return 0;
  let created = 0;
  // immediate 事务:锁在 BEGIN 即获取;回调内重读,发现已被他进程推进则跳过
  db.transaction((tx) => {
    for (const ruleId of dueIds) {
      const fresh = tx.select().from(recurringRules).where(eq(recurringRules.id, ruleId)).all()[0] as typeof recurringRules.$inferSelect | undefined;
      if (!fresh || new Date(fresh.nextRunAt) > now) continue;
      let guard = 0;
      let lastId: string | null = null;
      while (new Date(fresh.nextRunAt) <= now && guard < 31) {
        const due = fresh.nextRunAt.slice(0, 10);
        const id = crypto.randomUUID();
        tx.insert(tasks).values({
          id, title: fresh.title, description: fresh.description, tags: fresh.tags, complexity: fresh.complexity,
          priority: fresh.priority, projectId: fresh.projectId, recurringRuleId: fresh.id,
          status: "inbox", dueDate: due, createdAt: now.toISOString(), updatedAt: now.toISOString(),
        }).run();
        lastId = id;
        created++;
        fresh.nextRunAt = nextRunAfter(fresh.freq as Freq, fresh.weekday, new Date(fresh.nextRunAt));
        guard++;
      }
      tx.update(recurringRules).set({ nextRunAt: fresh.nextRunAt, lastTaskId: lastId }).where(eq(recurringRules.id, ruleId)).run();
    }
  }, { behavior: "immediate" });
  return created;
}
