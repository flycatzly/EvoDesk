import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { GET, POST } from "../route";
import { POST as ORGANIZE } from "./route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
const post = (body: unknown, url = "/api/links") => req(url, { method: "POST", body: JSON.stringify(body) });
const list = async () => (await (await GET()).json()) as { links: { id: string; title: string; url: string; category: string }[] };

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); __setDbForTests(db); });
const add = (title: string, url: string, category: string) => POST(post({ title, url, category }));

describe("links organize api", () => {
  it("preview 不改数据:自动分类只针对杂物分类下的命中项", async () => {
    await add("GitHub", "https://github.com/x", "收藏夹");
    await add("知乎", "https://zhihu.com", "书签栏");
    await add("某政府网", "https://www.gov.cn", "收藏夹"); // 规则未命中 → 保持
    await add("GitHub 官方", "https://github.com/y", "开发"); // 非杂物 → 不动
    const before = await list();
    const res = await ORGANIZE(post({ action: "preview" }, "/api/links/organize"));
    const data = (await res.json()) as { auto: { id: string; to: string }[]; renames: unknown[]; duplicateGroups: { key: string; links: unknown[] }[] };
    expect(data.auto.map((a) => a.to)).toEqual(["开发", "阅读资讯"]); // 收藏夹下的 github + 书签栏下的知乎
    expect(data.duplicateGroups).toHaveLength(0);
    expect((await list()).links).toEqual(before.links); // preview 零写入
  });
  it("auto 应用后杂物分类链接进入规则分类,未命中保持原分类", async () => {
    await add("GitHub", "https://github.com/x", "收藏夹");
    await add("某政府网", "https://www.gov.cn", "收藏夹");
    const res = await ORGANIZE(post({ action: "auto" }, "/api/links/organize"));
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
    const cats = Object.fromEntries((await list()).links.map((l) => [l.title, l.category]));
    expect(cats["GitHub"]).toBe("开发");
    expect(cats["某政府网"]).toBe("收藏夹");
  });
  it("dedupe 按归一化 URL 去重保留最早一条", async () => {
    await add("A", "https://github.com/x", "开发");
    await add("A2", "https://www.github.com/x/", "学习");
    await add("B", "https://unique.com", "开发");
    const res = await ORGANIZE(post({ action: "dedupe" }, "/api/links/organize"));
    expect(((await res.json()) as { removed: number }).removed).toBe(1);
    const left = (await list()).links;
    expect(left).toHaveLength(2);
    expect(left.map((l) => l.title).sort()).toEqual(["A", "B"]);
  });
  it("rename 批量归并;未知 action 400", async () => {
    await add("A", "https://a.com", "ai");
    await add("B", "https://b.com", "AI");
    const res = await ORGANIZE(post({ action: "rename", pairs: [{ from: "ai", to: "AI" }] }, "/api/links/organize"));
    expect(((await res.json()) as { updated: number }).updated).toBe(1);
    const cats = (await list()).links.map((l) => l.category);
    expect(cats).toEqual(["AI", "AI"]);
    expect((await ORGANIZE(post({ action: "nope" }, "/api/links/organize"))).status).toBe(400);
  });
});
