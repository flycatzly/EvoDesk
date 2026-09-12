import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-util";
import { seedIfEmpty } from "./seed";
import { tasks, projects, flowTemplates, executors, recurringRules, settings, chats, quickActions, canvases as canvasesTable, links as linksTable, goals as goalsTable } from "./schema";
import { eq } from "drizzle-orm";

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
  it("幂等补齐:快捷指令种子(url + command),double-seed 后恰 2 条", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    seedIfEmpty(db);
    const qa = db.select().from(quickActions).all() as (typeof quickActions.$inferSelect)[];
    expect(qa.length).toBe(2);
    expect(qa.filter((a) => a.type === "url" && a.payload === "https://chat.z.ai").length).toBe(1);
    expect(qa.filter((a) => a.type === "command" && a.payload === "Get-ChildItem ." && a.shell === "powershell").length).toBe(1);
  });
});

describe("部分库收敛(按表按名单补种)", () => {
  it("仅有用户任务时:补齐模板/项目/规则/执行器/设置,保留用户任务且不混入示例", () => {
    const db = createTestDb();
    db.insert(tasks).values({
      id: crypto.randomUUID(), title: "用户自己的任务", status: "ready", tags: "[]",
      complexity: "S", priority: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    }).run();
    seedIfEmpty(db);
    expect((db.select().from(flowTemplates).all() as unknown[]).length).toBe(4);
    expect((db.select().from(projects).all() as unknown[]).length).toBe(2);
    expect((db.select().from(recurringRules).all() as unknown[]).length).toBe(2);
    const ex = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    expect(ex.length).toBe(5); // 4 名单执行器 + 审查占位模型
    const userTasks = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).filter((t) => t.title === "用户自己的任务");
    expect(userTasks.length).toBe(1);
    expect((db.select().from(tasks).all() as unknown[]).length).toBe(1); // 不混入示例任务
  });
  it("名单部分缺失时只补缺失项(如模板缺 2 补 2)", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const keep = ["S 轻量通道", "M 标准流程"];
    for (const t of db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]) {
      if (!keep.includes(t.name)) db.delete(flowTemplates).where(eq(flowTemplates.id, t.id)).run();
    }
    seedIfEmpty(db);
    expect((db.select().from(flowTemplates).all() as unknown[]).length).toBe(4);
  });
});

describe("存量快捷指令迁移", () => {
  it("旧版查看沙盒目录的 data/sandbox 相对路径自动修正为 .", () => {
    const db = createTestDb();
    seedIfEmpty(db); // 先拿到 quick_actions 行
    const stale = (db.select().from(quickActions).all() as (typeof quickActions.$inferSelect)[])
      .find((a) => a.name === "查看沙盒目录")!;
    db.update(quickActions).set({ payload: "Get-ChildItem data/sandbox" }).where(eq(quickActions.id, stale.id)).run();
    seedIfEmpty(db); // 再次触发迁移
    const fixed = (db.select().from(quickActions).all() as (typeof quickActions.$inferSelect)[])
      .find((a) => a.id === stale.id)!;
    expect(fixed.payload).toBe("Get-ChildItem .");
  });
});

describe("画布与链接/目标种子", () => {
  it("默认画布含至少 7 类组件;3 套模板画布;幂等", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    seedIfEmpty(db);
    const rows = db.select().from(canvasesTable).all() as (typeof canvasesTable.$inferSelect)[];
    const tpl = rows.filter((c) => c.isTemplate);
    const normal = rows.filter((c) => !c.isTemplate);
    expect(new Set(tpl.map((c) => c.name))).toEqual(new Set(["学生工作台", "职场开发者工作台", "生活个人工作台"]));
    expect(normal).toHaveLength(1);
    const layout = JSON.parse(normal[0].layout) as { widgets: { id: string; type: string }[] }[];
    const types = new Set(layout.flatMap((g) => g.widgets.map((w) => w.type)));
    expect(types.size).toBeGreaterThanOrEqual(7);
    // 组件 id 全局唯一
    const ids = layout.flatMap((g) => g.widgets.map((w) => w.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("部分初始化库:已有非模板画布则不重复播种默认画布,模板仍补齐", () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.insert(canvasesTable).values({ id: "c-user", name: "我的", columns: "3", locked: false, isTemplate: false, shareToken: null, layout: "[]", createdAt: now, updatedAt: now }).run();
    seedIfEmpty(db);
    const rows = db.select().from(canvasesTable).all() as (typeof canvasesTable.$inferSelect)[];
    expect(rows.filter((c) => !c.isTemplate)).toHaveLength(1); // 用户的画布保留,无新增
    expect(rows.filter((c) => c.isTemplate)).toHaveLength(3);
  });
  it("链接与目标示例:仅在空表时播种", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    expect((db.select().from(linksTable).all() as unknown[]).length).toBeGreaterThanOrEqual(3);
    const goals = db.select().from(goalsTable).all() as (typeof goalsTable.$inferSelect)[];
    expect(goals.length).toBeGreaterThanOrEqual(2);
    expect(goals.some((g) => g.category === "reading")).toBe(true);
    expect(goals.some((g) => g.category === "fitness")).toBe(true);
    seedIfEmpty(db);
    expect((db.select().from(linksTable).all() as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
});
