import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { jobs } from "@/lib/db/schema";
import { parseScriptResult, sanitizeJob, upsertJobs, jobsToCsv, MAX_PAGES } from "./jobs";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); });

describe("parseScriptResult", () => {
  it("解析末尾 RESULT: 行;坏 JSON 返回 null;无标记返回 null", () => {
    const good = '启动 Chrome...\n第 1 页 30 条\nRESULT:{"jobs":[{"jobId":"a1","title":"AI 工程师"}],"search_meta":{"keyword":"AI"}}';
    expect(parseScriptResult(good)?.jobs).toHaveLength(1);
    expect(parseScriptResult(good)?.searchMeta).toEqual({ keyword: "AI" });
    expect(parseScriptResult('RESULT:{broken')).toBeNull();
    expect(parseScriptResult("没有结果行")).toBeNull();
  });
});

describe("sanitizeJob / upsertJobs", () => {
  it("缺 jobId/title 丢弃;labels 非法元素过滤;jd 截断 20k", () => {
    expect(sanitizeJob({ jobId: "", title: "x" } as never)).toBeNull();
    expect(sanitizeJob({ jobId: "a", title: "" } as never)).toBeNull();
    const j = sanitizeJob({ jobId: "a", title: "t", labels: ["Java", 3, null] as never, jd: "x".repeat(30_000) } as never)!;
    expect(j.labels).toEqual(["Java"]);
    expect(j.jd!.length).toBe(20_000);
  });
  it("同 jobId 二次导入为更新;计数正确", () => {
    const j1: Parameters<typeof upsertJobs>[1] = [{ jobId: "a", title: "旧标题", salaryDesc: "10-20K" }];
    expect(upsertJobs(db, j1, { keyword: "AI", city: "上海" })).toEqual({ inserted: 1, updated: 0 });
    expect(upsertJobs(db, [{ jobId: "a", title: "新标题" }, { jobId: "b", title: "第二条" }])).toEqual({ inserted: 1, updated: 1 });
    const rows = db.select().from(jobs).all() as (typeof jobs.$inferSelect)[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.jobId === "a")!.title).toBe("新标题");
  });
});

describe("jobsToCsv", () => {
  it("UTF-8 BOM 开头;引号转义;标签管道连接", () => {
    upsertJobs(db, [{ jobId: "a", title: '含"引号"岗位', salaryDesc: "30-60K", labels: ["Java", "AI"] }]);
    const rows = db.select().from(jobs).all() as (typeof jobs.$inferSelect)[];
    const csv = jobsToCsv(rows);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('含""引号""岗位');
    expect(csv).toContain("Java|AI");
  });
});

it("MAX_PAGES 上限 10", () => {
  expect(MAX_PAGES).toBe(10);
});
