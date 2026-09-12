import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { tasks, notes, links, goals, settings as settingsTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { collectWidgetData } from "./canvas-data";

const now = () => new Date().toISOString();
const NOW = new Date("2026-09-12T08:00:00.000Z"); // 周六

function addTask(db: ReturnType<typeof createTestDb>, v: Partial<typeof tasks.$inferInsert>) {
  db.insert(tasks).values({ id: crypto.randomUUID(), title: v.title ?? "t", status: "ready", createdAt: now(), updatedAt: now(), ...v } as typeof tasks.$inferInsert).run();
}

describe("collectWidgetData", () => {
  it("空库(种子后)请求全部 9 类:各段为空态不抛错", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    // 种子任务 dueDate 依赖真实时钟,为使断言确定:整理笔记=今日(09-12),体检预约=昨日(09-11)
    const seeded = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
    for (const t of seeded) {
      if (t.title === "整理 Obsidian 笔记目录") db.update(tasks).set({ dueDate: "2026-09-12" }).where(eq(tasks.id, t.id)).run();
      if (t.title === "体检预约") db.update(tasks).set({ dueDate: "2026-09-11" }).where(eq(tasks.id, t.id)).run();
    }
    const bundle = collectWidgetData(db, ["counters", "todo", "calendar", "notes", "links", "goals", "vault", "radar", "quickactions"], "Asia/Shanghai", NOW);
    expect(bundle.counters).toBeDefined();
    // 种子数据:1 条今日任务(整理 Obsidian 笔记目录)+1 条昨日逾期(体检预约)
    expect(bundle.counters!.today).toBe(2);
    expect(bundle.counters!.overdue).toBe(1);
    expect(bundle.counters!.notes).toBe(0);
    expect(bundle.counters!.projects).toHaveLength(2);
    expect(bundle.todo!.tasks.map((t) => t.overdue)).toEqual([true, false]); // 逾期置顶
    expect(bundle.calendar!.today).toBe("2026-09-12");
    expect(bundle.links!.groups.length).toBeGreaterThanOrEqual(2);
    expect(bundle.goalsWidget!.goals).toHaveLength(2);
    expect(bundle.quickactions!.actions).toHaveLength(2);
    expect(bundle.radar!.items.some((i) => i.kind === "overdue")).toBe(true); // 有逾期 → 雷达告警
  });
  it("vault 路径无效 → 未配置态(计数 0,不抛错)", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    db.update(settingsTable).set({ value: '"Z:/definitely/not/exist"' }).where(eq(settingsTable.key, "vault_path")).run();
    const bundle = collectWidgetData(db, ["vault"], "", NOW);
    expect(bundle.vault!.configured).toBe(false);
    expect(bundle.vault!.noteCount).toBe(0);
  });
  it("只请求部分类型时,未请求的类型不出现", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const bundle = collectWidgetData(db, ["goals"], "", NOW);
    expect(Object.keys(bundle)).toEqual(["goalsWidget"]);
  });
  it("计数与分组正确:新增任务/笔记/链接后 counters 与 links.groups 反映", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    addTask(db, { title: "今日事项", status: "ready", dueDate: "2026-09-12" });
    db.insert(notes).values({ id: crypto.randomUUID(), title: "灵感 A", body: "", tags: "[]", source: "manual", createdAt: now(), updatedAt: now() }).run();
    db.insert(links).values({ id: crypto.randomUUID(), title: "例子", url: "https://example.com", category: "生活", sort: 0, createdAt: now() }).run();
    const bundle = collectWidgetData(db, ["counters", "links"], "", NOW);
    expect(bundle.counters!.notes).toBe(1);
    expect(bundle.counters!.today).toBe(3); // 种子 2 + 新增 1
    const life = bundle.links!.groups.find((g) => g.category === "生活");
    expect(life?.links).toHaveLength(1);
  });
  it("goals 段排除归档目标", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const n = now();
    db.insert(goals).values({ id: crypto.randomUUID(), title: "已归档", category: "custom", target: 5, current: 5, unit: "", deadline: null, color: null, archived: true, createdAt: n, updatedAt: n }).run();
    const bundle = collectWidgetData(db, ["goals"], "", NOW);
    expect(bundle.goalsWidget!.goals.every((g) => g.title !== "已归档")).toBe(true);
  });
});
