import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { flowRuns, stepRuns, tasks, flowTemplates, executors } from "@/lib/db/schema";
import { canTransition, type TaskStatus } from "@/lib/domain/status";
import { getStepDefs, type StepDef } from "@/lib/domain/step-def";
import { executorLlmConfig, callLlmWithRetry } from "@/lib/llm/client";
import { resolveStepExecutor, renderPrompt, type ResolvedExecutor } from "@/lib/domain/executor-resolve";
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
  // 防重入兜底:任务可能被手工挪回 ready 但旧 run 仍在进行,禁止二次开始(状态机外的漏洞)
  const activeRuns = db.select().from(flowRuns).where(and(eq(flowRuns.taskId, taskId), inArray(flowRuns.status, ["running", "waiting_human"]))).all();
  if (activeRuns.length > 0) throw new RunError("该任务已有进行中的执行");
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
  // 进程中断自愈(llm):须严格大于 streamLlm 的 120s abort(stream 路由依赖 abort 先于 sweep,勿单独调大其一)
  const staleCutoff = new Date(Date.now() - 150_000).toISOString();
  db.update(stepRuns).set({ status: "failed", error: "执行进程中断,可重试或人工接管", finishedAt: nowIso })
    .where(and(eq(stepRuns.runId, runId), eq(stepRuns.status, "running"), eq(stepRuns.executorType, "llm"), lt(stepRuns.startedAt, staleCutoff))).run();
  // 进程中断自愈(script):advance 的阻塞式 POST 崩溃/重启后 running 无恢复路径,按各步骤执行器超时 + 30s 宽限判定
  const runningScripts = db.select().from(stepRuns).where(and(eq(stepRuns.runId, runId), eq(stepRuns.status, "running"), eq(stepRuns.executorType, "script"))).all() as (typeof stepRuns.$inferSelect)[];
  if (runningScripts.length > 0) {
    const defs = getStepDefsForRun(db, runId);
    for (const s of runningScripts) {
      const executorId = defs[s.stepIndex]?.executor_id;
      const ex = executorId ? db.select().from(executors).where(eq(executors.id, executorId)).all()[0] as typeof executors.$inferSelect | undefined : undefined;
      const cutoff = new Date(Date.now() - ((ex?.timeoutMs ?? 120_000) + 30_000)).toISOString();
      if (s.startedAt && s.startedAt < cutoff) {
        db.update(stepRuns).set({ status: "failed", error: "执行进程中断,可重试或人工接管", finishedAt: nowIso }).where(eq(stepRuns.id, s.id)).run();
      }
    }
  }
  const cur = getCurrentStep(db, runId);
  if (!cur) {
    const steps = getSteps(db, runId);
    const totalCost = steps.reduce((a, s) => a + s.costUsd, 0);
    // 墙钟周期(含人工等待)——进化对比关注端到端时长,勿改为 sum(step.durationMs)
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

function setStep(db: Db, stepId: string, patch: Partial<typeof stepRuns.$inferInsert>) {
  db.update(stepRuns).set(patch).where(eq(stepRuns.id, stepId)).run();
  return db.select().from(stepRuns).where(eq(stepRuns.id, stepId)).all()[0] as typeof stepRuns.$inferSelect;
}
function stepCost(ex: ResolvedExecutor, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1000) * ex.costPer1kInput + (tokensOut / 1000) * ex.costPer1kOutput;
}
function prevOutput(db: Db, runId: string, stepIndex: number): string {
  const prev = getSteps(db, runId).filter((s) => s.stepIndex < stepIndex).at(-1);
  return prev?.output ?? "";
}
function requireCurrent(db: Db, runId: string, stepIndex: number) {
  const cur = getCurrentStep(db, runId);
  if (!cur || cur.stepIndex !== stepIndex) throw new RunError("该步骤不是当前步骤", 409);
  return cur;
}

export async function runLlmStep(db: Db, runId: string, stepIndex: number, fetchImpl?: typeof fetch) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "llm" || cur.status !== "pending") throw new RunError("当前步骤不可执行 LLM");
  const run = getRun(db, runId)!;
  if (run.status !== "running") throw new RunError("run 已结束或已取消", 409);
  const def = getStepDefsForRun(db, runId)[stepIndex];
  if (!def) throw new RunError("步骤定义不存在(模板可能已变更)", 409);
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0] as typeof tasks.$inferSelect;
  const ex = resolveStepExecutor(db, def.executorRole ?? "executor");
  const nowIso = new Date().toISOString();
  if (!ex) {
    const s = setStep(db, cur.id, { status: "failed", error: `无可用的 ${def.executorRole ?? "executor"} 执行器,可在执行器页启用或改用人工填写`, startedAt: nowIso, finishedAt: nowIso });
    syncRunStatus(db, runId);
    return s;
  }
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) {
    const s = setStep(db, cur.id, { status: "failed", error: String(e), startedAt: nowIso, finishedAt: nowIso });
    syncRunStatus(db, runId);
    return s;
  }
  const prompt = renderPrompt(def.prompt ?? "", { task: { title: task.title, description: task.description }, prevOutput: prevOutput(db, runId, stepIndex) });
  setStep(db, cur.id, { status: "running", input: prompt, model: ex.model, startedAt: nowIso });
  const started = Date.now();
  try {
    const r = await callLlmWithRetry(cfg, [{ role: "user", content: prompt }], fetchImpl);
    const s = setStep(db, cur.id, {
      status: "done", output: r.text, model: r.model,
      tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      costUsd: stepCost(ex, r.tokensIn, r.tokensOut),
      durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
    });
    syncRunStatus(db, runId);
    return s;
  } catch (e) {
    const s = setStep(db, cur.id, { status: "failed", error: String(e).slice(0, 500), finishedAt: new Date().toISOString(), durationMs: Date.now() - started });
    syncRunStatus(db, runId);
    return s;
  }
}

export function retryStep(db: Db, runId: string, stepIndex: number) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.status !== "failed" || !["llm", "script"].includes(cur.executorType)) throw new RunError("仅失败的 llm/script 步骤可重试");
  const s = setStep(db, cur.id, { status: "pending", attempt: cur.attempt + 1, error: null });
  syncRunStatus(db, runId);
  return s;
}
export function manualOverrideStep(db: Db, runId: string, stepIndex: number, output: string) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.status !== "failed" && !(cur.executorType === "llm" && cur.status === "pending")) throw new RunError("该步骤不可人工接管");
  const s = setStep(db, cur.id, { status: "done", output, feedbackNote: "manual_override", finishedAt: new Date().toISOString() });
  syncRunStatus(db, runId);
  return s;
}
export function skipStep(db: Db, runId: string, stepIndex: number) {
  // getStepDefsForRun 对不存在的 run 抛 404,无需单独 getRun 校验
  const def = getStepDefsForRun(db, runId)[stepIndex];
  if (!def) throw new RunError("步骤定义不存在(模板可能已变更)", 409);
  const cur = requireCurrent(db, runId, stepIndex);
  if (!def.optional || cur.status !== "pending") throw new RunError("仅当前 pending 的 optional 步骤可跳过");
  const s = setStep(db, cur.id, { status: "skipped", finishedAt: new Date().toISOString() });
  syncRunStatus(db, runId);
  return s;
}
export function markStepFailed(db: Db, runId: string, stepIndex: number, error: string) {
  const cur = requireCurrent(db, runId, stepIndex);
  const s = setStep(db, cur.id, { status: "failed", error: error.slice(0, 500), finishedAt: new Date().toISOString() });
  syncRunStatus(db, runId);
  return s;
}

/** 步骤终态统一落库:覆写产出/成本/错误并 syncRunStatus。自守:run 已取消时不落库不 sync,直接返回当前步骤(取消后步骤已被置 skipped,不得覆写)。 */
export function persistStepTerminal(db: Db, runId: string, stepIndex: number, patch: Partial<typeof stepRuns.$inferInsert>) {
  const run = getRun(db, runId);
  if (run?.status === "canceled") return getSteps(db, runId)[stepIndex]; // 已取消:步骤已被置 skipped,不得覆写
  db.update(stepRuns).set(patch).where(and(eq(stepRuns.runId, runId), eq(stepRuns.stepIndex, stepIndex))).run();
  syncRunStatus(db, runId);
  return getSteps(db, runId)[stepIndex];
}

export function approveCheckpoint(db: Db, runId: string, stepIndex: number) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "checkpoint" || cur.status !== "pending") throw new RunError("当前步骤不是待审核 checkpoint");
  setStep(db, cur.id, { status: "done", finishedAt: new Date().toISOString() });
  syncRunStatus(db, runId);
}
export function rejectCheckpoint(db: Db, runId: string, stepIndex: number, note: string, targetIndex?: number) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "checkpoint" || cur.status !== "pending") throw new RunError("当前步骤不是待审核 checkpoint");
  // 先验后写:目标校验全部通过后才落库,失败路径不得污染 rejected 计数(§9 打回率)
  const steps = getSteps(db, runId);
  const isReworkType = (s: { executorType: string }) => ["llm", "manual", "script"].includes(s.executorType);
  const target = targetIndex != null
    ? steps.find((s) => s.stepIndex === targetIndex && isReworkType(s))
    : [...steps].reverse().find((s) => s.stepIndex < stepIndex && isReworkType(s));
  if (!target) throw new RunError("没有可打回的目标步骤");
  if (!(STEP_TERMINAL as readonly string[]).includes(target.status)) throw new RunError("目标步骤未完成,不可打回");
  setStep(db, cur.id, { rejected: cur.rejected + 1, feedbackNote: note.slice(0, 500) });
  setStep(db, target.id, { status: "pending" });
  syncRunStatus(db, runId);
}
