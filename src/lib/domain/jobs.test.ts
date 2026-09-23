import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { jobs, settings as settingsTable } from "@/lib/db/schema";
import { parseScriptResult, sanitizeJob, upsertJobs, jobsToCsv, MAX_PAGES } from "./jobs";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); });

describe("parseScriptResult", () => {
  it("解析末尾 RESULT: 行;坏 JSON 返回 null;无标记返回 null", async () => {
    const good = '启动 Chrome...\n第 1 页 30 条\nRESULT:{"jobs":[{"jobId":"a1","title":"AI 工程师"}],"search_meta":{"keyword":"AI"}}';
    expect(parseScriptResult(good)?.jobs).toHaveLength(1);
    expect(parseScriptResult(good)?.searchMeta).toEqual({ keyword: "AI" });
    expect(parseScriptResult('RESULT:{broken')).toBeNull();
    expect(parseScriptResult("没有结果行")).toBeNull();
  });
});

describe("sanitizeJob / upsertJobs", () => {
  it("缺 jobId/title 丢弃;labels 非法元素过滤;jd 截断 20k", async () => {
    expect(sanitizeJob({ jobId: "", title: "x" } as never)).toBeNull();
    expect(sanitizeJob({ jobId: "a", title: "" } as never)).toBeNull();
    const j = sanitizeJob({ jobId: "a", title: "t", labels: ["Java", 3, null] as never, jd: "x".repeat(30_000) } as never)!;
    expect(j.labels).toEqual(["Java"]);
    expect(j.jd!.length).toBe(20_000);
  });
  it("同 jobId 二次导入为更新;计数正确", async () => {
    const j1: Parameters<typeof upsertJobs>[1] = [{ jobId: "a", title: "旧标题", salaryDesc: "10-20K" }];
    expect(upsertJobs(db, j1, { keyword: "AI", city: "上海" })).toEqual({ inserted: 1, updated: 0 });
    expect(upsertJobs(db, [{ jobId: "a", title: "新标题" }, { jobId: "b", title: "第二条" }])).toEqual({ inserted: 1, updated: 1 });
    const rows = db.select().from(jobs).all() as (typeof jobs.$inferSelect)[];
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.jobId === "a")!.title).toBe("新标题");
  });
});

describe("jobsToCsv", () => {
  it("UTF-8 BOM 开头;引号转义;标签管道连接", async () => {
    upsertJobs(db, [{ jobId: "a", title: '含"引号"岗位', salaryDesc: "30-60K", labels: ["Java", "AI"] }]);
    const rows = db.select().from(jobs).all() as (typeof jobs.$inferSelect)[];
    const csv = jobsToCsv(rows);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain('含""引号""岗位');
    expect(csv).toContain("Java|AI");
  });
});

it("MAX_PAGES 上限 10", async () => {
  expect(MAX_PAGES).toBe(10);
});

describe("await spawnJobsScript(真实进程集成)", () => {
  it("含空格的参数作为单个 argv 到达脚本(回归:shell 拼接把 'AI Agent' 拆成两个参数)", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const pathMod = await import("node:path");
    const { spawnJobsScript, currentRun } = await import("./jobs");
    // 用 node 本身当"解释器",脚本回显收到的空格参数,证明其未被拆分
    const dir = fs.mkdtempSync(pathMod.join(os.tmpdir(), "jobs-spawn-"));
    const script = pathMod.join(dir, "echo-argv.cjs");
    fs.writeFileSync(script, 'console.log("KW=" + JSON.stringify(process.argv[3]));\n');
    db.insert(settingsTable).values({ key: "boss_python_cmd", value: JSON.stringify(process.execPath) }).onConflictDoUpdate({ target: settingsTable.key, set: { value: JSON.stringify(process.execPath) } }).run();
    const out = await spawnJobsScript({ kind: "check", args: ["--keyword", "AI Agent", "--city", "上海"], db, scriptPath: script });
    expect("error" in out).toBe(false);
    // 等待进程退出落库(轮询,最长 5s)
    for (let i = 0; i < 50; i++) {
      if (!currentRun()) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const run = (db.select().from((await import("@/lib/db/schema")).jobsRuns).all() as { status: string; output: string }[])[0];
    expect(run.status).toBe("ok");
    expect(run.output).toContain('KW="AI Agent"');
  });
});
