import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { startRun, getCurrentStep, syncRunStatus, RunError, runLlmStep, retryStep, manualOverrideStep, skipStep, approveCheckpoint, rejectCheckpoint } from "./runner";
import { tasks, flowRuns, stepRuns, flowTemplates, executors } from "@/lib/db/schema";
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

describe("syncRunStatus 契约", () => {
  it("不存在的 runId → 不抛出(GET 路由依赖此行为)", () => {
    expect(() => syncRunStatus(db, "no-such-run")).not.toThrow();
  });
  it("终态 run → no-op(轮询依赖)", () => {
    const { runId } = startRun(db, readyTaskId);
    db.update(flowRuns).set({ status: "canceled" }).where(eq(flowRuns.id, runId)).run();
    const before = db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0];
    syncRunStatus(db, runId);
    expect(db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).toEqual(before);
  });
});

describe("runLlmStep", () => {
  it("成功:渲染提示词、持久化产出与成本,状态 done", async () => {
    db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "产出OK" } }], usage: { prompt_tokens: 10, completion_tokens: 4 }, model: "m" }), { status: 200 }));
    const step = await runLlmStep(db, runId, 0, f as typeof fetch); // S 通道第 0 步 executorRole=executor
    expect(step.status).toBe("done");
    expect(step.output).toBe("产出OK");
    expect(step.tokensIn).toBe(10);
  });
  it("无可用执行器 → 步骤 failed 且错误可读", async () => {
    const { runId } = startRun(db, readyTaskId); // 种子执行器默认禁用
    const step = await runLlmStep(db, runId, 0, undefined as unknown as typeof fetch);
    expect(step.status).toBe("failed");
    expect(step.error).toContain("无可用");
  });
  it("LLM 失败 → 步骤 failed,run 转等待人工", async () => {
    db.update(executors).set({ enabled: true }).where(eq(executors.name, "快速模型")).run();
    db.update(executors).set({ role: "executor" }).where(eq(executors.name, "快速模型")).run();
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const step = await runLlmStep(db, runId, 0, f as typeof fetch);
    expect(step.status).toBe("failed");
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).status).toBe("waiting_human");
  });
  it("已取消的 run 不可执行 llm 步(守卫)", async () => {
    const { runId } = startRun(db, readyTaskId);
    db.update(flowRuns).set({ status: "canceled" }).where(eq(flowRuns.id, runId)).run();
    await expect(runLlmStep(db, runId, 0, undefined as unknown as typeof fetch)).rejects.toThrow(/已结束或已取消/);
  });
  it("模板步骤被裁剪后执行 → RunError 而非 TypeError", async () => {
    db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
    const { runId } = startRun(db, readyTaskId);
    const tpl = db.select().from(flowTemplates).all().find((t) => t.name === "S 轻量通道")!;
    db.update(flowTemplates).set({ steps: "[]" }).where(eq(flowTemplates.id, tpl.id)).run();
    await expect(runLlmStep(db, runId, 0, undefined as unknown as typeof fetch)).rejects.toThrow(/步骤定义不存在/);
  });
});

describe("兜底动作", () => {
  beforeEach(() => {
    db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
  });
  it("retry:attempt+1 回 pending", async () => {
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const failed = await runLlmStep(db, runId, 0, f as typeof fetch);
    const step = retryStep(db, runId, failed.stepIndex);
    expect(step.attempt).toBe(2);
    expect(step.status).toBe("pending");
  });
  it("manual_override:人工产出直接 done", async () => {
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const failed = await runLlmStep(db, runId, 0, f as typeof fetch);
    const step = manualOverrideStep(db, runId, failed.stepIndex, "人工产出");
    expect(step.status).toBe("done");
    expect(step.output).toBe("人工产出");
    expect(step.feedbackNote).toBe("manual_override");
  });
  it("skip:仅 optional 步骤可跳过", async () => {
    const { runId } = startRun(db, readyTaskId); // S 通道第 0 步非 optional
    expect(() => skipStep(db, runId, 0)).toThrow(/optional/);
  });
});

describe("checkpoint", () => {
  beforeEach(() => {
    db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
  });
  it("approve:通过后到末尾 → run done/task review(需先把 llm 步跑完)", async () => {
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {}, model: "m" }), { status: 200 }));
    await runLlmStep(db, runId, 0, f as typeof fetch);
    const cur = getCurrentStep(db, runId)!; // checkpoint(第 1 步)
    expect(cur.executorType).toBe("checkpoint");
    approveCheckpoint(db, runId, cur.stepIndex);
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).status).toBe("done");
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0]).status).toBe("review");
  });
  it("reject:checkpoint 标记 rejected,目标步骤回 pending", async () => {
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {}, model: "m" }), { status: 200 }));
    await runLlmStep(db, runId, 0, f as typeof fetch);
    const cur = getCurrentStep(db, runId)!;
    rejectCheckpoint(db, runId, cur.stepIndex, "质量不行");
    const cp = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all().find((s) => s.stepIndex === cur.stepIndex)!;
    expect(cp.rejected).toBe(1);
    expect(cp.feedbackNote).toBe("质量不行");
    const target = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all().find((s) => s.stepIndex === 0)!;
    expect(target.status).toBe("pending");
  });
});
