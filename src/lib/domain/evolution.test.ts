import { describe, it, expect, beforeEach } from "vitest";
import { collectHotspots, applyVariant, promoteTemplate, retireTemplate, canAnalyze, EvolutionError } from "./evolution";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { flowRuns, stepRuns, flowTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const now = () => new Date().toISOString();

let db: ReturnType<typeof createTestDb>;
let tpl: typeof flowTemplates.$inferSelect;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  tpl = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.name === "S 轻量通道")!;
});

function seedRun(opts: { step0Rejected?: boolean; satisfaction?: number; status?: string }) {
  const runId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.insert(flowRuns).values({ id: runId, taskId: crypto.randomUUID(), templateId: tpl.id, templateVersion: 1, status: opts.status ?? "done", startedAt: nowIso, finishedAt: nowIso, satisfaction: opts.satisfaction, totalCostUsd: 0.01, totalDurationMs: 1000 }).run();
  db.insert(stepRuns).values({ id: crypto.randomUUID(), runId, stepIndex: 0, stepName: "快速执行", executorType: "llm", status: "done", output: "x", rejected: opts.step0Rejected ? 1 : 0, attempt: 1 }).run();
  return runId;
}

describe("collectHotspots", () => {
  it("步骤级热点:打回/接管/成本聚合", () => {
    seedRun({ step0Rejected: true });
    seedRun({});
    const spots = collectHotspots(db, tpl.id);
    expect(spots[0]).toMatchObject({ stepIndex: 0, stepName: "快速执行", rejected: 1, runs: 2 });
  });
  it("无 run → 空数组", () => {
    expect(collectHotspots(db, tpl.id)).toEqual([]);
  });
});

describe("canAnalyze", () => {
  it("自上次分析后新完成 run ≥ 阈值(默认 5)", () => {
    expect(canAnalyze(db, tpl.id)).toBe(false);
    for (let i = 0; i < 5; i++) seedRun({});
    expect(canAnalyze(db, tpl.id)).toBe(true);
  });
});

describe("applyVariant", () => {
  it("remove_step/add_step/replace_executor_role/edit_prompt/reorder 合法 ops 应用", () => {
    const steps = [
      { name: "a", type: "llm", executorRole: "executor", prompt: "p1" },
      { name: "b", type: "manual", instruction: "do" },
    ];
    const out = applyVariant(steps as never, [
      { op: "edit_prompt", index: 0, prompt: "p2" },
      { op: "add_step", after_index: 1, step: { name: "c", type: "llm", executorRole: "reviewer", prompt: "p3" } },
      { op: "reorder", from: 2, to: 0 },
    ]);
    expect(out[0].name).toBe("c");
    expect(out[1].name).toBe("a");
    expect((out[1] as { prompt: string }).prompt).toBe("p2");
    expect(out).toHaveLength(3);
  });
  it("越界/非法 op 抛 EvolutionError,整单放弃", () => {
    expect(() => applyVariant([], [{ op: "remove_step", index: 5 } as never])).toThrow(EvolutionError);
    expect(() => applyVariant([{ name: "a", type: "llm" } as never], [{ op: "unknown_op" } as never])).toThrow(EvolutionError);
  });
});

describe("promoteTemplate/retireTemplate", () => {
  it("晋升:experimental→active,同 lineage+complexity 旧 active 自动 retired,写事件", () => {
    const v = crypto.randomUUID();
    db.insert(flowTemplates).values({ id: v, name: "S 变体", description: "", tags: "[]", complexity: "S", version: 2, lineageId: tpl.lineageId, parentId: tpl.id, origin: "evolution", status: "experimental", steps: tpl.steps, createdAt: now(), updatedAt: now() }).run();
    promoteTemplate(db, v);
    expect((db.select().from(flowTemplates).where(eq(flowTemplates.id, v)).all()[0] as typeof flowTemplates.$inferSelect).status).toBe("active");
    expect((db.select().from(flowTemplates).where(eq(flowTemplates.id, tpl.id)).all()[0] as typeof flowTemplates.$inferSelect).status).toBe("retired");
  });
  it("晋升非 experimental 抛错", () => {
    expect(() => promoteTemplate(db, tpl.id)).toThrow(EvolutionError);
  });
  it("退役:active→retired,写事件", () => {
    retireTemplate(db, tpl.id, "成功率过低");
    expect((db.select().from(flowTemplates).where(eq(flowTemplates.id, tpl.id)).all()[0] as typeof flowTemplates.$inferSelect).status).toBe("retired");
  });
});
