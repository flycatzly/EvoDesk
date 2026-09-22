import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { flowRuns, stepRuns, tasks, flowTemplates, executors } from "@/lib/db/schema";
import { canTransition, type TaskStatus } from "@/lib/domain/status";
import { getStepDefs, type StepDef } from "@/lib/domain/step-def";
import { executorLlmConfig, callLlmWithRetry } from "@/lib/llm/client";
import { resolveStepExecutor, renderPrompt, type ResolvedExecutor } from "@/lib/domain/executor-resolve";
import { refreshTemplateStats } from "@/lib/domain/template-stats";
import { recordIssue } from "@/lib/domain/issue-store";
import { dbDialect } from "@/lib/db/client";

export class RunError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const STEP_TERMINAL = ["done", "skipped"] as const;
export const WAITING_STEP = (s: { status: string; executorType: string }) =>
  s.status === "awaiting_confirmation" || s.status === "failed" ||
  (s.status === "pending" && (s.executorType === "manual" || s.executorType === "checkpoint"));

export async function getRun(db: Db, runId: string) {
  return (await db.select().from(flowRuns).where(eq(flowRuns.id, runId)))[0] as typeof flowRuns.$inferSelect | undefined ?? null;
}
export async function getStepDefsForRun(db: Db, runId: string): Promise<StepDef[]> {
  const run = await getRun(db, runId);
  if (!run) throw new RunError("run 不存在", 404);
  const tpl = (await db.select().from(flowTemplates).where(eq(flowTemplates.id, run.templateId)))[0] as typeof flowTemplates.$inferSelect | undefined;
  return getStepDefs(tpl?.steps ?? "[]");
}
export async function getSteps(db: Db, runId: string) {
  return await db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).orderBy(asc(stepRuns.stepIndex)) as unknown as (typeof stepRuns.$inferSelect)[];
}
export async function getCurrentStep(db: Db, runId: string) {
  const steps = await getSteps(db, runId);
  return steps.find((s) => !(STEP_TERMINAL as readonly string[]).includes(s.status)) ?? null;
}

export async function startRun(db: Db, taskId: string): Promise<{ runId: string }> {
  const task = (await db.select().from(tasks).where(eq(tasks.id, taskId)))[0] as typeof tasks.$inferSelect | undefined;
  if (!task) throw new RunError("任务不存在", 404);
  if (task.status !== "ready") throw new RunError(`任务状态为 ${task.status},仅就绪任务可开始执行`);
  // 防重入兜底:任务可能被手工挪回 ready 但旧 run 仍在进行,禁止二次开始(状态机外的漏洞)
  const activeRuns = await db.select().from(flowRuns).where(and(eq(flowRuns.taskId, taskId), inArray(flowRuns.status, ["running", "waiting_human"])));
  if (activeRuns.length > 0) throw new RunError("该任务已有进行中的执行");
  if (!task.flowTemplateId) throw new RunError("任务未绑定流程模板,请先在收件箱完成分诊确认");
  const tpl = (await db.select().from(flowTemplates).where(eq(flowTemplates.id, task.flowTemplateId)))[0] as typeof flowTemplates.$inferSelect | undefined;
  if (!tpl || tpl.status !== "active") throw new RunError("绑定的流程模板不存在或未激活");
  const steps = getStepDefs(tpl.steps);
  const nowIso = new Date().toISOString();
  const runId = crypto.randomUUID();
  const stepRows = steps.map((s, i) => ({
    id: crypto.randomUUID(), runId, stepIndex: i, stepName: s.name,
    executorType: s.type, status: "pending" as const, attempt: 1, rejected: 0,
  }));
  if (dbDialect() === "mysql") {
    // mysql 侧事务回调必须是 async(语句等待 execute);sqlite 侧保持同步回调(better-sqlite3 事务不能返回 promise)
    const mydb = db as unknown as { transaction: (cb: (tx: Pick<Db, "insert" | "update">) => Promise<void>) => Promise<unknown> };
    await mydb.transaction(async (tx) => {
      await tx.insert(flowRuns).values({ id: runId, taskId, templateId: tpl.id, templateVersion: tpl.version, status: "running", startedAt: nowIso });
      await tx.insert(stepRuns).values(stepRows);
      await tx.update(tasks).set({ status: "running", updatedAt: nowIso }).where(eq(tasks.id, taskId));
    });
  } else {
    db.transaction((tx) => {
      tx.insert(flowRuns).values({ id: runId, taskId, templateId: tpl.id, templateVersion: tpl.version, status: "running", startedAt: nowIso }).run();
      for (const row of stepRows) tx.insert(stepRuns).values(row).run();
      tx.update(tasks).set({ status: "running", updatedAt: nowIso }).where(eq(tasks.id, taskId)).run();
    });
  }
  return { runId };
}

export async function syncRunStatus(db: Db, runId: string): Promise<void> {
  const run = await getRun(db, runId);
  if (!run || ["done", "failed", "canceled"].includes(run.status)) return;
  const nowIso = new Date().toISOString();
  // 进程中断自愈(llm):须严格大于 streamLlm 的 120s abort(stream 路由依赖 abort 先于 sweep,勿单独调大其一)
  const staleCutoff = new Date(Date.now() - 150_000).toISOString();
  await db.update(stepRuns).set({ status: "failed", error: "执行进程中断,可重试或人工接管", finishedAt: nowIso })
    .where(and(eq(stepRuns.runId, runId), eq(stepRuns.status, "running"), eq(stepRuns.executorType, "llm"), lt(stepRuns.startedAt, staleCutoff)));
  // 进程中断自愈(script):advance 的阻塞式 POST 崩溃/重启后 running 无恢复路径,按各步骤执行器超时 + 30s 宽限判定
  const runningScripts = await db.select().from(stepRuns).where(and(eq(stepRuns.runId, runId), eq(stepRuns.status, "running"), eq(stepRuns.executorType, "script"))) as (typeof stepRuns.$inferSelect)[];
  if (runningScripts.length > 0) {
    const defs = await getStepDefsForRun(db, runId);
    for (const s of runningScripts) {
      const executorId = defs[s.stepIndex]?.executor_id;
      const ex = executorId ? (await db.select().from(executors).where(eq(executors.id, executorId)))[0] as typeof executors.$inferSelect | undefined : undefined;
      const cutoff = new Date(Date.now() - ((ex?.timeoutMs ?? 120_000) + 30_000)).toISOString();
      if (s.startedAt && s.startedAt < cutoff) {
        await db.update(stepRuns).set({ status: "failed", error: "执行进程中断,可重试或人工接管", finishedAt: nowIso }).where(eq(stepRuns.id, s.id));
      }
    }
  }
  const cur = await getCurrentStep(db, runId);
  if (!cur) {
    const steps = await getSteps(db, runId);
    const totalCost = steps.reduce((a, s) => a + s.costUsd, 0);
    // 墙钟周期(含人工等待)——进化对比关注端到端时长,勿改为 sum(step.durationMs)
    const totalDuration = Date.now() - new Date(run.startedAt).getTime();
    await db.update(flowRuns).set({ status: "done", finishedAt: nowIso, totalCostUsd: totalCost, totalDurationMs: totalDuration }).where(eq(flowRuns.id, runId));
    const task = (await db.select().from(tasks).where(eq(tasks.id, run.taskId)))[0] as typeof tasks.$inferSelect | undefined;
    if (task && canTransition(task.status as TaskStatus, "review")) {
      await db.update(tasks).set({ status: "review", updatedAt: nowIso }).where(eq(tasks.id, task.id));
    }
    await refreshTemplateStats(db, run.templateId);
    return;
  }
  const runStatus = WAITING_STEP(cur) ? "waiting_human" : "running";
  if (run.status !== runStatus) await db.update(flowRuns).set({ status: runStatus }).where(eq(flowRuns.id, runId));
  const task = (await db.select().from(tasks).where(eq(tasks.id, run.taskId)))[0] as typeof tasks.$inferSelect | undefined;
  if (task && task.status !== runStatus && canTransition(task.status as TaskStatus, runStatus as TaskStatus)) {
    await db.update(tasks).set({ status: runStatus, updatedAt: nowIso }).where(eq(tasks.id, task.id));
  }
}

async function setStep(db: Db, stepId: string, patch: Partial<typeof stepRuns.$inferInsert>) {
  await db.update(stepRuns).set(patch).where(eq(stepRuns.id, stepId));
  return (await db.select().from(stepRuns).where(eq(stepRuns.id, stepId)))[0] as typeof stepRuns.$inferSelect;
}
function stepCost(ex: ResolvedExecutor, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1000) * ex.costPer1kInput + (tokensOut / 1000) * ex.costPer1kOutput;
}
async function prevOutput(db: Db, runId: string, stepIndex: number): Promise<string> {
  const prev = (await getSteps(db, runId)).filter((s) => s.stepIndex < stepIndex).at(-1);
  return prev?.output ?? "";
}
async function requireCurrent(db: Db, runId: string, stepIndex: number) {
  const cur = await getCurrentStep(db, runId);
  if (!cur || cur.stepIndex !== stepIndex) throw new RunError("该步骤不是当前步骤", 409);
  return cur;
}

// 测试与潜在非流式路径复用;生产 llm 步骤走 stream 路由(2026-09 M5 审查记录)
export async function runLlmStep(db: Db, runId: string, stepIndex: number, fetchImpl?: typeof fetch) {
  const cur = await requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "llm" || cur.status !== "pending") throw new RunError("当前步骤不可执行 LLM");
  const run = (await getRun(db, runId))!;
  if (run.status !== "running") throw new RunError("run 已结束或已取消", 409);
  const def = (await getStepDefsForRun(db, runId))[stepIndex];
  if (!def) throw new RunError("步骤定义不存在(模板可能已变更)", 409);
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0] as typeof tasks.$inferSelect | undefined;
  if (!task) throw new RunError("任务不存在(可能已被删除)", 409);
  const ex = resolveStepExecutor(db, def.executorRole ?? "executor");
  const nowIso = new Date().toISOString();
  if (!ex) {
    const msg = `无可用的 ${def.executorRole ?? "executor"} 执行器,可在执行器页启用或改用人工填写`;
    const s = setStep(db, cur.id, { status: "failed", error: msg, startedAt: nowIso, finishedAt: nowIso });
    await syncRunStatus(db, runId);
    try { recordIssue(db, { source: "step", sourceId: cur.id, sourceLabel: await stepLabel(db, runId, stepIndex), errorText: msg }); } catch { /* 自愈记录失败不掩盖原错误 */ }
    return s;
  }
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) {
    const msg = String(e);
    const s = setStep(db, cur.id, { status: "failed", error: msg, startedAt: nowIso, finishedAt: nowIso });
    await syncRunStatus(db, runId);
    try { recordIssue(db, { source: "step", sourceId: cur.id, sourceLabel: await stepLabel(db, runId, stepIndex), errorText: msg }); } catch { /* 自愈记录失败不掩盖原错误 */ }
    return s;
  }
  const prompt = renderPrompt(def.prompt ?? "", { task: { title: task.title, description: task.description }, prevOutput: await prevOutput(db, runId, stepIndex) });
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
    await syncRunStatus(db, runId);
    return s;
  } catch (e) {
    const msg = String(e).slice(0, 500);
    const s = setStep(db, cur.id, { status: "failed", error: msg, finishedAt: new Date().toISOString(), durationMs: Date.now() - started });
    await syncRunStatus(db, runId);
    try { recordIssue(db, { source: "step", sourceId: cur.id, sourceLabel: await stepLabel(db, runId, stepIndex), errorText: msg }); } catch { /* 自愈记录失败不掩盖原错误 */ }
    return s;
  }
}

export async function retryStep(db: Db, runId: string, stepIndex: number) {
  const cur = await requireCurrent(db, runId, stepIndex);
  if (cur.status !== "failed" || !["llm", "script"].includes(cur.executorType)) throw new RunError("仅失败的 llm/script 步骤可重试");
  const s = setStep(db, cur.id, { status: "pending", attempt: cur.attempt + 1, error: null });
  await syncRunStatus(db, runId);
  return s;
}
export async function manualOverrideStep(db: Db, runId: string, stepIndex: number, output: string) {
  const cur = await requireCurrent(db, runId, stepIndex);
  if (cur.status !== "failed" && !(cur.executorType === "llm" && cur.status === "pending")) throw new RunError("该步骤不可人工接管");
  const s = await setStep(db, cur.id, { status: "done", output, feedbackNote: "manual_override", finishedAt: new Date().toISOString() });
  await syncRunStatus(db, runId);
  return s;
}
export async function skipStep(db: Db, runId: string, stepIndex: number) {
  // getStepDefsForRun 对不存在的 run 抛 404,无需单独 getRun 校验
  const def = (await getStepDefsForRun(db, runId))[stepIndex];
  if (!def) throw new RunError("步骤定义不存在(模板可能已变更)", 409);
  const cur = await requireCurrent(db, runId, stepIndex);
  if (!def.optional || cur.status !== "pending") throw new RunError("仅当前 pending 的 optional 步骤可跳过");
  const s = await setStep(db, cur.id, { status: "skipped", finishedAt: new Date().toISOString() });
  await syncRunStatus(db, runId);
  return s;
}
export async function markStepFailed(db: Db, runId: string, stepIndex: number, error: string) {
  const cur = await requireCurrent(db, runId, stepIndex);
  const s = await setStep(db, cur.id, { status: "failed", error: error.slice(0, 500), finishedAt: new Date().toISOString() });
  await syncRunStatus(db, runId);
  // 自愈:失败自动入账(启发式诊断,见 issue-store)
  try {
    recordIssue(db, { source: "step", sourceId: cur.id, sourceLabel: await await stepLabel(db, runId, stepIndex), errorText: error });
  } catch { /* 记录失败不掩盖原错误 */ }
  return s;
}

async function stepLabel(db: Db, runId: string, stepIndex: number): Promise<string> {
  const run = await getRun(db, runId);
  const task = run ? ((await db.select().from(tasks).where(eq(tasks.id, run.taskId)))[0] as typeof tasks.$inferSelect | undefined) : undefined;
  const tpl = run ? ((await db.select().from(flowTemplates).where(eq(flowTemplates.id, run.templateId)))[0] as typeof flowTemplates.$inferSelect | undefined) : undefined;
  const step = (await getSteps(db, runId))[stepIndex];
  return `${task?.title ?? "任务"} · ${step?.stepName ?? stepIndex}(${tpl?.name ?? "模板"})`;
}

/** 步骤终态统一落库:覆写产出/成本/错误并 syncRunStatus。自守:run 已取消时不落库不 sync,直接返回当前步骤(取消后步骤已被置 skipped,不得覆写)。 */
export async function persistStepTerminal(db: Db, runId: string, stepIndex: number, patch: Partial<typeof stepRuns.$inferInsert>) {
  const run = await getRun(db, runId);
  if (run?.status === "canceled") return (await getSteps(db, runId))[stepIndex]; // 已取消:步骤已被置 skipped,不得覆写
  await db.update(stepRuns).set(patch).where(and(eq(stepRuns.runId, runId), eq(stepRuns.stepIndex, stepIndex)));
  await syncRunStatus(db, runId);
  return (await getSteps(db, runId))[stepIndex];
}

export async function approveCheckpoint(db: Db, runId: string, stepIndex: number) {
  const cur = await requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "checkpoint" || cur.status !== "pending") throw new RunError("当前步骤不是待审核 checkpoint");
  setStep(db, cur.id, { status: "done", finishedAt: new Date().toISOString() });
  await syncRunStatus(db, runId);
}
export async function rejectCheckpoint(db: Db, runId: string, stepIndex: number, note: string, targetIndex?: number) {
  const cur = await requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "checkpoint" || cur.status !== "pending") throw new RunError("当前步骤不是待审核 checkpoint");
  // 先验后写:目标校验全部通过后才落库,失败路径不得污染 rejected 计数(§9 打回率)
  const steps = await getSteps(db, runId);
  const isReworkType = (s: { executorType: string }) => ["llm", "manual", "script"].includes(s.executorType);
  const target = targetIndex != null
    ? steps.find((s) => s.stepIndex === targetIndex && isReworkType(s))
    : [...steps].reverse().find((s) => s.stepIndex < stepIndex && isReworkType(s));
  if (!target) throw new RunError("没有可打回的目标步骤");
  if (!(STEP_TERMINAL as readonly string[]).includes(target.status)) throw new RunError("目标步骤未完成,不可打回");
  await setStep(db, cur.id, { rejected: cur.rejected + 1, feedbackNote: note.slice(0, 500) });
  await setStep(db, target.id, { status: "pending" });
  await syncRunStatus(db, runId);
}
