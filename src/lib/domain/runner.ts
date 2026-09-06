import { eq, asc } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { flowRuns, stepRuns, tasks, flowTemplates } from "@/lib/db/schema";
import { canTransition, type TaskStatus } from "@/lib/domain/status";
import { getStepDefs, type StepDef } from "@/lib/domain/step-def";
import { refreshTemplateStats } from "@/lib/domain/template-stats";

export class RunError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const STEP_TERMINAL = ["done", "skipped"] as const;
export const WAITING_STEP = (s: { status: string; executorType: string }) =>
  s.status === "awaiting_confirmation" || s.status === "failed" ||
  (s.status === "pending" && (s.executorType === "manual" || s.executorType === "checkpoint"));

export function getRun(db: Db, runId: string) {
  return db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0] as typeof flowRuns.$inferSelect | undefined ?? null;
}
export function getStepDefsForRun(db: Db, runId: string): StepDef[] {
  const run = getRun(db, runId);
  if (!run) throw new RunError("run 不存在", 404);
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, run.templateId)).all()[0] as typeof flowTemplates.$inferSelect | undefined;
  return getStepDefs(tpl?.steps ?? "[]");
}
export function getSteps(db: Db, runId: string) {
  return db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).orderBy(asc(stepRuns.stepIndex)).all() as unknown as (typeof stepRuns.$inferSelect)[];
}
export function getCurrentStep(db: Db, runId: string) {
  return getSteps(db, runId).find((s) => !(STEP_TERMINAL as readonly string[]).includes(s.status)) ?? null;
}

export function startRun(db: Db, taskId: string): { runId: string } {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0] as typeof tasks.$inferSelect | undefined;
  if (!task) throw new RunError("任务不存在", 404);
  if (task.status !== "ready") throw new RunError(`任务状态为 ${task.status},仅就绪任务可开始执行`);
  if (!task.flowTemplateId) throw new RunError("任务未绑定流程模板,请先在收件箱完成分诊确认");
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, task.flowTemplateId)).all()[0] as typeof flowTemplates.$inferSelect | undefined;
  if (!tpl || tpl.status !== "active") throw new RunError("绑定的流程模板不存在或未激活");
  const steps = getStepDefs(tpl.steps);
  const nowIso = new Date().toISOString();
  const runId = crypto.randomUUID();
  db.transaction((tx) => {
    tx.insert(flowRuns).values({ id: runId, taskId, templateId: tpl.id, templateVersion: tpl.version, status: "running", startedAt: nowIso }).run();
    steps.forEach((s, i) => {
      tx.insert(stepRuns).values({ id: crypto.randomUUID(), runId, stepIndex: i, stepName: s.name, executorType: s.type, status: "pending", attempt: 1, rejected: 0 }).run();
    });
    tx.update(tasks).set({ status: "running", updatedAt: nowIso }).where(eq(tasks.id, taskId)).run();
  });
  return { runId };
}

export function syncRunStatus(db: Db, runId: string): void {
  const run = getRun(db, runId);
  if (!run || ["done", "failed", "canceled"].includes(run.status)) return;
  const nowIso = new Date().toISOString();
  const cur = getCurrentStep(db, runId);
  if (!cur) {
    const steps = getSteps(db, runId);
    const totalCost = steps.reduce((a, s) => a + s.costUsd, 0);
    const totalDuration = Date.now() - new Date(run.startedAt).getTime();
    db.update(flowRuns).set({ status: "done", finishedAt: nowIso, totalCostUsd: totalCost, totalDurationMs: totalDuration }).where(eq(flowRuns.id, runId)).run();
    const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0] as typeof tasks.$inferSelect | undefined;
    if (task && canTransition(task.status as TaskStatus, "review")) {
      db.update(tasks).set({ status: "review", updatedAt: nowIso }).where(eq(tasks.id, task.id)).run();
    }
    refreshTemplateStats(db, run.templateId);
    return;
  }
  const runStatus = WAITING_STEP(cur) ? "waiting_human" : "running";
  if (run.status !== runStatus) db.update(flowRuns).set({ status: runStatus }).where(eq(flowRuns.id, runId)).run();
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0] as typeof tasks.$inferSelect | undefined;
  if (task && task.status !== runStatus && canTransition(task.status as TaskStatus, runStatus as TaskStatus)) {
    db.update(tasks).set({ status: runStatus, updatedAt: nowIso }).where(eq(tasks.id, task.id)).run();
  }
}
