import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks as tasksTable, stepRuns as stepRunsTable } from "@/lib/db/schema";
import { getRun, getSteps, getStepDefsForRun, getCurrentStep, syncRunStatus, markStepFailed, persistStepTerminal } from "@/lib/domain/runner";
import { resolveStepExecutor, renderPrompt } from "@/lib/domain/executor-resolve";
import { executorLlmConfig } from "@/lib/llm/client";
import { streamLlm } from "@/lib/llm/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id: runId, n } = await params;
  const stepIndex = Number(n);
  const db = getDb();
  const run = await getRun(db, runId);
  const cur = await getCurrentStep(db, runId);
  // code 可选:机器可读错误码(如 step_running),供客户端双保险判断
  const fail = (message: string, status: number, code?: string) =>
    new Response(JSON.stringify(code ? { error: message, code } : { error: message }), { status, headers: { "content-type": "application/json" } });
  if (!run) return fail("run 不存在", 404);
  if (run.status !== "running") return fail("run 已结束或已取消", 409);
  if (!cur || cur.stepIndex !== stepIndex) return fail("该步骤不是当前步骤", 409);
  if (cur.executorType !== "llm") return fail("仅 llm 步骤支持流式执行", 409);
  if (cur.status === "running") return fail("该步骤正在执行", 409, "step_running");
  if (cur.status !== "pending") return fail(`步骤状态 ${cur.status} 不可执行`, 409);

  const step = (await getSteps(db, runId))[stepIndex];
  const def = (await getStepDefsForRun(db, runId))[stepIndex];
  if (!def) return fail("步骤定义不存在(模板可能已变更)", 409);
  const task = db.select().from(tasksTable).where(eq(tasksTable.id, run.taskId)).all()[0];
  if (!task) return fail("任务不存在", 404);
  const ex = resolveStepExecutor(db, def.executorRole ?? "executor");
  if (!ex) {
    await markStepFailed(db, runId, stepIndex, `无可用的 ${def.executorRole ?? "executor"} 执行器,可在执行器页启用或改用人工填写`);
    return fail(`无可用的 ${def.executorRole ?? "executor"} 执行器`, 409);
  }
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) {
    await markStepFailed(db, runId, stepIndex, String(e));
    return fail(String(e), 409);
  }
  const prev = (await getSteps(db, runId)).filter((s) => s.stepIndex < stepIndex).at(-1);
  const prompt = renderPrompt(def.prompt ?? "", { task: { title: task.title, description: task.description }, prevOutput: prev?.output ?? "" });
  // 单流保证:条件 UPDATE,抢不到 pending 即 409
  const claim = db.update(stepRunsTable).set({ status: "running", input: prompt, model: ex.model, startedAt: new Date().toISOString() })
    .where(and(eq(stepRunsTable.id, step.id), eq(stepRunsTable.status, "pending"))).run();
  if (claim.changes === 0) return fail("该步骤已被其他请求开始执行", 409);
  await syncRunStatus(db, runId);
  // streamLlm 120s abort 须严格小于 runner 清扫阈值 150s(sweep 依赖 abort 先触发),勿接入 executor.timeoutMs
  // 路由完整消费生成器(throw 亦终止),符合 streamLlm 消费契约

  const started = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 断连安全:客户端断开后 enqueue 会抛,置 closed 后静默丢弃后续事件
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { closed = true; }
      };
      const gen = streamLlm(cfg, [{ role: "user", content: prompt }]);
      let completed = false;
      try {
        for (;;) {
          const r = await gen.next();
          if (r.done) {
            const result = r.value;
            const fresh = (await getRun(db, runId))!;
            if (fresh.status === "canceled") {
              // 取消后步骤已被置 skipped,不得覆写;让 UI 刷新看到 canceled run
              send({ done: true, canceled: true });
            } else {
              const persisted = await persistStepTerminal(db, runId, stepIndex, {
                status: "done", output: result.text, model: result.model,
                tokensIn: result.tokensIn, tokensOut: result.tokensOut,
                costUsd: (result.tokensIn / 1000) * ex.costPer1kInput + (result.tokensOut / 1000) * ex.costPer1kOutput,
                durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
              });
              send({ done: true, step: persisted, run: await getRun(db, runId) });
            }
            break;
          }
          send({ delta: r.value });
        }
        completed = true;
      } catch (e) {
        if (closed) {
          // 客户端已断开:断开不是步骤失败,不落库不发事件,释放上游 reader 即可
          try { await gen.return(undefined as never); } catch { /* 已终止 */ }
          return;
        }
        const fresh = (await getRun(db, runId))!;
        if (fresh.status !== "canceled") {
          const persisted = await persistStepTerminal(db, runId, stepIndex, {
            status: "failed", error: String(e).slice(0, 500), durationMs: Date.now() - started, finishedAt: new Date().toISOString(),
          });
          send({ done: true, error: String(e).slice(0, 300), step: persisted });
        } else {
          send({ done: true, canceled: true });
        }
      } finally {
        // streamLlm 消费契约:未完整消费(断开/上游异常)须 gen.return() 释放底层 reader
        if (!completed) { try { await gen.return(undefined as never); } catch { /* 已终止 */ } }
      }
      try { controller.close(); } catch { /* 客户端已断开,流已被取消 */ }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
