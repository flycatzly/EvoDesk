import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
const post = (body: unknown) => req("/api/goals", { method: "POST", body: JSON.stringify(body) });

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); __setDbForTests(db); });

describe("goals api", () => {
  it("POST 创建 → GET 列表;target≤0 拒绝", async () => {
    expect((await POST(post({ title: "读书", target: 12, current: 3, unit: "本", category: "reading" }))).status).toBe(201);
    expect((await POST(post({ title: "x", target: 0 }))).status).toBe(400);
    expect((await POST(post({ title: "x", target: -1 }))).status).toBe(400);
    expect((await POST(post({ title: "x" }))).status).toBe(400);
    const list = (await (await GET(req("/api/goals")).json()) as { goals: { title: string; category: string }[] };
    expect(list.goals).toHaveLength(1);
    expect(list.goals[0].category).toBe("reading");
  });
  it("PATCH current 步进、归档;归档后默认列表隐藏,archived=1 可见", async () => {
    await POST(post({ title: "健身", target: 48 }));
    const { id } = ((await (await GET(req("/api/goals")).json()) as { goals: { id: string }[] }).goals[0];
    const step = await PATCH(req(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify({ current: 19 }) }), { params: Promise.resolve({ id }) });
    expect(((await step.json()) as { goal: { current: number } }).goal.current).toBe(19);
    await PATCH(req(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify({ archived: true }) }), { params: Promise.resolve({ id }) });
    expect((((await (await GET(req("/api/goals")).json()) as { goals: unknown[] }).goals)).toHaveLength(0);
    expect((((await (await GET(req("/api/goals?archived=1"))).json()) as { goals: unknown[] }).goals)).toHaveLength(1);
  });
  it("PATCH current 为负拒绝;deadline 格式校验;DELETE 删除", async () => {
    await POST(post({ title: "项目", target: 10 }));
    const { id } = ((await (await GET(req("/api/goals")).json()) as { goals: { id: string }[] }).goals[0];
    expect((await PATCH(req(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify({ current: -1 }) }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await PATCH(req(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify({ deadline: "2026-9-1" }) }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await PATCH(req(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify({ deadline: "2026-12-31" }) }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((await DELETE(req(`/api/goals/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) })).status).toBe(200);
  });
});
