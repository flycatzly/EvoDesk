import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors, tasks, stepRuns, flowRuns, flowTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST as START } from "@/app/api/tasks/[id]/start/route";
import { GET as GET_RUN } from "@/app/api/runs/[id]/route";
import { POST as ADVANCE } from "@/app/api/runs/[id]/steps/[n]/advance/route";
import { POST as FEEDBACK } from "@/app/api/runs/[id]/feedback/route";
import { POST as CANCEL } from "@/app/api/runs/[id]/cancel/route";

// Next 16 的 NextRequest 使用自带 RequestInit(signal 不允许 null),从构造器反推类型以通过 next build 的全量类型检查
type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
let readyTaskId: string;
let psExecutorId: string;

beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  readyTaskId = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "ready")!.id;
  // 种子的就绪任务未绑定模板(分诊确认才绑定);默认绑 S 轻量通道(2 步),脚本用例另行换绑脚本模板
  const sTpl = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.name === "S 轻量通道")!;
  db.update(tasks).set({ flowTemplateId: sTpl.id }).where(eq(tasks.id, readyTaskId)).run();
  psExecutorId = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).find((e) => e.name === "PowerShell 本地执行")!.id;
});

async function startRun(): Promise<string> {
  const res = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
  expect(res.status).toBe(201);
  return (await res.json()).runId as string;
}
const ADV = (runId: string, n: number, body: Record<string, unknown>) =>
  ADVANCE(req(`/api/runs/${runId}/steps/${n}/advance`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: runId, n: String(n) }) });

function stepOf(runId: string, i: number) {
  return (db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all() as unknown as (typeof stepRuns.$inferSelect)[]).find((s) => s.stepIndex === i)!;
}
function runOf(runId: string) {
  return db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0] as typeof flowRuns.$inferSelect;
}
function taskOf(id: string) {
  return db.select().from(tasks).where(eq(tasks.id, id)).all()[0] as typeof tasks.$inferSelect;
}
/** 就绪任务换绑临时脚本模板(单 script 步) */
function bindScriptTemplate(command: string) {
  const tpl = {
    id: crypto.randomUUID(), name: "T脚本", description: "", tags: "[]", complexity: "M", version: 1,
    lineageId: crypto.randomUUID(), origin: "manual", status: "active",
    steps: JSON.stringify([{ name: "跑命令", type: "script", executor_id: psExecutorId, command }]),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.insert(flowTemplates).values(tpl).run();
  db.update(tasks).set({ flowTemplateId: tpl.id }).where(eq(tasks.id, readyTaskId)).run();
}

describe("POST /api/tasks/[id]/start", () => {
  it("start:201 + runId;重复 start → 409(任务已 running)", async () => {
    const res = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
    expect(res.status).toBe(201);
    const runId = (await res.json()).runId as string;
    expect(runId).toBeTruthy();
    const again = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
    expect(again.status).toBe(409);
  });
  it("start:任务被手工挪回 ready 但 run 仍在进行 → 409 已有进行中的执行(状态机外漏洞兜底)", async () => {
    const runId = await startRun();
    expect(runOf(runId).status).toBe("running");
    db.update(tasks).set({ status: "ready" }).where(eq(tasks.id, readyTaskId)).run();
    const again = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toContain("已有进行中的执行");
  });
});

describe("GET /api/runs/[id]", () => {
  it("返回 run+steps+currentStepIndex 0+stepDefs 长度 2", async () => {
    const runId = await startRun();
    const res = await GET_RUN(req(`/api/runs/${runId}`), { params: Promise.resolve({ id: runId }) });
    const data = await res.json();
    expect(data.run.id).toBe(runId);
    expect(data.steps).toHaveLength(2);
    expect(data.currentStepIndex).toBe(0);
    expect(data.stepDefs).toHaveLength(2);
  });
  it("不存在的 run:syncRunStatus 不抛 → 404", async () => {
    const res = await GET_RUN(req("/api/runs/no-such-run"), { params: Promise.resolve({ id: "no-such-run" }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/runs/[id]/steps/[n]/advance(llm 分支)", () => {
  it("execute:返回 stream 路径,步骤仍 pending(stream 路由负责置 running,避免并发双流)", async () => {
    const runId = await startRun();
    const res = await ADV(runId, 0, { action: "execute" });
    const data = await res.json();
    expect(data.step.status).toBe("pending");
    expect(data.stream).toBe(`/api/runs/${runId}/steps/0/stream`);
  });
  it("非当前步骤 → 409", async () => {
    const runId = await startRun();
    const res = await ADV(runId, 1, { action: "approve" });
    expect(res.status).toBe(409);
  });
  it("非法动作 → 400", async () => {
    const runId = await startRun();
    const res = await ADV(runId, 0, { action: "dance" });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/runs/[id]/steps/[n]/advance(script 分支)", () => {
  it("execute:autoApprove=false → awaiting_confirmation + risks + 渲染命令落 input,run 转等待人工", async () => {
    bindScriptTemplate("Write-Output hi-{{task.title}}");
    const runId = await startRun();
    const res = await ADV(runId, 0, { action: "execute" });
    const data = await res.json();
    expect(data.awaiting).toBe(true);
    expect(Array.isArray(data.risks)).toBe(true);
    expect(data.step.status).toBe("awaiting_confirmation");
    expect(data.step.input).toBe(`Write-Output hi-${taskOf(readyTaskId).title}`);
    expect(runOf(runId).status).toBe("waiting_human");
  });
  it("confirm:真正执行渲染命令 → done,输出含渲染结果", async () => {
    db.update(tasks).set({ title: "script" }).where(eq(tasks.id, readyTaskId)).run();
    bindScriptTemplate("Write-Output hi-{{task.title}}");
    const runId = await startRun();
    await ADV(runId, 0, { action: "execute" });
    const res = await ADV(runId, 0, { action: "confirm" });
    const data = await res.json();
    expect(data.step.status).toBe("done");
    expect(data.step.output).toContain("hi-script");
    expect(data.step.exitCode).toBeUndefined(); // 响应只含 step/run,不经管道泄漏执行细节
    expect(runOf(runId).status).toBe("done"); // 单步模板跑完 → run done
  });
  it("execute:工作目录不在白名单 → 409", async () => {
    db.update(executors).set({ workingDir: "C:\\Windows" }).where(eq(executors.id, psExecutorId)).run();
    bindScriptTemplate("Write-Output hi");
    const runId = await startRun();
    const res = await ADV(runId, 0, { action: "execute" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("工作目录不在白名单");
  });
  it("execute:autoApprove=true + 静态命令 → 免确认直接执行 done", async () => {
    db.update(executors).set({ autoApprove: true }).where(eq(executors.id, psExecutorId)).run();
    bindScriptTemplate("Write-Output hi-static");
    const runId = await startRun();
    const res = await ADV(runId, 0, { action: "execute" });
    const data = await res.json();
    expect(data.awaiting).toBeUndefined();
    expect(data.step.status).toBe("done");
    expect(data.step.output).toContain("hi-static");
  });
  it("confirm:执行器在等待期间被禁用 → 409(execute→confirm 间隙 TOCTOU 再校验)", async () => {
    bindScriptTemplate("Write-Output hi-{{task.title}}");
    const runId = await startRun();
    await ADV(runId, 0, { action: "execute" });
    db.update(executors).set({ enabled: false }).where(eq(executors.id, psExecutorId)).run();
    const res = await ADV(runId, 0, { action: "confirm" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("不存在或未启用");
  });
  it("confirm:工作目录在等待期间被改出白名单 → 409(execute→confirm 间隙 TOCTOU 再校验)", async () => {
    bindScriptTemplate("Write-Output hi-{{task.title}}");
    const runId = await startRun();
    await ADV(runId, 0, { action: "execute" });
    db.update(executors).set({ workingDir: "C:\\Windows" }).where(eq(executors.id, psExecutorId)).run();
    const res = await ADV(runId, 0, { action: "confirm" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("工作目录不在白名单");
  });
});

describe("checkpoint 流程(approve / reject / feedback)", () => {
  function simulateStreamDone(runId: string) {
    // 模拟 stream 路由执行完成后的落库(持久化 UPDATE 与 stream 路由一致);approve 内部会再次 syncRunStatus
    db.update(stepRuns).set({ status: "done", output: "ok", tokensIn: 5, tokensOut: 2, costUsd: 0.01, durationMs: 100, finishedAt: new Date().toISOString() })
      .where(eq(stepRuns.id, stepOf(runId, 0).id)).run();
  }
  it("approve → run done + task review;feedback → task done + 模板统计;非法评分 400;重复 feedback 409", async () => {
    const runId = await startRun();
    simulateStreamDone(runId);
    const resA = await ADV(runId, 1, { action: "approve" });
    expect(resA.status).toBe(200);
    expect(runOf(runId).status).toBe("done");
    expect(taskOf(readyTaskId).status).toBe("review");
    const fb = await FEEDBACK(req(`/api/runs/${runId}/feedback`, { method: "POST", body: JSON.stringify({ satisfaction: 5, outcome_note: "很棒" }) }), { params: Promise.resolve({ id: runId }) });
    expect(fb.status).toBe(200);
    expect(taskOf(readyTaskId).status).toBe("done");
    expect(runOf(runId).outcomeNote).toBe("很棒");
    const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, runOf(runId).templateId)).all()[0] as typeof flowTemplates.$inferSelect;
    expect(tpl.statRuns).toBe(1);
    expect(tpl.statAvgSatisfaction).toBe(5);
    const bad = await FEEDBACK(req(`/api/runs/${runId}/feedback`, { method: "POST", body: JSON.stringify({ satisfaction: 0 }) }), { params: Promise.resolve({ id: runId }) });
    expect(bad.status).toBe(400);
    const again = await FEEDBACK(req(`/api/runs/${runId}/feedback`, { method: "POST", body: JSON.stringify({ satisfaction: 4 }) }), { params: Promise.resolve({ id: runId }) });
    expect(again.status).toBe(409); // 任务已 done,不在 review
  });
  it("reject:目标步骤回 pending,checkpoint 记 rejected=1", async () => {
    const runId = await startRun();
    simulateStreamDone(runId);
    const res = await ADV(runId, 1, { action: "reject", note: "重来" });
    expect(res.status).toBe(200);
    expect(stepOf(runId, 0).status).toBe("pending");
    expect(stepOf(runId, 1).rejected).toBe(1);
    expect(stepOf(runId, 1).feedbackNote).toBe("重来");
  });
});

describe("POST /api/runs/[id]/cancel", () => {
  it("cancel:run canceled + 未完成步骤 skipped + 任务回 ready;重复 cancel → 409", async () => {
    const runId = await startRun();
    const res = await CANCEL(req(`/api/runs/${runId}/cancel`, { method: "POST" }), { params: Promise.resolve({ id: runId }) });
    expect(res.status).toBe(200);
    const run = runOf(runId);
    expect(run.status).toBe("canceled");
    expect(run.finishedAt).toBeTruthy();
    expect(stepOf(runId, 0).status).toBe("skipped");
    expect(stepOf(runId, 1).status).toBe("skipped");
    expect(taskOf(readyTaskId).status).toBe("ready");
    const again = await CANCEL(req(`/api/runs/${runId}/cancel`, { method: "POST" }), { params: Promise.resolve({ id: runId }) });
    expect(again.status).toBe(409);
  });
});

describe("stale sweep(GET 时的进程中断自愈)", () => {
  it("llm 步 running 超 150s → GET run 时标记 failed(进程中断)+ run waiting_human", async () => {
    const runId = await startRun();
    db.update(stepRuns).set({ status: "running", startedAt: new Date(Date.now() - 3 * 60_000).toISOString() }).where(eq(stepRuns.id, stepOf(runId, 0).id)).run();
    const res = await GET_RUN(req(`/api/runs/${runId}`), { params: Promise.resolve({ id: runId }) });
    const data = await res.json();
    expect(data.steps[0].status).toBe("failed");
    expect(data.steps[0].error).toContain("进程中断");
    expect(data.run.status).toBe("waiting_human");
    expect(data.currentStepIndex).toBe(0); // failed 非终态,仍是当前步(可重试/人工接管)
  });
});
