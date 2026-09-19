import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";
import { callLlmWithRetry, executorLlmConfig } from "@/lib/llm/client";
import { collectWidgetData } from "@/lib/domain/canvas-data";
import { listIssues } from "@/lib/domain/self-heal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AI 日报:汇总任务/笔记/自愈数据 → LLM 生成今日简报(纯只读,不写库)。
// GET 返回汇总原料(前端可显示生成时间);POST 返回 AI 文本。
export async function GET(_req: NextRequest) {
  const db = getDb();
  const kv = (await import("@/lib/db/read-settings")).readSettingsKv(db);
  const tz = typeof kv.timezone === "string" ? kv.timezone : "";
  const data = collectWidgetData(db, ["counters", "todo", "calendar", "radar"], tz);
  const { stats } = listIssues(db);
  return NextResponse.json({
    counters: data.counters,
    todo: data.todo?.tasks.slice(0, 8),
    radar: data.radar?.items,
    selfHeal: stats,
    notes: data.counters?.notes ?? 0,
  });
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const kv = (await import("@/lib/db/read-settings")).readSettingsKv(db);
  const tz = typeof kv.timezone === "string" ? kv.timezone : "";
  const data = collectWidgetData(db, ["counters", "todo", "calendar", "radar"], tz);
  const { stats } = listIssues(db);

  const enabledLlm = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.enabled && e.type === "llm");
  const usable = enabledLlm.filter((e) => !/^YOUR_/.test(e.model ?? ""));
  const pool = usable.length > 0 ? usable : enabledLlm;
  const requested = body && typeof body.executor_id === "string" ? pool.find((e) => e.id === body.executor_id) : undefined;
  const ex = requested ?? pool.find((e) => e.role === "executor") ?? pool.find((e) => e.role === "planner") ?? pool[0];
  if (!ex) return NextResponse.json({ error: "未配置可用 AI 执行器" }, { status: 400 });

  const c = data.counters;
  const facts = [
    `今日待办 ${c?.today ?? 0} 项(逾期 ${c?.overdue ?? 0}),执行中 ${c?.running ?? 0},待人工 ${c?.waitingHuman ?? 0},收件箱 ${c?.inbox ?? 0},灵感笔记 ${c?.notes ?? 0} 条`,
    `今日清单:${(data.todo?.tasks ?? []).map((t) => `${t.title}(${t.overdue ? "逾期" : t.status === "done" ? "已完成" : "进行中"})`).join("、") || "空"}`,
    `风险雷达:${(data.radar?.items ?? []).map((r) => r.label).join("、") || "一切正常"}`,
    `自愈:累计 ${stats.total} 个失败(待处理 ${stats.open},需人工 ${stats.needsHuman},已修复 ${stats.fixed})`,
  ].join("\n");

  try {
    const cfg = executorLlmConfig(ex);
    const r = await callLlmWithRetry(cfg, [{
      role: "user",
      content: [
        "你是个人工作台的晨报助手。根据下面的实时数据,写一段 120 字以内的中文今日简报:",
        "1) 先用一句话总括今天最重要的任务;2) 点出逾期/风险;3) 给一条可执行建议。语气轻快直接,不要列表符号,输出纯文本。",
        facts,
      ].join("\n"),
    }]);
    return NextResponse.json({ ok: true, brief: r.text, model: r.model });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "AI 生成失败" }, { status: 502 });
  }
}
