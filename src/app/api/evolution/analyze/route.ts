import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { flowRuns, flowTemplates, executors, evolutionEvents } from "@/lib/db/schema";
import { collectHotspots, applyVariant, canAnalyze, type VariantOp } from "@/lib/domain/evolution";
import type { StepDef } from "@/lib/domain/step-def";
import { executorLlmConfig, callLlmWithRetry } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AnalysisSchema = z.object({
  diagnosis: z.string(),
  variants: z.array(z.object({
    name: z.string().min(1),
    changes: z.array(z.record(z.string(), z.unknown())),
    rationale: z.string(),
  })).max(3),
  retire_suggestions: z.array(z.object({ template_id: z.string(), reason: z.string() })),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const templateId = typeof body?.template_id === "string" ? body.template_id : null;
  if (!templateId) return NextResponse.json({ error: "template_id 必填" }, { status: 400 });
  const db = getDb();
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, templateId)).all()[0];
  if (!tpl) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  const force = body?.force === true;
  if (!force && !canAnalyze(db, templateId)) {
    return NextResponse.json({ error: "自上次复盘后完成次数未达阈值(可在 body 传 force:true 跳过)" }, { status: 409 });
  }
  const ex = (db.select().from(executors).all() as (typeof executors.$inferSelect)[])
    .find((e) => e.type === "llm" && e.enabled && (e.role === "evolution" || e.role === "planner"));
  if (!ex) return NextResponse.json({ error: "无可用的复盘执行器(启用 evolution/planner 角色模型)" }, { status: 409 });
  let cfg;
  try {
    cfg = executorLlmConfig(ex);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 409 });
  }

  const runs = db.select().from(flowRuns).where(eq(flowRuns.templateId, templateId)).all() as (typeof flowRuns.$inferSelect)[];
  const recentBad = runs.filter((r) => (r.satisfaction ?? 5) <= 2).slice(0, 3)
    .map((r) => ({ title: r.id, satisfaction: r.satisfaction, note: r.outcomeNote }));
  const prompt = [
    `你是流程进化引擎。基于以下数据为流程「${tpl.name}」提出改进变体(最多 3 个)。`,
    `当前步骤定义:${tpl.steps}`,
    `聚合统计:run=${runs.length}, done=${runs.filter((r) => r.status === "done").length}, avgCost=${tpl.statAvgCostUsd}, avgDuration=${tpl.statAvgDurationMs}, avgSatisfaction=${tpl.statAvgSatisfaction}`,
    `步骤热点:${JSON.stringify(collectHotspots(db, templateId))}`,
    `最近不满意的运行:${JSON.stringify(recentBad)}`,
    `只输出 JSON:{"diagnosis":"…","variants":[{"name":"…","changes":[…ops…],"rationale":"…"}],"retire_suggestions":[]}`,
    `可用 ops:remove_step{index}/add_step{after_index,step}/replace_executor_role{index,executor_role}/edit_prompt{index,prompt}/reorder{from,to}`,
  ].join("\n");

  const started = Date.now();
  try {
    const out = await callLlmWithRetry(cfg, [{ role: "user", content: prompt }]);
    const parsed = AnalysisSchema.safeParse(safeJson(out.text));
    // detail 列是 TEXT:必须显式 stringify,直接存对象会抛错或落成 "[object Object]"
    db.insert(evolutionEvents).values({
      id: crypto.randomUUID(), ts: new Date().toISOString(), kind: "analysis_run", templateId, relatedTemplateId: null,
      reason: parsed.success ? parsed.data.diagnosis.slice(0, 500) : "输出解析失败",
      detail: JSON.stringify({ degraded: !parsed.success, durationMs: Date.now() - started }),
    }).run();
    if (!parsed.success) return NextResponse.json({ error: "复盘输出无法解析,已记录事件", degraded: true }, { status: 502 });
    const baseSteps = JSON.parse(tpl.steps) as StepDef[];
    const created: string[] = [];
    for (const v of parsed.data.variants) {
      try {
        const steps = applyVariant(baseSteps, v.changes as unknown as VariantOp[]);
        const id = crypto.randomUUID();
        db.insert(flowTemplates).values({
          id, name: v.name.slice(0, 50), description: v.rationale.slice(0, 200), tags: tpl.tags, complexity: tpl.complexity,
          version: tpl.version + 1, lineageId: tpl.lineageId, parentId: tpl.id, origin: "evolution", status: "experimental",
          steps: JSON.stringify(steps), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }).run();
        db.insert(evolutionEvents).values({
          id: crypto.randomUUID(), ts: new Date().toISOString(), kind: "variant_created", templateId: tpl.id, relatedTemplateId: id,
          reason: v.rationale.slice(0, 500), detail: JSON.stringify({ changes: v.changes }),
        }).run();
        created.push(id);
      } catch { /* 单个变体 ops 非法 → 放弃该变体,继续 */ }
    }
    for (const r of parsed.data.retire_suggestions) {
      db.insert(evolutionEvents).values({
        id: crypto.randomUUID(), ts: new Date().toISOString(), kind: "analysis_run", templateId: r.template_id, relatedTemplateId: null,
        reason: `退役建议:${r.reason.slice(0, 200)}`, detail: JSON.stringify({}),
      }).run();
    }
    // created 与 variants 指向同一数组:计划契约用 created,测试/UI 契约用 variants
    return NextResponse.json({ diagnosis: parsed.data.diagnosis, created, variants: created, retire_suggestions: parsed.data.retire_suggestions });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 502 });
  }
}

function safeJson(text: string): unknown {
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}
