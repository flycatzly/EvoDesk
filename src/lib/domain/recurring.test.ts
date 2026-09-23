import { describe, it, expect } from "vitest";
import { nextRunAfter, tickRecurring, type Freq } from "./recurring";
import { createTestDb } from "@/lib/db/test-util";
import { recurringRules, tasks } from "@/lib/db/schema";

const NOW = new Date("2026-09-06T08:00:00Z"); // 周日

function rule(o: Partial<typeof recurringRules.$inferInsert>) {
  return {
    id: crypto.randomUUID(), title: "英语学习", tags: "[]", complexity: "S", priority: 1,
    freq: "daily", enabled: true, nextRunAt: "2026-09-06T00:00:00Z", createdAt: "2026-09-01T00:00:00Z", ...o,
  } as typeof recurringRules.$inferInsert;
}

describe("nextRunAfter", () => {
  it("daily:次日", async () => {
    expect(nextRunAfter("daily", null, new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-07T00:00:00.000Z");
  });
  it("weekdays:周五 → 下周一", async () => {
    expect(nextRunAfter("weekdays", null, new Date("2026-09-04T00:00:00Z"))).toBe("2026-09-07T00:00:00.000Z");
  });
  it("weekly(weekday=3 周三):周日 → 周三", async () => {
    expect(nextRunAfter("weekly", 3, new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-09T00:00:00.000Z");
  });
  it("单调性:DST 跳变日(2026-03-08T00:00Z)三种 freq 仍严格晚于 from", async () => {
    const from = new Date("2026-03-08T00:00:00Z"); // America/New_York 春令时跳变日
    const cases: [Freq, number | null][] = [["daily", null], ["weekdays", null], ["weekly", 3]];
    for (const [freq, wd] of cases) {
      expect(new Date(nextRunAfter(freq, wd, from)).getTime()).toBeGreaterThan(from.getTime());
    }
  });
  it("weekly weekday 越界(7)按 %7 归一化为周日,不死循环", async () => {
    expect(nextRunAfter("weekly", 7, new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-13T00:00:00.000Z");
  });
  it("weekly 负 weekday(-4)按模 7 归一化为 3(周三),不死循环", async () => {
    // JS 的 % 保留符号:-4 % 7 === -4,直接比较 getUTCDay()(0-6)永不相等会死循环
    expect(nextRunAfter("weekly", -4, new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-09T00:00:00.000Z");
  });
});

describe("tickRecurring", () => {
  it("到期生成任务并推进 next_run_at", async () => {
    const db = createTestDb();
    db.insert(recurringRules).values(rule({})).run();
    const n = await tickRecurring(db, NOW);
    expect(n).toBe(1);
    const t = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
    expect(t[0].title).toBe("英语学习");
    expect(t[0].dueDate).toBe("2026-09-06");
    expect(t[0].recurringRuleId).toBeTruthy();
    const r = db.select().from(recurringRules).all() as (typeof recurringRules.$inferSelect)[];
    expect(r[0].nextRunAt).toBe("2026-09-07T00:00:00.000Z");
    expect(r[0].lastTaskId).toBe(t[0].id); // 最近一次生成实例的 id
  });
  it("错过多天补齐为多条实例(上限 31)", async () => {
    const db = createTestDb();
    db.insert(recurringRules).values(rule({ nextRunAt: "2026-08-01T00:00:00Z" })).run();
    const n = await tickRecurring(db, NOW);
    expect(n).toBe(31); // 触发上限保护
  });
  it("追赶分批推进:第二次 tick 继续生成并收敛到未来", async () => {
    const db = createTestDb();
    db.insert(recurringRules).values(rule({ nextRunAt: "2026-08-01T00:00:00Z" })).run();
    expect(await tickRecurring(db, NOW)).toBe(31); // 第一批触发上限
    const r1 = db.select().from(recurringRules).all() as (typeof recurringRules.$inferSelect)[];
    const afterFirst = r1[0].nextRunAt;
    const second = await tickRecurring(db, NOW);
    expect(second).toBeGreaterThan(0);
    const r2 = db.select().from(recurringRules).all() as (typeof recurringRules.$inferSelect)[];
    expect(new Date(r2[0].nextRunAt).getTime()).toBeGreaterThan(new Date(afterFirst).getTime());
    // 收敛:第二批(09-01..09-06 共 6 条)后 next_run_at 已在未来,第三次 tick 不再生成
    expect(r2[0].nextRunAt).toBe("2026-09-07T00:00:00.000Z");
    expect(await tickRecurring(db, NOW)).toBe(0);
    const t = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
    const latest = t.filter((x) => x.dueDate === "2026-09-06");
    expect(latest).toHaveLength(1);
    expect(r2[0].lastTaskId).toBe(latest[0].id); // 最后创建实例的 id
  });
  it("未启用或未到期不生成", async () => {
    const db = createTestDb();
    db.insert(recurringRules).values([rule({ enabled: false }), rule({ id: crypto.randomUUID(), title: "x", freq: "daily", enabled: true, nextRunAt: "2026-09-30T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" })]).run();
    expect(await tickRecurring(db, NOW)).toBe(0);
  });
});
