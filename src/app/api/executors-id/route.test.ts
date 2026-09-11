import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PATCH as PATCH_EXEC } from "@/app/api/executors/[id]/route";
import { POST as TEST_EXEC } from "@/app/api/executors/[id]/test/route";
import { GET as LIST_EX, POST as CREATE_EX } from "@/app/api/executors/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

describe("executors [id] + collection", () => {
  it("PATCH 启用/禁用往返", async () => {
    const ex = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).find((e) => e.name === "快速模型")!;
    const off = await PATCH_EXEC(req(`/api/executors/${ex.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) }), { params: Promise.resolve({ id: ex.id }) });
    expect(off.status).toBe(200);
    expect(((await off.json()).executor as typeof executors.$inferSelect).enabled).toBe(false);
    const on = await PATCH_EXEC(req(`/api/executors/${ex.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }), { params: Promise.resolve({ id: ex.id }) });
    expect(((await on.json()).executor as typeof executors.$inferSelect).enabled).toBe(true);
  });
  it("PATCH 无可更新字段 400;未知 id 404", async () => {
    const ex = (db.select().from(executors).all() as (typeof executors.$inferSelect)[])[0];
    expect((await PATCH_EXEC(req(`/api/executors/${ex.id}`, { method: "PATCH", body: JSON.stringify({}) }), { params: Promise.resolve({ id: ex.id }) })).status).toBe(400);
    expect((await PATCH_EXEC(req("/api/executors/nope", { method: "PATCH", body: JSON.stringify({ enabled: true }) }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
  });
  it("POST 创建执行器(201,默认禁用/role 白名单 400);GET 列表", async () => {
    const res = await CREATE_EX(req("/api/executors", { method: "POST", body: JSON.stringify({ name: "新模型", role: "planner", model: "m1", api_base: "https://x/v1", protocol: "openai", api_key: "sk-n" }) }));
    expect(res.status).toBe(201);
    const created = (await res.json()).executor as typeof executors.$inferSelect;
    expect(created.enabled).toBe(false);
    expect(created.apiKeyRef).toBe("plain:sk-n");
    expect((await (await LIST_EX(req("/api/executors"))).json()).executors.length).toBeGreaterThan(4);
    const bad = await CREATE_EX(req("/api/executors", { method: "POST", body: JSON.stringify({ name: "x", role: "boss" }) }));
    expect(bad.status).toBe(400);
  });
  it("test:ping 模型连通性(mock fetch)", async () => {
    db.update(executors).set({ enabled: true, role: "executor", apiKeyRef: "plain:sk-ping" }).where(eq(executors.name, "快速模型")).run();
    const ex = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).find((e) => e.name === "快速模型")!;
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: "m" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await TEST_EXEC(req(`/api/executors/${ex.id}/test`, { method: "POST" }), { params: Promise.resolve({ id: ex.id }) });
    vi.unstubAllGlobals();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.reply).toBe("pong");
  });
  it("test:未配置 key → ok:false 明确错误", async () => {
    const ex = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).find((e) => e.name === "快速模型")!;
    const res = await TEST_EXEC(req(`/api/executors/${ex.id}/test`, { method: "POST" }), { params: Promise.resolve({ id: ex.id }) });
    const data = await res.json();
    expect(data.ok).toBe(false);
  });
});
