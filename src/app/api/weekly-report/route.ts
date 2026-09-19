import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { executors, notes } from "@/lib/db/schema";
import { readSettingsKv } from "@/lib/db/read-settings";
import { buildStats } from "@/lib/domain/stats";
import { callLlmWithRetry, executorLlmConfig } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickExecutor(db: ReturnType<typeof getDb>) {
  const list = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.enabled && e.type === "llm");
  const usable = list.filter((e) => !/^YOUR_/.test(e.model ?? ""));
  const pool = usable.length > 0 ? usable : list;
  return pool.find((e) => e.role === "executor") ?? pool.find((e) => e.role === "planner") ?? pool[0] ?? null;
}

// 周报生成:POST {} → 汇总本周 stats → AI 图文周报(markdown)→ 存为笔记(source='manual',标题带日期)
export async function POST(req: NextRequest) {
  const db = getDb();
  const kv = readSettingsKv(db);
  const tz = typeof kv.timezone === "string" ? kv.timezone : "";
  const stats = buildStats(db, new Date(), tz);

  const ex = pickExecutor(db);
  if (!ex) return NextResponse.json({ error: "未配置可用 AI 执行器" }, { status: 400 });

  const facts = [
    `本周完成率 ${stats.week.completionRate == null ? "无截止任务" : Math.round(stats.week.completionRate * 100) + "%"}(口径:完成/(完成+本周截止未完成))`,
    `每日完成:${stats.week.dailyDone.map((d) => `${d.date.slice(5)} ${d.count} 项`).join(",")}`,
    `本周新增:任务 ${stats.week.newTasks} 条,灵感笔记 ${stats.week.newNotes} 条`,
    `近 14 天完成 ${stats.completions.reduce((a, c) => a + c.count, 0)} 项,近 14 天成本 ${stats.costs.reduce((a, c) => a + c.cost, 0).toFixed(4)}`,
  ].join("\n");

  let report: string;
  try {
    const cfg = executorLlmConfig(ex);
    const r = await callLlmWithRetry(cfg, [{
      role: "user",
      content: [
        "你是个人工作台的周报助手。根据本周数据生成一份 markdown 周报,结构:",
        "## 本周概览(2-3 句总括)\\n## 亮点(做得好的)\\n## 待改进(逾期/低完成率归因)\\n## 下周建议(可执行 2-3 条)",
        "数据要引用给定的数字;语气客观鼓励;只输出 markdown 正文。",
        facts,
      ].join("\n"),
    }]);
    report = r.text;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `AI 生成失败:${e.message}` : "AI 生成失败" }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const title = `Weekly Review ${nowIso.slice(0, 10)}`;
  db.insert(notes).values({
    id: crypto.randomUUID(), title, body: report, tags: JSON.stringify(["周报"]),
    pinned: false, source: "manual", createdAt: nowIso, updatedAt: nowIso,
  }).run();
  return NextResponse.json({ ok: true, title, report });
}
