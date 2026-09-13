// 自我进化(自愈中心):扫描全部失败记录入账 → AI 补充分析 → 自动修复(有界、可追溯)。
// 修复只允许白名单动作:重试失败步骤 / 重跑 BOSS 环境启动 / 重跑抓取;绝不自动删除或改库。
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { issues, jobsRuns, quickActionRuns, stepRuns, flowRuns, executors, flowTemplates, tasks } from "@/lib/db/schema";
import { recordIssue, type FixKind } from "./issue-store";
import { retryStep, runLlmStep } from "./runner";
import { spawnJobsScript } from "./jobs";

export const MAX_AUTO_FIX_ATTEMPTS = 2;

/** 扫描三类失败记录(任务步骤/求职雷达/快捷指令),未入账的自动建档。返回新增数。 */
export function collectIssues(db: Db): number {
  let created = 0;
  // 1) 任务流程步骤失败(带 run 上下文:任务名 + 模板步骤名)——一次载入建 Map,避免逐行 N+1 查询
  const failedSteps = db.select().from(stepRuns).where(eq(stepRuns.status, "failed")).all() as (typeof stepRuns.$inferSelect)[];
  const runMap = new Map(db.select().from(flowRuns).all().map((r) => [r.id, r]));
  const taskMap = new Map(db.select().from(tasks).all().map((t) => [t.id, t]));
  const tplMap = new Map(db.select().from(flowTemplates).all().map((t) => [t.id, t]));
  for (const s of failedSteps) {
    const run = runMap.get(s.runId);
    const task = run ? taskMap.get(run.taskId) : undefined;
    const tpl = run ? tplMap.get(run.templateId) : undefined;
    const label = `${task?.title ?? "任务"} · ${s.stepName}(${tpl?.name ?? "模板"})`;
    const r = recordIssue(db, {
      source: "step",
      sourceId: s.id,
      sourceLabel: label,
      errorText: s.error || s.output || "步骤失败(无错误详情)",
    });
    if (r.created) created++;
  }
  // 2) 求职雷达运行失败
  const failedJobs = db.select().from(jobsRuns).where(eq(jobsRuns.status, "failed")).all() as (typeof jobsRuns.$inferSelect)[];
  for (const j of failedJobs) {
    const r = recordIssue(db, {
      source: "job",
      sourceId: j.id,
      sourceLabel: `BOSS ${j.kind}`,
      errorText: j.output || "运行失败",
    });
    if (r.created) created++;
  }
  // 3) 快捷指令失败
  const failedQa = db.select().from(quickActionRuns).where(eq(quickActionRuns.status, "failed")).all() as (typeof quickActionRuns.$inferSelect)[];
  for (const q of failedQa) {
    const r = recordIssue(db, {
      source: "quick_action",
      sourceId: q.id,
      sourceLabel: `快捷指令运行`,
      errorText: q.output || `退出码 ${q.exitCode ?? "?"}`,
    });
    if (r.created) created++;
  }
  return created;
}

/** AI 补充分析:用启用执行器解读错误文本,写入 aiAnalysis(不改自动修复决策)。 */
export async function aiAnalyzeIssue(db: Db, issueId: string, executorId?: string): Promise<{ ok: boolean; analysis?: string; error?: string }> {
  const issue = db.select().from(issues).all().find((i) => i.id === issueId);
  if (!issue) return { ok: false, error: "issue 不存在" };
  const allLlm = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]) as (typeof executors.$inferSelect)[];
  const exList = allLlm.filter((e) => e.enabled && e.type === "llm");
  // 优先真实配置的模型(跳过 YOUR_* 种子占位符),避免选中必然失败的占位执行器
  const usable = exList.filter((e) => !/^YOUR_/.test(e.model ?? ""));
  const pool = usable.length > 0 ? usable : exList;
  const ex = (executorId && pool.find((e) => e.id === executorId)) ?? pool[0];
  if (!ex) return { ok: false, error: "未配置可用 AI 执行器,无法做 AI 分析(启发式诊断仍有效)" };
  const { callLlmWithRetry, executorLlmConfig } = await import("@/lib/llm/client");
  let cfg;
  try {
    cfg = executorLlmConfig(ex);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "执行器配置无效" };
  }
  const prompt = [
    "你是工作台自愈系统的分析员。下面是一次失败的记录(来源/标识/错误文本)。请输出不超过 120 字的中文分析:",
    "1) 最可能的根因;2) 建议的处理动作。不要执行任何操作,只输出分析文本。",
    `来源:${issue.source} · ${issue.sourceLabel}`,
    `错误:${issue.errorText.slice(0, 2000)}`,
  ].join("\n");
  try {
    const r = await callLlmWithRetry(cfg, [{ role: "user", content: prompt }]);
    const analysis = r.text.slice(0, 1000);
    db.update(issues).set({ aiAnalysis: analysis, updatedAt: new Date().toISOString() }).where(eq(issues.id, issueId)).run();
    return { ok: true, analysis };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `AI 调用失败:${e.message}` : "AI 调用失败" };
  }
}

export type FixOutcome = { ok: boolean; result: string };

/** 自动修复(有界:同类修复最多 MAX_AUTO_FIX_ATTEMPTS 次)。 */
export async function applyFix(db: Db, issueId: string): Promise<FixOutcome> {
  const issue = db.select().from(issues).all().find((i) => i.id === issueId);
  if (!issue) return { ok: false, result: "issue 不存在" };
  if (issue.status === "fixed") return { ok: false, result: "已修复" };
  if (issue.status === "ignored") return { ok: false, result: "已忽略" };
  const fixKind: FixKind = issue.fixKind as FixKind;
  const bump = (fixStatus: string, result: string) =>
    db.update(issues).set({ fixAttempts: issue.fixAttempts + 1, fixStatus, fixResult: result.slice(0, 500), updatedAt: new Date().toISOString() }).where(eq(issues.id, issueId)).run();

  if (fixKind === "needs_human" || fixKind === "none") {
    bump("needs_human", "该问题需要人工处理,系统不做自动动作");
    return { ok: false, result: "需要人工处理" };
  }
  if (issue.fixAttempts >= MAX_AUTO_FIX_ATTEMPTS) {
    bump("failed", `已达自动修复上限(${MAX_AUTO_FIX_ATTEMPTS} 次),转人工`);
    return { ok: false, result: "已达自动修复上限" };
  }

  // 修复动作一:重试失败的任务步骤(先 retryStep 复位,再进程内执行 LLM 步骤)
  if (fixKind === "retry_step") {
    const s = db.select().from(stepRuns).all().find((x) => x.id === issue.sourceId);
    if (!s) {
      bump("failed", "失败步骤不存在(可能已被清理)");
      return { ok: false, result: "步骤不存在" };
    }
    retryStep(db, s.runId, s.stepIndex);
    if (s.executorType !== "llm") {
      bump("pending", "已复位为待执行(script/人工步骤请到执行视图继续)");
      return { ok: true, result: "已复位待执行" };
    }
    try {
      const done = await runLlmStep(db, s.runId, s.stepIndex);
      const ok = done.status === "done";
      bump(ok ? "applied" : "failed", ok ? `步骤已自动重跑成功(model=${done.model ?? "?"})` : `自动重跑仍失败:${done.error ?? ""}`);
      return { ok, result: ok ? "自动重跑成功" : "自动重跑仍失败" };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      bump("failed", `自动重跑异常:${msg}`);
      return { ok: false, result: msg };
    }
  }

  // 修复动作二/三:BOSS 环境启动 / 重新抓取(异步进程,结果在求职雷达页跟踪)
  if (fixKind === "rerun_setup" || fixKind === "retry_job") {
    const paramsRaw = issue.source === "job" ? (db.select().from(jobsRuns).all().find((j) => j.id === issue.sourceId)?.params ?? "{}") : "{}";
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(paramsRaw) as Record<string, unknown>;
    } catch { /* 坏参数按默认 */ }
    const kind = fixKind === "rerun_setup" ? "setup" : "scrape";
    const args: string[] =
      kind === "setup"
        ? ["--setup-chrome"]
        : [
            "--keyword", String(params.keyword ?? "AI Agent"),
            ...(params.city ? ["--city", String(params.city)] : []),
            "--pages", String(params.pages ?? 1),
            ...(params.no_detail ? ["--no-detail"] : []),
          ];
    const out = spawnJobsScript({ kind, args, db, params: params as Record<string, unknown> });
    if ("error" in out) {
      bump("failed", `无法自动重启:${out.error}`);
      return { ok: false, result: out.error };
    }
    bump("pending", `已自动重启 ${kind} 运行(结果见求职雷达页)`);
    return { ok: true, result: "已自动重启运行" };
  }

  bump("not_fixable", "无可自动修复动作");
  return { ok: false, result: "无可自动修复动作" };
}

/** 列表(新→旧)+ 统计 */
export function listIssues(db: Db) {
  const rows = db.select().from(issues).orderBy(desc(issues.updatedAt)).all();
  const stats = {
    total: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    fixed: rows.filter((r) => r.status === "fixed").length,
    needsHuman: rows.filter((r) => r.fixStatus === "needs_human" && r.status === "open").length,
    pendingFix: rows.filter((r) => r.status === "open" && ["retry_step", "rerun_setup", "retry_job"].includes(r.fixKind) && r.fixStatus !== "applied").length,
  };
  return { rows, stats };
}
