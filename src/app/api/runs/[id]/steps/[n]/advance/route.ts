import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { settings, stepRuns as stepRunsTable, tasks as tasksTable, executors as executorsTable } from "@/lib/db/schema";
import {
  getRun, getSteps, getStepDefsForRun, getCurrentStep, syncRunStatus, RunError,
  approveCheckpoint, rejectCheckpoint, retryStep, manualOverrideStep, skipStep,
} from "@/lib/domain/runner";
import { renderPrompt } from "@/lib/domain/executor-resolve";
import { scanRisk, checkWhitelist, confirmRequired, DEFAULT_WHITELIST } from "@/lib/domain/script-security";
import { executeScript } from "@/lib/domain/script-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id: runId, n } = await params;
  const stepIndex = Number(n);
  const db = getDb();
  const run = getRun(db, runId);
  if (!run) return NextResponse.json({ error: "run 不存在" }, { status: 404 });
  const cur = getCurrentStep(db, runId);
  if (!cur || cur.stepIndex !== stepIndex) return NextResponse.json({ error: "该步骤不是当前步骤" }, { status: 409 });
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const action = body.action as string;
  const steps = getSteps(db, runId);
  const step = steps[stepIndex];
  const def = getStepDefsForRun(db, runId)[stepIndex];
  if (!def) return NextResponse.json({ error: "步骤定义不存在(模板可能已变更)" }, { status: 409 });
  const respond = () => NextResponse.json({ step: getSteps(db, runId)[stepIndex], run: getRun(db, runId) });
  // 领域函数统一抛 RunError(内含 HTTP 状态);其他异常按 500 rethrow
  const guard = (fn: () => unknown) => {
    try { fn(); return respond(); }
    catch (e) { if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status }); throw e; }
  };

  if (step.executorType === "llm") {
    // 不置 running:stream 路由开始执行时置 running,避免并发双流
    if (action === "execute" && step.status === "pending") {
      return NextResponse.json({ step, run, stream: `/api/runs/${runId}/steps/${stepIndex}/stream` });
    }
    if (action === "retry" && step.status === "failed") return guard(() => retryStep(db, runId, stepIndex));
    if (action === "manual_override" && ["failed", "pending"].includes(step.status)) return guard(() => manualOverrideStep(db, runId, stepIndex, String(body.output ?? "")));
  }
  if (step.executorType === "manual" && action === "submit" && step.status === "pending") {
    db.update(stepRunsTable).set({ status: "done", output: String(body.output ?? ""), finishedAt: new Date().toISOString() }).where(and(eq(stepRunsTable.runId, runId), eq(stepRunsTable.stepIndex, stepIndex))).run();
    syncRunStatus(db, runId);
    return respond();
  }
  if (step.executorType === "checkpoint") {
    if (action === "approve" && step.status === "pending") return guard(() => approveCheckpoint(db, runId, stepIndex));
    if (action === "reject" && step.status === "pending") {
      return guard(() => rejectCheckpoint(db, runId, stepIndex, String(body.note ?? ""), typeof body.target_index === "number" ? body.target_index : undefined));
    }
  }
  if (step.executorType === "script") {
    const exOf = () => (def.executor_id ? db.select().from(executorsTable).where(eq(executorsTable.id, def.executor_id)).all()[0] ?? null : null);
    if (action === "execute" && step.status === "pending") {
      const ex = exOf();
      if (!ex || ex.type !== "script" || !ex.enabled) return NextResponse.json({ error: "script 执行器不存在或未启用" }, { status: 409 });
      const task = db.select().from(tasksTable).where(eq(tasksTable.id, run.taskId)).all()[0];
      const prev = [...steps].reverse().find((s) => s.stepIndex < stepIndex);
      const command = renderPrompt(def.command ?? "", { task: { title: task.title, description: task.description }, prevOutput: prev?.output ?? "" });
      const whitelist = readWhitelist(db);
      const workingDir = ex.workingDir ? path.resolve(ex.workingDir) : path.resolve("data", "sandbox");
      if (!checkWhitelist(workingDir, whitelist)) return NextResponse.json({ error: `工作目录不在白名单:${workingDir}` }, { status: 409 });
      // 确认门传【未渲染】的模板命令;人工过目后 confirm 分支执行的是渲染结果(step.input)
      if (confirmRequired(def.command, ex)) {
        db.update(stepRunsTable).set({ status: "awaiting_confirmation", input: command, startedAt: new Date().toISOString() }).where(and(eq(stepRunsTable.runId, runId), eq(stepRunsTable.stepIndex, stepIndex))).run();
        syncRunStatus(db, runId);
        return NextResponse.json({ step: getSteps(db, runId)[stepIndex], command, risks: scanRisk(command), awaiting: true });
      }
      return await runScriptAndRespond(command, ex, workingDir);
    }
    if (action === "confirm" && step.status === "awaiting_confirmation") {
      const ex = exOf();
      if (!ex || ex.type !== "script") return NextResponse.json({ error: "script 执行器不存在" }, { status: 409 });
      const workingDir = ex.workingDir ? path.resolve(ex.workingDir) : path.resolve("data", "sandbox");
      return await runScriptAndRespond(String(step.input ?? ""), ex, workingDir);
    }
    if (action === "retry" && step.status === "failed") return guard(() => retryStep(db, runId, stepIndex));
    if (action === "manual_override" && step.status === "failed") return guard(() => manualOverrideStep(db, runId, stepIndex, String(body.output ?? "")));
  }
  if (action === "skip" && step.status === "pending") return guard(() => skipStep(db, runId, stepIndex));
  return NextResponse.json({ error: `非法动作 ${action}` }, { status: 400 });

  // script 真执行:置 running → spawn 落地 → done/failed(超时/退出码)→ sync 后响应
  async function runScriptAndRespond(command: string, ex: { shell: string | null; timeoutMs: number }, workingDir: string) {
    db.update(stepRunsTable).set({ status: "running", input: command, startedAt: new Date().toISOString() }).where(and(eq(stepRunsTable.runId, runId), eq(stepRunsTable.stepIndex, stepIndex))).run();
    syncRunStatus(db, runId);
    const r = await executeScript(ex.shell ?? "powershell", command, { cwd: workingDir, timeoutMs: ex.timeoutMs });
    const ok = !r.timedOut && r.exitCode === 0;
    db.update(stepRunsTable).set({
      status: ok ? "done" : "failed", output: r.output,
      error: ok ? null : (r.timedOut ? `执行超时(${ex.timeoutMs}ms)` : `退出码 ${r.exitCode ?? "unknown"}`),
      durationMs: r.durationMs, finishedAt: new Date().toISOString(),
    }).where(and(eq(stepRunsTable.runId, runId), eq(stepRunsTable.stepIndex, stepIndex))).run();
    syncRunStatus(db, runId);
    return respond();
  }
}

function readWhitelist(db: ReturnType<typeof getDb>): string[] {
  const row = db.select().from(settings).where(eq(settings.key, "whitelist_dirs")).all()[0];
  if (!row) return DEFAULT_WHITELIST;
  try { const v = JSON.parse(row.value); return Array.isArray(v) ? v : DEFAULT_WHITELIST; } catch { return DEFAULT_WHITELIST; }
}
