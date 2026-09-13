// Issue 记录与启发式诊断(独立模块:runner/jobs/quick-actions 失败钩子与本模块互不循环依赖)。
// 记录失败 → 匹配已知错误模式给出诊断与修复类别;自动修复的"执行"在 self-heal.ts(有界、留痕)。
import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { issues } from "@/lib/db/schema";

export type IssueSource = "job" | "step" | "quick_action";
export type FixKind = "retry_step" | "rerun_setup" | "retry_job" | "needs_human" | "none";
export type Diagnosis = { cause: string; fixKind: FixKind };

/** 已知错误模式 → 诊断(按序首中即止);默认 needs_human 等待 AI/人工 */
export function diagnose(errorText: string): Diagnosis {
  const t = errorText.slice(0, 4000);
  if (/无可用的\s*\S*\s*执行器/.test(t)) {
    return { cause: "步骤绑定的执行器角色缺失(已支持回退到任意启用 LLM),重试即可走通", fixKind: "retry_step" };
  }
  if (/等待登录超时|登录态|wt2|扫码|未登录/.test(t)) {
    return { cause: "BOSS直聘登录态缺失或失效:在专用 Chrome 窗口完成登录后重试", fixKind: "needs_human" };
  }
  if (/CDP 端口.*未就绪|Chrome CDP 不可用|DevTools 不可用/i.test(t)) {
    return { cause: "Chrome 调试端口未就绪:重新执行「启动 Chrome」建立隔离实例", fixKind: "rerun_setup" };
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|网络异常|Connection .* (refused|reset)|socket hang up/i.test(t)) {
    return { cause: "网络瞬时故障(连接被拒/超时/DNS),重试通常可恢复", fixKind: "retry_step" };
  }
  if (/timed? ?out|超时/i.test(t)) {
    return { cause: "执行超时(模型或目标站点响应慢),重试一次", fixKind: "retry_step" };
  }
  if (/\b401\b|\b403\b|api[_ ]?key|鉴权|未授权|invalid[_ ]api/i.test(t)) {
    return { cause: "密钥缺失或鉴权失败:到执行器/供应商档案页核对 API Key", fixKind: "needs_human" };
  }
  if (/命令不是内部或外部命令|is not recognized|command not found/i.test(t)) {
    return { cause: "命令不存在:核对快捷指令/脚本步骤中的命令拼写与环境", fixKind: "needs_human" };
  }
  return { cause: "未知错误:等待 AI 分析或人工排查", fixKind: "none" };
}

export type NewIssue = {
  source: IssueSource;
  sourceId: string;
  sourceLabel?: string;
  errorText: string;
};

/** 记录失败(按 source+sourceId 幂等):新失败插入并诊断;已存在则刷新错误文本。 */
export function recordIssue(db: Db, issue: NewIssue): { id: string; created: boolean } {
  const existing = db
    .select()
    .from(issues)
    .where(and(eq(issues.source, issue.source), eq(issues.sourceId, issue.sourceId)))
    .all()[0];
  const nowIso = new Date().toISOString();
  if (existing) {
    if (existing.status === "fixed") return { id: existing.id, created: false };
    db.update(issues)
      .set({ errorText: issue.errorText.slice(0, 4000), updatedAt: nowIso })
      .where(eq(issues.id, existing.id))
      .run();
    return { id: existing.id, created: false };
  }
  const d = diagnose(issue.errorText);
  const id = crypto.randomUUID();
  db.insert(issues)
    .values({
      id,
      source: issue.source,
      sourceId: issue.sourceId,
      sourceLabel: (issue.sourceLabel ?? "").slice(0, 200),
      errorText: issue.errorText.slice(0, 4000),
      status: "open",
      cause: d.cause,
      fixKind: d.fixKind,
      fixStatus: d.fixKind === "needs_human" ? "needs_human" : d.fixKind === "none" ? "not_fixable" : "pending",
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .run();
  return { id, created: true };
}
