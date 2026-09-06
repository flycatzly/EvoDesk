import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { startRun, getCurrentStep, syncRunStatus, RunError } from "./runner";
import { tasks, flowRuns, stepRuns, flowTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let db: ReturnType<typeof createTestDb>;
let readyTaskId: string;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  readyTaskId = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "ready")!.id;
  // 种子的就绪任务未绑定模板(分诊确认才绑定);此处按测试前置直接绑定 S 轻量通道(2 步),不改动种子数据。
  const sTpl = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.name === "S 轻量通道")!;
  db.update(tasks).set({ flowTemplateId: sTpl.id }).where(eq(tasks.id, readyTaskId)).run();
});

describe("startRun", () => {
  it("就绪任务 → 创建 run+全部 pending 步骤,任务转 running", () => {
    const { runId } = startRun(db, readyTaskId);
    const run = db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0] as typeof flowRuns.$inferSelect;
    expect(run.status).toBe("running");
    expect(run.templateId).toBeTruthy();
    const steps = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all() as (typeof stepRuns.$inferSelect)[];
    expect(steps.length).toBe(2); // S 轻量通道 2 步
    expect(new Set(steps.map((s) => s.status))).toEqual(new Set(["pending"]));
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0] as typeof tasks.$inferSelect).status).toBe("running");
  });
  it("非就绪任务抛 RunError(409)", () => {
    const inbox = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "inbox")!;
    expect(() => startRun(db, inbox.id)).toThrow(RunError);
  });
  it("未绑定模板抛 RunError", () => {
    const t = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "inbox")!;
    db.update(tasks).set({ status: "ready", flowTemplateId: null }).where(eq(tasks.id, t.id)).run();
    expect(() => startRun(db, t.id)).toThrow(/未绑定流程模板/);
  });
});

describe("getCurrentStep/syncRunStatus", () => {
  it("当前步 = 第一个非 done/skipped 步骤", () => {
    const { runId } = startRun(db, readyTaskId);
    expect(getCurrentStep(db, runId)?.stepIndex).toBe(0);
    const steps = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all() as (typeof stepRuns.$inferSelect)[];
    const s0 = steps.find((s) => s.stepIndex === 0)!;
    db.update(stepRuns).set({ status: "done" }).where(eq(stepRuns.id, s0.id)).run();
    expect(getCurrentStep(db, runId)?.stepIndex).toBe(1);
  });
  it("全 done → run done + 任务 review + 模板统计刷新", () => {
    const { runId } = startRun(db, readyTaskId);
    const tplId = (db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0] as typeof flowRuns.$inferSelect).templateId;
    const steps = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all() as (typeof stepRuns.$inferSelect)[];
    steps.forEach((s) => db.update(stepRuns).set({ status: "done", finishedAt: new Date().toISOString() }).where(eq(stepRuns.id, s.id)).run());
    syncRunStatus(db, runId);
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0] as typeof flowRuns.$inferSelect).status).toBe("done");
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0] as typeof tasks.$inferSelect).status).toBe("review");
    const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, tplId)).all()[0] as typeof flowTemplates.$inferSelect;
    expect(tpl.statRuns).toBe(1);
    expect(tpl.statSuccessRate).toBe(1);
  });
  it("当前步为 manual → run/task waiting_human", () => {
    const { runId } = startRun(db, readyTaskId);
    const steps = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all() as (typeof stepRuns.$inferSelect)[];
    const s0 = steps.find((s) => s.stepIndex === 0)!;
    db.update(stepRuns).set({ status: "done" }).where(eq(stepRuns.id, s0.id)).run();
    // S 通道第 2 步是 checkpoint → waiting_human
    syncRunStatus(db, runId);
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0] as typeof flowRuns.$inferSelect).status).toBe("waiting_human");
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0] as typeof tasks.$inferSelect).status).toBe("waiting_human");
  });
});
