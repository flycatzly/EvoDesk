import { describe, it, expect } from "vitest";
import { buildStats } from "./stats";
import { createTestDb } from "@/lib/db/test-util";
import { tasks, flowRuns, flowTemplates } from "@/lib/db/schema";

// 固定"现在",让 14 天窗口与空日补零可精确断言(NOW = 2026-09-12T08:00Z → 窗口起点 2026-08-29T08:00Z)
const NOW = new Date("2026-09-12T08:00:00.000Z");
/** NOW 往前 offset 天、UTC hour 点的 ISO 串(offset 0 = 今天) */
const daysAgo = (offset: number, hour = 10) => new Date(Date.UTC(2026, 8, 12 - offset, hour)).toISOString();

let db: ReturnType<typeof createTestDb>;

function addTask(status: string, updatedAt: string) {
  db.insert(tasks).values({ id: crypto.randomUUID(), title: "t", status, createdAt: updatedAt, updatedAt }).run();
}
function addRun(startedAt: string, cost: number) {
  db.insert(flowRuns).values({
    id: crypto.randomUUID(), taskId: crypto.randomUUID(), templateId: "no-such-template",
    templateVersion: 1, status: "done", startedAt, finishedAt: startedAt, totalCostUsd: cost,
  }).run();
}
function addTemplate(name: string, statRuns: number, successRate: number, avgCost: number, avgSat: number) {
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.insert(flowTemplates).values({
    id, name, lineageId: id, statRuns, statSuccessRate: successRate,
    statAvgCostUsd: avgCost, statAvgSatisfaction: avgSat, createdAt: nowIso, updatedAt: nowIso,
  }).run();
}

describe("buildStats.completions", () => {
  it("done 任务按 updatedAt UTC 日聚合;非 done 不计;窗口外裁剪", () => {
    db = createTestDb();
    addTask("done", daysAgo(0, 2)); // 今天 1 条
    addTask("done", daysAgo(3, 1)); // 3 天前 2 条
    addTask("done", daysAgo(3, 23));
    addTask("done", daysAgo(13, 23)); // 窗口内最早一天(2026-08-30)
    addTask("done", daysAgo(20)); // 20 天前 → 裁剪
    addTask("inbox", daysAgo(0)); // 非 done → 不计

    const { completions } = buildStats(db, NOW);
    expect(completions).toHaveLength(14);
    expect(completions[0].date).toBe("2026-08-30"); // 最旧 = 今天-13
    expect(completions[13].date).toBe("2026-09-12"); // 最新 = 今天
    expect(completions.find((d) => d.date === "2026-09-12")!.count).toBe(1);
    expect(completions.find((d) => d.date === "2026-09-09")!.count).toBe(2);
    expect(completions.find((d) => d.date === "2026-08-30")!.count).toBe(1);
    expect(completions.find((d) => d.date === "2026-08-20")).toBeUndefined(); // 窗口外不产生桶
  });
  it("空日补零;空库 → 14 个全零桶", () => {
    db = createTestDb();
    const { completions } = buildStats(db, NOW);
    expect(completions).toHaveLength(14);
    expect(completions.every((d) => d.count === 0)).toBe(true);
    expect(completions.map((d) => d.date)).toEqual(
      Array.from({ length: 14 }, (_, i) => new Date(Date.UTC(2026, 8, 12 - 13 + i)).toISOString().slice(0, 10)),
    );
  });
});

describe("buildStats.costs", () => {
  it("flow_runs totalCostUsd 按 startedAt UTC 日求和;窗口外裁剪;空日补零", () => {
    db = createTestDb();
    addRun(daysAgo(0, 1), 0.5);
    addRun(daysAgo(0, 5), 0.25); // 同日两条求和 0.75
    addRun(daysAgo(3), 0.1);
    addRun(daysAgo(20), 99); // 窗口外 → 裁剪

    const { costs } = buildStats(db, NOW);
    expect(costs).toHaveLength(14);
    expect(costs.find((d) => d.date === "2026-09-12")!.cost).toBe(0.75);
    expect(costs.find((d) => d.date === "2026-09-09")!.cost).toBeCloseTo(0.1);
    expect(costs.find((d) => d.date === "2026-09-11")!.cost).toBe(0); // 空日补零
    expect(costs.reduce((a, d) => a + d.cost, 0)).toBeCloseTo(0.85); // 窗口外 99 未计入
  });
});

describe("buildStats.templates", () => {
  it("statRuns>0 的模板映射四项指标;statRuns=0 排除", () => {
    db = createTestDb();
    addTemplate("A 模板", 4, 0.75, 0.02, 4.5);
    addTemplate("零运行模板", 0, 0, 0, 0);

    const { templates } = buildStats(db, NOW);
    expect(templates).toEqual([{ name: "A 模板", runs: 4, successRate: 0.75, avgCost: 0.02, avgSatisfaction: 4.5 }]);
  });
  it("空库 → 三段均为空/全零", () => {
    db = createTestDb();
    const stats = buildStats(db, NOW);
    expect(stats.templates).toEqual([]);
    expect(stats.completions.every((d) => d.count === 0)).toBe(true);
    expect(stats.costs.every((d) => d.cost === 0)).toBe(true);
  });
});
