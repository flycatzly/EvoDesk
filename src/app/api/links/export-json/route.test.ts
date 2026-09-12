import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { POST } from "../route";
import { GET as EXPORT_JSON } from "./route";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); __setDbForTests(db); });
const post = (body: unknown) => new NextRequest("http://localhost/api/links", { method: "POST", body: JSON.stringify(body) });

describe("links export-json", () => {
  it("按目录分组导出(attachment),含计数与排序", async () => {
    await POST(post({ title: "B2", url: "https://b.com/2", category: "学习", sort: 1 }));
    await POST(post({ title: "B1", url: "https://b.com/1", category: "学习", sort: 0 }));
    await POST(post({ title: "A", url: "https://a.com", category: "开发" }));
    const res = await EXPORT_JSON();
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
    const file = (await res.json()) as { total: number; groups: { category: string; count: number; links: { title: string }[] }[] };
    expect(file.total).toBe(3);
    const study = file.groups.find((g) => g.category === "学习")!;
    expect(study.count).toBe(2);
    expect(study.links.map((l) => l.title)).toEqual(["B1", "B2"]); // 组内按 sort 升序
    expect(file.groups[0].category).toBe("学习"); // 分组按排序后首条出现序(B1 sort=0 最早)
  });
});
