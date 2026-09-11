import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors, tasks, stepRuns, flowRuns, flowTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GET as STREAM } from "@/app/api/runs/[id]/steps/[n]/stream/route";
import { POST as START } from "@/app/api/tasks/[id]/start/route";
import { POST as ADVANCE } from "@/app/api/runs/[id]/steps/[n]/advance/route";

// Next 16 的 NextRequest 使用自带 RequestInit(signal 不允许 null),从构造器反推类型以通过 next build 的全量类型检查
type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
let readyTaskId: string;

beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  readyTaskId = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "ready")!.id;
  // 启用种子模型执行器并绑定 executor 角色;成本 > 0 以断言 run.totalCostUsd 聚合
  db.update(executors).set({ enabled: true, role: "executor", costPer1kInput: 0.001, costPer1kOutput: 0.002 })
    .where(eq(executors.name, "快速模型")).run();
  bindSingleLlmTemplate();
});
afterEach(() => { vi.unstubAllGlobals(); });

/** 单 llm 步模板:stream done 后 run 即完成,syncRunStatus 聚合 totalCostUsd(多步模板会停在 waiting_human 无法断言) */
function bindSingleLlmTemplate() {
  const tpl = {
    id: crypto.randomUUID(), name: "T流式", description: "", tags: "[]", complexity: "S", version: 1,
    lineageId: crypto.randomUUID(), origin: "manual", status: "active",
    steps: JSON.stringify([{ name: "快速执行", type: "llm", executorRole: "executor", prompt: "直接完成任务:{{task.title}}", optional: false }]),
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.insert(flowTemplates).values(tpl).run();
  db.update(tasks).set({ flowTemplateId: tpl.id }).where(eq(tasks.id, readyTaskId)).run();
}

async function startRun(): Promise<string> {
  const res = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
  expect(res.status).toBe(201);
  return ((await res.json()) as { runId: string }).runId;
}
/** start + advance execute:llm 步骤仍 pending,stream 路由负责置 running */
async function startAndExecute(): Promise<string> {
  const runId = await startRun();
  const res = await ADVANCE(req(`/api/runs/${runId}/steps/0/advance`, { method: "POST", body: JSON.stringify({ action: "execute" }) }), { params: Promise.resolve({ id: runId, n: "0" }) });
  expect(res.status).toBe(200);
  return runId;
}
function stepOf(runId: string, i: number) {
  return (db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all() as unknown as (typeof stepRuns.$inferSelect)[]).find((s) => s.stepIndex === i)!;
}
function runOf(runId: string) {
  return db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0] as typeof flowRuns.$inferSelect;
}
const STREAM_URL = (runId: string, n = "0") => req(`/api/runs/${runId}/steps/${n}/stream`, { method: "GET" });
const streamParams = (runId: string, n = "0") => ({ params: Promise.resolve({ id: runId, n }) });

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({ start(c) { chunks.forEach((ch) => c.enqueue(encoder.encode(ch))); c.close(); } }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}
/** openai 形态:两个文本 delta + usage + [DONE] → 聚合 "你好",tokensIn 7 / tokensOut 2 */
const YOUHAO_CHUNKS = [
  'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
  'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n',
  "data: [DONE]\n\n",
];
function parseSse(text: string): Record<string, unknown>[] {
  return text.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as Record<string, unknown>);
}
/** 模拟 cancel 路由副作用:run canceled + 未完成步骤 skipped */
function simulateCancel(runId: string) {
  const nowIso = new Date().toISOString();
  db.update(flowRuns).set({ status: "canceled", finishedAt: nowIso }).where(eq(flowRuns.id, runId)).run();
  db.update(stepRuns).set({ status: "skipped", finishedAt: nowIso }).where(eq(stepRuns.id, stepOf(runId, 0).id)).run();
}
/** 两段式上游:release1 放行首批 delta,release2 放行剩余(可指定 error 收尾)——用于断连时序控制 */
function gatedUpstream(part1: string[], part2: string[], part2Error?: Error) {
  let release1!: () => void; let release2!: () => void;
  const g1 = new Promise<void>((r) => { release1 = r; });
  const g2 = new Promise<void>((r) => { release2 = r; });
  const enc = new TextEncoder();
  const f = vi.fn().mockImplementation(async () => new Response(new ReadableStream({
    async start(c) {
      await g1;
      part1.forEach((s) => c.enqueue(enc.encode(s)));
      await g2;
      part2.forEach((s) => c.enqueue(enc.encode(s)));
      if (part2Error) c.error(part2Error); else c.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } }));
  return { f, release1, release2 };
}

describe("GET /api/runs/[id]/steps/[n]/stream", () => {
  it("SSE happy path:delta 事件 + done 事件,步骤落库 done,run.totalCostUsd 聚合", async () => {
    const runId = await startAndExecute();
    const f = vi.fn().mockResolvedValue(sseResponse(YOUHAO_CHUNKS));
    vi.stubGlobal("fetch", f);
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    expect(events.filter((e) => "delta" in e).map((e) => e.delta)).toEqual(["你", "好"]);
    const done = events.at(-1) as { done: true; step: { status: string; output: string | null; costUsd: number }; run: { status: string; totalCostUsd: number } };
    expect(done.done).toBe(true);
    expect(done.step.status).toBe("done");
    expect(done.step.output).toBe("你好");
    expect(done.step.costUsd).toBeGreaterThan(0);
    expect(done.run.status).toBe("done"); // 单步模板跑完
    expect(done.run.totalCostUsd).toBeGreaterThan(0);
    expect(stepOf(runId, 0).status).toBe("done");
    expect(stepOf(runId, 0).output).toBe("你好");
    expect(runOf(runId).totalCostUsd).toBeGreaterThan(0);
  });
  it("非当前步骤 → 409", async () => {
    const runId = await startAndExecute();
    const res = await STREAM(STREAM_URL(runId, "1"), streamParams(runId, "1"));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("当前步骤");
  });
  it("run 已取消 → 409 已结束或已取消", async () => {
    const runId = await startAndExecute();
    db.update(flowRuns).set({ status: "canceled", finishedAt: new Date().toISOString() }).where(eq(flowRuns.id, runId)).run();
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("已结束或已取消");
  });
  it("running-claim 竞争:步骤已被其他请求置 running → 409 正在执行", async () => {
    // 注:claim.changes===0 丢失竞争分支不可在本进程内确定性触发(cur 读取与条件 UPDATE 间无 await 可插队),由条件 WHERE 兜底
    const runId = await startAndExecute();
    db.update(stepRuns).set({ status: "running", startedAt: new Date().toISOString() }).where(eq(stepRuns.id, stepOf(runId, 0).id)).run();
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("正在执行");
    expect(stepOf(runId, 0).status).toBe("running"); // 未被扰动
  });
  it("done 落库前 run 被取消 → 不覆写 skipped 步骤,发送 canceled:true", async () => {
    const runId = await startAndExecute();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = vi.fn().mockImplementation(async () => { await gate; return sseResponse(YOUHAO_CHUNKS); });
    vi.stubGlobal("fetch", f);
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(f).toHaveBeenCalled(); // start() 已发起上游请求并阻塞在门上
    simulateCancel(runId); // 落库发生在 res.text() 驱动的 start() 内,此刻取消 → persist 前重读见 canceled
    release();
    const events = parseSse(await res.text());
    expect(events.filter((e) => "delta" in e).map((e) => e.delta)).toEqual(["你", "好"]);
    expect(events.at(-1)).toMatchObject({ done: true, canceled: true });
    const s0 = stepOf(runId, 0);
    expect(s0.status).toBe("skipped"); // 未被 done 覆写
    expect(s0.output).toBeNull();
  });
  it("上游抛错且 run 已取消 → 不覆写 skipped 步骤,发送 canceled:true", async () => {
    const runId = await startAndExecute();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = vi.fn().mockImplementation(async () => { await gate; throw new Error("boom"); });
    vi.stubGlobal("fetch", f);
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(f).toHaveBeenCalled();
    simulateCancel(runId);
    release();
    const events = parseSse(await res.text());
    expect(events.at(-1)).toMatchObject({ done: true, canceled: true });
    expect(stepOf(runId, 0).status).toBe("skipped");
  });
  it("上游流失败 → done 事件含 error,步骤落库 failed,run 转 waiting_human", async () => {
    const runId = await startAndExecute();
    const f = vi.fn().mockRejectedValue(new Error("上游炸了"));
    vi.stubGlobal("fetch", f);
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    const events = parseSse(await res.text());
    const done = events.at(-1) as { done: true; error: string; step: { status: string } };
    expect(done.done).toBe(true);
    expect(done.error).toContain("上游炸了");
    expect(done.step.status).toBe("failed");
    expect(stepOf(runId, 0).status).toBe("failed");
    expect(runOf(runId).status).toBe("waiting_human"); // failed 是当前步 → 等待人工
  });
  it("客户端中途断开:send 断连安全,无 spurious failed;上游走完仍正常 done 落库", async () => {
    const runId = await startAndExecute();
    const { f, release1, release2 } = gatedUpstream([YOUHAO_CHUNKS[0], YOUHAO_CHUNKS[1]], [YOUHAO_CHUNKS[2], YOUHAO_CHUNKS[3]]);
    vi.stubGlobal("fetch", f);
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(f).toHaveBeenCalled();
    release1();
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    expect(dec.decode((await reader.read()).value!)).toContain('"delta":"你"');
    expect(dec.decode((await reader.read()).value!)).toContain('"delta":"好"');
    await reader.cancel(); // 客户端断开:此后 enqueue 会抛出
    release2();
    await vi.waitFor(() => expect(stepOf(runId, 0).status).not.toBe("running"));
    expect(stepOf(runId, 0).status).toBe("done"); // 上游完整走完 → 正常 done(而非断开引发的 failed)
    expect(stepOf(runId, 0).output).toBe("你好");
    expect(stepOf(runId, 0).error).toBeNull();
  });
  it("客户端中途断开且上游随后报错:断连分支不落库不发事件(断开 ≠ 步骤失败)", async () => {
    const runId = await startAndExecute();
    const { f, release1, release2 } = gatedUpstream(
      [YOUHAO_CHUNKS[0]],
      ['data: {"choices":[{"delta":{"content":"断开后 delta"}}]}\n\n'],
      new Error("上游炸了"),
    );
    vi.stubGlobal("fetch", f);
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(f).toHaveBeenCalled();
    release1();
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value!)).toContain('"delta":"你"');
    await reader.cancel();
    release2(); // 断开后的 delta 使 send 抛出置 closed,随后上游 error → catch 断连分支:不落库
    await new Promise((r) => setTimeout(r, 20)); // 断连分支全在微任务/IO 内完成,留出事件循环时间
    expect(stepOf(runId, 0).status).toBe("running"); // 不落库:既非 failed 也未推进
    expect(stepOf(runId, 0).error).toBeNull();
    expect(runOf(runId).status).toBe("running");
  });
  it("无可用执行器 → 409 + markStepFailed(错误含 可用)", async () => {
    const runId = await startAndExecute();
    db.update(executors).set({ enabled: false }).where(eq(executors.name, "快速模型")).run();
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("可用");
    expect(stepOf(runId, 0).status).toBe("failed");
    expect(stepOf(runId, 0).error).toContain("可用");
  });
  it("执行器缺模型配置 → 409 + markStepFailed(错误含 未配置模型或端点)", async () => {
    const runId = await startAndExecute();
    db.update(executors).set({ model: null }).where(eq(executors.name, "快速模型")).run();
    const res = await STREAM(STREAM_URL(runId), streamParams(runId));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toContain("未配置模型或端点");
    expect(stepOf(runId, 0).status).toBe("failed");
    expect(stepOf(runId, 0).error).toContain("未配置模型或端点");
  });
});
