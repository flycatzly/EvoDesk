import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { issues } from "@/lib/db/schema";
import { collectIssues, applyFix, listIssues, aiAnalyzeIssue, deleteIssues } from "@/lib/domain/self-heal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 自我进化(自愈中心):
//   GET                → issue 列表 + 统计
//   POST {action}:
//     scan             → 扫描三类失败记录自动建档(jobs/step/quick_action)
//     fix {id?}        → 自动修复单个(有界)或全部可自动修复项
//     analyze {id?}    → AI 补充分析单个或全部未分析的 open issue
//     ignore {id}      → 标记忽略
export async function GET() {
  const db = await getAnyDb();
  const { rows, stats } = listIssues(db);
  return NextResponse.json({ issues: rows, stats });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const action = body && typeof body.action === "string" ? body.action : "";
  const db = await getAnyDb();

  if (action === "scan") {
    const created = collectIssues(db);
    return NextResponse.json({ ok: true, created });
  }

  if (action === "fix") {
    // force=人工点按钮显式触发,不受自动修复上限约束
    const force = body?.force === true;
    if (typeof body?.id === "string") {
      const out = await applyFix(db, body.id, { force });
      return NextResponse.json(out, { status: out.ok ? 200 : 409 });
    }
    // 一键修复全部 pending 且可自动修复的(有界)
    const { rows } = listIssues(db);
    const targets = rows.filter((r) => r.status === "open" && ["retry_step", "rerun_setup", "retry_job"].includes(r.fixKind) && r.fixStatus !== "applied").slice(0, 10);
    const results: { id: string; ok: boolean; result: string }[] = [];
    for (const t of targets) {
      const out = await applyFix(db, t.id, { force });
      results.push({ id: t.id, ok: out.ok, result: out.result });
    }
    const okCount = results.filter((r) => r.ok).length;
    return NextResponse.json({ ok: true, fixed: okCount, total: results.length, results });
  }

  if (action === "analyze") {
    const ids: string[] =
      typeof body?.id === "string"
        ? [body.id]
        : listIssues(db).rows.filter((r) => r.status === "open" && !r.aiAnalysis).slice(0, 5).map((r) => r.id);
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      const out = await aiAnalyzeIssue(db, id);
      results.push({ id, ok: out.ok, error: out.error });
    }
    const okCount = results.filter((r) => r.ok).length;
    if (ids.length > 0 && okCount === 0) {
      const firstError = results[0]?.error ?? "分析失败";
      return NextResponse.json({ ok: false, error: firstError, results }, { status: 409 });
    }
    return NextResponse.json({ ok: true, analyzed: okCount, results });
  }

  if (action === "ignore") {
    if (typeof body?.id !== "string") return NextResponse.json({ error: "id 必填" }, { status: 400 });
    db.update(issues).set({ status: "ignored", updatedAt: new Date().toISOString() }).where(eq(issues.id, body.id)).run();
    return NextResponse.json({ ok: true });
  }

  if (action === "delete") {
    const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === "string") : [];
    if (ids.length === 0) return NextResponse.json({ error: "ids 必填(非空字符串数组)" }, { status: 400 });
    const deleted = await deleteIssues(db, ids);
    return NextResponse.json({ ok: true, deleted });
  }

  return NextResponse.json({ error: "未知 action(scan|fix|analyze|ignore|delete)" }, { status: 400 });
}
