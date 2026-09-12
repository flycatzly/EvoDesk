import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { flowRuns, stepRuns, flowTemplates, executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST as ANALYZE } from "@/app/api/evolution/analyze/route";
import { GET as EVENTS } from "@/app/api/evolution/events/route";
import { POST as CLONE } from "@/app/api/templates/[id]/clone/route";
import { POST as RETIRE } from "@/app/api/templates/[id]/retire/route";
import { POST as PROMOTE } from "@/app/api/templates/[id]/promote/route";

// Next 16 的 NextRequest 使用自带 RequestInit(signal 不允许 null),从构造器反推类型以通过 next build 的全量类型检查
type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
let tpl: typeof flowTemplates.$inferSelect;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  tpl = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.name === "S 轻量通道")!;
});
function seedDoneRun() {
  const runId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.insert(flowRuns).values({ id: runId, taskId: crypto.randomUUID(), templateId: tpl.id, templateVersion: 1, status: "done", startedAt: nowIso, finishedAt: nowIso, totalCostUsd: 0.01, totalDurationMs: 1000 }).run();
  db.insert(stepRuns).values({ id: crypto.randomUUID(), runId, stepIndex: 0, stepName: "快速执行", executorType: "llm", status: "done", output: "x" }).run();
}

describe("evolution analyze/events", () => {
  it("mock LLM 复盘:变体以 experimental 落库(parent 指向原版)+ analysis_run 事件", async () => {
    for (let i = 0; i < 5; i++) seedDoneRun();
    db.update(executors).set({ enabled: true, role: "evolution", model: "m", apiBase: "https://x", protocol: "openai", apiKeyRef: "plain:k" }).where(eq(executors.name, "强模型")).run();
    const variants = [{ name: "S 精简版", changes: [{ op: "remove_step", index: 1 }], rationale: "checkpoint 打回率高" }];
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ diagnosis: "d", variants, retire_suggestions: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: "m" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await ANALYZE(req("/api/evolution/analyze", { method: "POST", body: JSON.stringify({ template_id: tpl.id }) }));
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.variants.length).toBe(1);
    const v = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.name === "S 精简版")!;
    expect(v.status).toBe("experimental");
    expect(v.parentId).toBe(tpl.id);
    expect(v.lineageId).toBe(tpl.lineageId);
    expect(JSON.parse(v.steps)).toHaveLength(1);
  });
  it("LLM 输出非法 → 502 degraded", async () => {
    for (let i = 0; i < 5; i++) seedDoneRun();
    db.update(executors).set({ enabled: true, role: "evolution", model: "m", apiBase: "https://x" }).where(eq(executors.name, "强模型")).run();
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }], usage: {}, model: "m" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await ANALYZE(req("/api/evolution/analyze", { method: "POST", body: JSON.stringify({ template_id: tpl.id }) }));
    vi.unstubAllGlobals();
    expect(res.status).toBe(502);
  });
  it("GET events 返回时间线", async () => {
    const res = await EVENTS(req("/api/evolution/events"));
    expect(res.status).toBe(200);
  });
});

describe("templates clone/retire/promote", () => {
  it("克隆:副本 manual/active/新 id,名称含 副本", async () => {
    const res = await CLONE(req(`/api/templates/${tpl.id}/clone`, { method: "POST" }), { params: Promise.resolve({ id: tpl.id }) });
    const data = await res.json();
    expect(data.template.status).toBe("active");
    expect(data.template.origin).toBe("manual");
    expect(data.template.name).toContain("副本");
    expect(data.template.id).not.toBe(tpl.id);
  });
  it("退役 → retired;晋升非实验 409", async () => {
    const r = await RETIRE(req(`/api/templates/${tpl.id}/retire`, { method: "POST", body: JSON.stringify({ reason: "x" }) }), { params: Promise.resolve({ id: tpl.id }) });
    expect((await r.json()).template.status).toBe("retired");
    const p = await PROMOTE(req(`/api/templates/${tpl.id}/promote`, { method: "POST" }), { params: Promise.resolve({ id: tpl.id }) });
    expect(p.status).toBe(409);
  });
});
