import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
const post = (body: unknown) => req("/api/goals", { method: "POST", body: JSON.stringify(body) });
const get = (query = "") => GET(req(`/api/goals${query}`));
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const firstId = async () => ((await json(await get())).goals as { id: string }[])[0].id;
const patch = (id: string, body: unknown) => PATCH(req(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
const del = (id: string) => DELETE(req(`/api/goals/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); __setDbForTests(db); });

describe("goals api", () => {
  it("POST 创建 → GET 列表;target≤0/缺 title 拒绝", async () => {
    expect((await POST(post({ title: "读书", target: 12, current: 3, unit: "本", category: "reading" }))).status).toBe(201);
    expect((await POST(post({ title: "x", target: 0 }))).status).toBe(400);
    expect((await POST(post({ title: "x", target: -1 }))).status).toBe(400);
    expect((await POST(post({ title: "x" }))).status).toBe(400);
    const { goals } = await json(await get()) as { goals: { title: string; category: string }[] };
    expect(goals).toHaveLength(1);
    expect(goals[0].category).toBe("reading");
  });
  it("PATCH current 步进、归档;归档后默认列表隐藏,archived=1 可见", async () => {
    await POST(post({ title: "健身", target: 48 }));
    const id = await firstId();
    const stepped = await json(await patch(id, { current: 19 })) as { goal: { current: number } };
    expect(stepped.goal.current).toBe(19);
    await patch(id, { archived: true });
    expect(((await json(await get())).goals as unknown[])).toHaveLength(0);
    expect(((await json(await get("?archived=1"))).goals as unknown[])).toHaveLength(1);
  });
  it("PATCH current 为负拒绝;deadline 格式校验;DELETE 删除", async () => {
    await POST(post({ title: "项目", target: 10 }));
    const id = await firstId();
    expect((await patch(id, { current: -1 })).status).toBe(400);
    expect((await patch(id, { deadline: "2026-9-1" })).status).toBe(400);
    expect((await patch(id, { deadline: "2026-12-31" })).status).toBe(200);
    expect((await del(id)).status).toBe(200);
    expect(((await json(await get())).goals as unknown[])).toHaveLength(0);
  });
});
