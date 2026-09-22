import { describe, it, expect, beforeEach, vi } from "vitest";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { __setDbForTests } from "@/lib/db/client";
import { diagnose, recordIssue } from "./issue-store";
import { collectIssues, applyFix, listIssues, deleteIssues } from "./self-heal";
import { flowRuns, flowTemplates, stepRuns, jobsRuns, tasks, executors, issues } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { startRun } from "./runner";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
});

describe("diagnose 启发式", () => {
  it("已知错误模式 → 诊断与修复类别", () => {
    expect(diagnose("无可用的 reviewer 执行器,可在执行器页启用或改用人工填写").fixKind).toBe("retry_step");
    expect(diagnose("! 等待登录超时(10 分钟)").fixKind).toBe("needs_human");
    // CDP 未就绪:scrape 已自带自动拉起浏览器,job 来源重跑抓取即可自愈
    expect(diagnose("Chrome CDP 不可用:先执行 --setup-chrome").fixKind).toBe("retry_job");
    expect(diagnose("TypeError: fetch failed").fixKind).toBe("retry_step");
    expect(diagnose("request failed with status 401").fixKind).toBe("needs_human");
    expect(diagnose("莫名其妙的新错误").fixKind).toBe("none");
  });
  it("来源感知:同一超时文本,job 来源重跑抓取,step 来源重试步骤(回归:2026-09-23 分类错配致修复无反应)", () => {
    expect(diagnose("运行超时(30 分钟)", "job").fixKind).toBe("retry_job");
    expect(diagnose("运行超时(30 分钟)", "step").fixKind).toBe("retry_step");
    expect(diagnose("连接被拒", "job").fixKind).toBe("retry_job");
  });
});

describe("collectIssues 幂等入账", () => {
  it("扫描失败记录入账(ok 不入);重复扫描幂等", () => {
    const now = new Date().toISOString();
    db.insert(jobsRuns).values({ id: "job1", kind: "setup", params: "{}", status: "failed", output: "等待登录超时", jobCount: 0, startedAt: now, finishedAt: now }).run();
    db.insert(jobsRuns).values({ id: "job2", kind: "check", params: "{}", status: "ok", output: "fine", jobCount: 0, startedAt: now, finishedAt: now }).run();
    expect(collectIssues(db)).toBe(1);
    expect(collectIssues(db)).toBe(0);
    const { rows, stats } = listIssues(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].fixKind).toBe("needs_human");
    expect(stats.open).toBe(1);
  });
  it("recordIssue 对同一 sourceId 只保留一条并刷新错误文本", () => {
    recordIssue(db, { source: "quick_action", sourceId: "qa1", sourceLabel: "x", errorText: "第一次错误" });
    recordIssue(db, { source: "quick_action", sourceId: "qa1", sourceLabel: "x", errorText: "第二次错误" });
    const rows = listIssues(db).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].errorText).toBe("第二次错误");
  });
});

describe("applyFix 自动修复(有界)", () => {
  it("retry_step:失败的自检步骤自动复位并重跑成功(mock LLM)", async () => {
    // 任务 + 就绪 + 绑定 M 标准流程(种子任务可能未绑模板,此处显式绑定)
    const task = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "ready")!;
    const tpl = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.steps.includes("自检"))!;
    db.update(tasks).set({ flowTemplateId: tpl.id }).where(eq(tasks.id, task.id)).run();
    const runId = (await startRun(db, task.id)).runId;
    // 步骤 0/1 置 done,步骤 2(自检)置失败 → 触发入账
    const allSteps = await db.select().from(stepRuns).where(eq(stepRuns.runId, runId)) as unknown as (typeof stepRuns.$inferSelect)[];
    const selfCheck = allSteps.find((s) => s.stepName === "自检")!;
    // 自检之前的全部置 done,使自检成为"当前步"
    for (const st of allSteps) {
      if (st.stepIndex < selfCheck.stepIndex) {
        await db.update(stepRuns).set({ status: "done", finishedAt: nowIso() }).where(eq(stepRuns.id, st.id));
      }
    }
    // 同样需要 flowRuns.status = running(applyFix 的 runLlmStep 要求)
    // 已在外部设置
    await db.update(stepRuns).set({ status: "failed", error: "无可用的 reviewer 执行器,可在执行器页启用或改用人工填写" }).where(eq(stepRuns.id, selfCheck.id));
    db.update(flowRuns).set({ status: "running" }).where(eq(flowRuns.id, runId)).run();
    collectIssues(db);
    const issue = listIssues(db).rows.find((r) => r.sourceId === selfCheck.id)!;
    expect(issue.fixKind).toBe("retry_step");
    // 启用一个 LLM 执行器 + mock 其 HTTP 调用
    db.update(executors).set({ enabled: true }).where(eq(executors.name, "快速模型")).run();
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "自检通过:产出完整可用" } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 }, model: "m",
    }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    try {
      const out = await applyFix(db, issue.id);
      expect(out.ok).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
    const after = db.select().from(issues).all().find((i) => i.id === issue.id)!;
    expect(after.fixStatus).toBe("applied");
    const step = db.select().from(stepRuns).all().find((s) => s.id === selfCheck.id)!;
    expect(step.status).toBe("done");
  });
  it("needs_human 不做自动动作", async () => {
    const now = new Date().toISOString();
    db.insert(jobsRuns).values({ id: "j1", kind: "setup", params: "{}", status: "failed", output: "等待登录超时", jobCount: 0, startedAt: now, finishedAt: now }).run();
    collectIssues(db);
    const issue = listIssues(db).rows[0];
    const out = await applyFix(db, issue.id);
    expect(out.ok).toBe(false);
    expect(listIssues(db).rows[0].fixStatus).toBe("needs_human");
  });
  it("修复上限:2 次后转人工", async () => {
    const now = new Date().toISOString();
    db.insert(jobsRuns).values({ id: "j2", kind: "check", params: "{}", status: "failed", output: "CDP 端口 60 秒未就绪", jobCount: 0, startedAt: now, finishedAt: now }).run();
    collectIssues(db);
    const issue = listIssues(db).rows[0];
    db.update(issues).set({ fixAttempts: 2 }).where(eq(issues.id, issue.id)).run();
    const out = await applyFix(db, issue.id);
    expect(out.ok).toBe(false);
    expect(out.result).toContain("上限");
  });
});

function nowIso(): string {
  return new Date().toISOString();
}

describe("deleteIssues 批量删除(2026-09-23 多选清理)", () => {
  it("按 id 批量删除,返回删除数;空数组返回 0", async () => {
    const n1 = recordIssue(db, { source: "step", sourceId: "del-1", sourceLabel: "A", errorText: "x" });
    const n2 = recordIssue(db, { source: "step", sourceId: "del-2", sourceLabel: "B", errorText: "y" });
    expect(await deleteIssues(db, [])).toBe(0);
    const deleted = await deleteIssues(db, [n1.id, n2.id, "不存在的 id"]);
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect((db.select().from(issues).all() as unknown[]).some((r) => (r as { id: string }).id === n1.id)).toBe(false);
  });
});

describe("diagnose 风控/XHR 拦截(2026-09-23 BOSS 页面内请求失败)", () => {
  it("页面内 XHR 失败判为需人工(登录态/风控),而非可重试", () => {
    expect(diagnose("RuntimeError: 页面内请求失败:NetworkError: Failed to execute 'send' on 'XMLHttpRequest'").fixKind).toBe("needs_human");
  });
});
