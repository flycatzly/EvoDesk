import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { GET, POST } from "../route";
import { POST as RENAME } from "./route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
const post = (body: unknown) => req("/api/links", { method: "POST", body: JSON.stringify(body) });
const rename = (body: unknown) => req("/api/links/rename-category", { method: "POST", body: JSON.stringify(body) });

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); __setDbForTests(db); });

describe("links rename-category api", () => {
  it("批量重命名:该分类全部链接改到新分类", async () => {
    await POST(post({ title: "A", url: "https://a.com", category: "书签栏" }));
    await POST(post({ title: "B", url: "https://b.com", category: "书签栏" }));
    await POST(post({ title: "C", url: "https://c.com", category: "学习" }));
    const res = await RENAME(rename({ from: "书签栏", to: "开发" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(2);
    const list = (await (await GET()).json()) as { links: { title: string; category: string }[] };
    const cats = Object.fromEntries(list.links.map((l) => [l.title, l.category]));
    expect(cats).toEqual({ A: "开发", B: "开发", C: "学习" });
  });
  it("from/to 缺失或空白返回 400;to 超长返回 400", async () => {
    expect((await RENAME(rename({ to: "x" }))).status).toBe(400);
    expect((await RENAME(rename({ from: "x" }))).status).toBe(400);
    expect((await RENAME(rename({ from: " ", to: "x" }))).status).toBe(400);
    expect((await RENAME(rename({ from: "a", to: "x".repeat(51) }))).status).toBe(400);
  });
  it("不存在的分类返回 updated 0(幂等,不算错误)", async () => {
    const res = await RENAME(rename({ from: "不存在的分类", to: "开发" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { updated: number }).updated).toBe(0);
  });
});
