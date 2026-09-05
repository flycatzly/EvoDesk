import { describe, it, expect } from "vitest";
import { nextRunAfter, tickRecurring } from "./recurring";
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
  it("daily:次日", () => {
    expect(nextRunAfter("daily", null, new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-07T00:00:00.000Z");
  });
  it("weekdays:周五 → 下周一", () => {
    expect(nextRunAfter("weekdays", null, new Date("2026-09-04T00:00:00Z"))).toBe("2026-09-07T00:00:00.000Z");
  });
  it("weekly(weekday=3 周三):周日 → 周三", () => {
    expect(nextRunAfter("weekly", 3, new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-09T00:00:00.000Z");
  });
});

describe("tickRecurring", () => {
  it("到期生成任务并推进 next_run_at", () => {
    const db = createTestDb();
    db.insert(recurringRules).values(rule({})).run();
    const n = tickRecurring(db, NOW);
    expect(n).toBe(1);
    const t = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
    expect(t[0].title).toBe("英语学习");
    expect(t[0].dueDate).toBe("2026-09-06");
    expect(t[0].recurringRuleId).toBeTruthy();
    const r = db.select().from(recurringRules).all() as (typeof recurringRules.$inferSelect)[];
    expect(r[0].nextRunAt).toBe("2026-09-07T00:00:00.000Z");
  });
  it("错过多天补齐为多条实例(上限 31)", () => {
    const db = createTestDb();
    db.insert(recurringRules).values(rule({ nextRunAt: "2026-08-01T00:00:00Z" })).run();
    const n = tickRecurring(db, NOW);
    expect(n).toBe(31); // 触发上限保护
  });
  it("未启用或未到期不生成", () => {
    const db = createTestDb();
    db.insert(recurringRules).values([rule({ enabled: false }), rule({ id: crypto.randomUUID(), title: "x", freq: "daily", enabled: true, nextRunAt: "2026-09-30T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" })]).run();
    expect(tickRecurring(db, NOW)).toBe(0);
  });
});
