import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-util";
import { seedIfEmpty } from "./seed";
import { tasks, projects, flowTemplates, executors, recurringRules, settings } from "./schema";

describe("seedIfEmpty", () => {
  it("首播:4 模板/4 执行器/2 项目/2 规则/5 示例任务/设置;幂等:再跑不增", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    seedIfEmpty(db);
    expect((db.select().from(flowTemplates).all() as unknown[]).length).toBe(4);
    expect((db.select().from(executors).all() as unknown[]).length).toBe(4);
    expect((db.select().from(projects).all() as unknown[]).length).toBe(2);
    expect((db.select().from(recurringRules).all() as unknown[]).length).toBe(2);
    expect((db.select().from(tasks).all() as unknown[]).length).toBe(5);
    expect((db.select().from(settings).all() as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
  it("种子执行器含人工与两个未启用的模型占位", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const ex = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    expect(ex.filter((e) => e.type === "manual").length).toBe(1);
    expect(ex.filter((e) => e.type === "llm" && !e.enabled).length).toBe(2);
  });
  it("部分冲突收敛:settings 已有键时种子成功,保留已有值并补齐缺失键(回归:UNIQUE constraint failed: settings.key)", () => {
    const db = createTestDb();
    db.insert(settings).values({ key: "cost_budget_usd", value: "25" }).run();
    expect(() => seedIfEmpty(db)).not.toThrow();
    expect((db.select().from(tasks).all() as unknown[]).length).toBe(5);
    const kv: Record<string, string> = {};
    for (const r of db.select().from(settings).all() as { key: string; value: string }[]) kv[r.key] = r.value;
    expect(kv.cost_budget_usd).toBe("25"); // 用户已改的值保留,不被种子覆盖
    expect(kv.theme).toBe('"dark"'); // 缺失键照常补齐(原始 JSON 文本形式)
    expect(Object.keys(kv).length).toBe(5);
  });
});
