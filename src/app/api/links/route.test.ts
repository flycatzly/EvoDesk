import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { GET, POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
const post = (body: unknown) => req("/api/links", { method: "POST", body: JSON.stringify(body) });

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); __setDbForTests(db); });

describe("links api", () => {
  it("POST 创建 → GET 列表(默认分类'常用')", async () => {
    const res = await POST(post({ title: "GitHub", url: "https://github.com" }));
    expect(res.status).toBe(201);
    const list = (await (await GET()).json()) as { links: { title: string; category: string }[] };
    expect(list.links).toHaveLength(1);
    expect(list.links[0].title).toBe("GitHub");
    expect(list.links[0].category).toBe("常用");
  });
  it("POST 拒绝非 http(s) url 与空 title", async () => {
    expect((await POST(post({ title: "x", url: "javascript:alert(1)" }))).status).toBe(400);
    expect((await POST(post({ title: "", url: "https://a.com" }))).status).toBe(400);
    expect((await POST(post({ url: "https://a.com" }))).status).toBe(400);
  });
  it("PATCH 改分类/排序;DELETE 删除", async () => {
    await POST(post({ title: "A", url: "https://a.com" }));
    const { id } = ((await (await GET()).json()) as { links: { id: string }[] }).links[0];
    const patched = (await (await PATCH(req(`/api/links/${id}`, { method: "PATCH", body: JSON.stringify({ category: "学习", sort: 2 }) }), { params: Promise.resolve({ id }) })).json()) as { link: { category: string; sort: number } };
    expect(patched.link.category).toBe("学习");
    expect(patched.link.sort).toBe(2);
    expect((await DELETE(req(`/api/links/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) })).status).toBe(200);
    expect((((await (await GET()).json()) as { links: unknown[] }).links)).toHaveLength(0);
  });
  it("PATCH url 非法返回 400;不存在的 id 返回 404", async () => {
    await POST(post({ title: "A", url: "https://a.com" }));
    const { id } = ((await (await GET()).json()) as { links: { id: string }[] }).links[0];
    expect((await PATCH(req(`/api/links/${id}`, { method: "PATCH", body: JSON.stringify({ url: "ftp://x" }) }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect((await PATCH(req("/api/links/nope", { method: "PATCH", body: JSON.stringify({ title: "x" }) }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
  });
});
