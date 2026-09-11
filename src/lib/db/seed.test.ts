import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-util";
import { seedIfEmpty } from "./seed";
import { tasks, projects, flowTemplates, executors, recurringRules, settings, chats } from "./schema";

describe("seedIfEmpty", () => {
  it("首播:4 模板/5 执行器/2 项目/2 规则/5 示例任务/示例会话/设置;幂等:再跑不增", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    seedIfEmpty(db);
    expect((db.select().from(flowTemplates).all() as unknown[]).length).toBe(4);
    expect((db.select().from(executors).all() as unknown[]).length).toBe(5);
    expect((db.select().from(projects).all() as unknown[]).length).toBe(2);
    expect((db.select().from(recurringRules).all() as unknown[]).length).toBe(2);
    expect((db.select().from(tasks).all() as unknown[]).length).toBe(5);
    expect((db.select().from(settings).all() as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
  it("种子执行器含人工与三个未启用的模型占位(快速/强/审查)", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const ex = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    expect(ex.filter((e) => e.type === "manual").length).toBe(1);
    expect(ex.filter((e) => e.type === "llm" && !e.enabled).length).toBe(3); // 快速模型 + 强模型 + 审查占位模型(补齐块新增)
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
  it("幂等补齐:reviewer 占位执行器与示例会话(旧库升级路径)", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    seedIfEmpty(db);
    const ex = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    expect(ex.filter((e) => e.name === "审查占位模型").length).toBe(1);
    expect(ex.filter((e) => e.role === "reviewer").length).toBe(1);
    expect((db.select().from(chats).all() as unknown[]).length).toBe(1);
  });
  it("旧库升级:已有数据时仍补齐 reviewer 占位与会话", () => {
    const db = createTestDb();
    db.insert(tasks).values({ id: crypto.randomUUID(), title: "旧任务", status: "inbox", tags: "[]", complexity: "S", priority: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run();
    seedIfEmpty(db);
    const ex = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    expect(ex.some((e) => e.name === "审查占位模型")).toBe(true);
    expect((db.select().from(chats).all() as unknown[]).length).toBe(1);
  });
});
