import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { canvases } from "@/lib/db/schema";
import { GET, POST } from "./route";
import { PUT, DELETE } from "./[id]/route";
import { POST as share } from "./[id]/share/route";
import { GET as byToken } from "./by-token/[token]/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
const json = async (res: Response) => (await res.json()) as Record<string, unknown>;
const post = (body: unknown) => req("/api/canvases", { method: "POST", body: JSON.stringify(body) });

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); __setDbForTests(db); });

const GOOD_LAYOUT = [{ groupTitle: "g1", widgets: [{ id: "w1", type: "todo", config: {} }] }];

async function newCanvas(body: unknown) {
  const res = await POST(post(body));
  const { canvas } = await json(res) as { canvas: { id: string; name: string; layout: string; isTemplate: boolean } };
  return { res, canvas };
}

describe("canvases api", () => {
  it("POST 新建画布;layout 非法返回 400", async () => {
    const { res, canvas } = await newCanvas({ name: "我的画布", layout: GOOD_LAYOUT });
    expect(res.status).toBe(201);
    expect(canvas.name).toBe("我的画布");
    expect(canvas.isTemplate).toBe(false);
    expect((await POST(post({ layout: [{ groupTitle: "", widgets: [] }] }))).status).toBe(400);
    expect((await POST(post({ layout: [{ groupTitle: "g", widgets: [{ id: "w", type: "nope", config: {} }] }] }))).status).toBe(400);
  });
  it("POST from_template 深拷贝模板 layout 为新画布", async () => {
    const now = new Date().toISOString();
    db.insert(canvases).values({ id: "tpl1", name: "学生工作台", columns: "2", locked: false, isTemplate: true, shareToken: null, layout: JSON.stringify(GOOD_LAYOUT), createdAt: now, updatedAt: now }).run();
    const { canvas } = await newCanvas({ name: "我的学习台", from_template: "tpl1" });
    const copied = JSON.parse(canvas.layout) as { widgets: { id: string; type: string }[] }[];
    expect(copied[0].widgets[0].type).toBe("todo");
    expect(copied[0].widgets[0].id).not.toBe("w1"); // id 已重写
    expect(canvas.isTemplate).toBe(false);
    expect((await newCanvas({ from_template: "tpl-nonexist" })).res.status).toBe(404);
  });
  it("GET 列表默认不含模板,with_templates=1 含模板", async () => {
    const now = new Date().toISOString();
    db.insert(canvases).values({ id: "tpl1", name: "模板", columns: "2", locked: false, isTemplate: true, shareToken: null, layout: "[]", createdAt: now, updatedAt: now }).run();
    await newCanvas({ name: "普通" });
    expect((((await json(await GET(req("/api/canvases")))) as { canvases: unknown[] }).canvases)).toHaveLength(1);
    expect((((await json(await GET(req("/api/canvases?with_templates=1")))) as { canvases: unknown[] }).canvases)).toHaveLength(2);
  });
  it("PUT 整存 layout/locked/columns/name;非法 layout 400", async () => {
    const { canvas } = await newCanvas({ name: "c1" });
    const res = await PUT(req(`/api/canvases/${canvas.id}`, { method: "PUT", body: JSON.stringify({ layout: GOOD_LAYOUT, locked: true, columns: "3", name: "改名" }) }), { params: Promise.resolve({ id: canvas.id }) });
    const { canvas: updated } = await json(res) as { canvas: { name: string; locked: boolean; columns: string; layout: string } };
    expect(updated.name).toBe("改名");
    expect(updated.locked).toBe(true);
    expect(updated.columns).toBe("3");
    expect(JSON.parse(updated.layout)).toEqual(GOOD_LAYOUT);
    expect((await PUT(req(`/api/canvases/${canvas.id}`, { method: "PUT", body: JSON.stringify({ layout: { bad: 1 } }) }), { params: Promise.resolve({ id: canvas.id }) })).status).toBe(400);
  });
  it("DELETE 删除画布;模板不可删", async () => {
    const now = new Date().toISOString();
    db.insert(canvases).values({ id: "tpl1", name: "模板", columns: "2", locked: false, isTemplate: true, shareToken: null, layout: "[]", createdAt: now, updatedAt: now }).run();
    const { canvas } = await newCanvas({ name: "c1" });
    expect((await DELETE(req(`/api/canvases/tpl1`, { method: "DELETE" }), { params: Promise.resolve({ id: "tpl1" }) })).status).toBe(400);
    expect((await DELETE(req(`/api/canvases/${canvas.id}`, { method: "DELETE" }), { params: Promise.resolve({ id: canvas.id }) })).status).toBe(200);
  });
  it("share 生成 16hex token;revoke 吊销;by-token 命中/404", async () => {
    const { canvas } = await newCanvas({ name: "share-me" });
    const { shareToken } = await json(await share(req(`/api/canvases/${canvas.id}/share`, { method: "POST" }), { params: Promise.resolve({ id: canvas.id }) })) as { shareToken: string };
    expect(shareToken).toMatch(/^[0-9a-f]{16}$/);
    const hit = await json(await byToken(req(`/api/canvases/by-token/${shareToken}`), { params: Promise.resolve({ token: shareToken }) })) as { canvas: { name: string; layout: string } };
    expect(hit.canvas.name).toBe("share-me");
    expect(hit.canvas).not.toHaveProperty("locked"); // 只暴露展示字段
    await share(req(`/api/canvases/${canvas.id}/share?revoke=1`, { method: "POST" }), { params: Promise.resolve({ id: canvas.id }) });
    expect((await byToken(req(`/api/canvases/by-token/${shareToken}`), { params: Promise.resolve({ token: shareToken }) })).status).toBe(404);
    expect((await byToken(req(`/api/canvases/by-token/deadbeef`), { params: Promise.resolve({ token: "deadbeef" }) })).status).toBe(404);
  });
});
