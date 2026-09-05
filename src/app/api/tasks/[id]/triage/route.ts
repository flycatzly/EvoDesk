import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks, executors, settings, flowTemplates } from "@/lib/db/schema";
import { executorLlmConfig } from "@/lib/llm/client";
import { triageTask } from "@/lib/domain/triage";
import { routeTemplate } from "@/lib/domain/router";
import { toApiTask } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 分诊流水线(设计 §7):LLM 分诊(失败即降级)→ routeTemplate 打分匹配 → 持久化 tags/complexity/flowTemplateId(status→triaging)。
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const knownTags = JSON.parse((db.select().from(settings).where(eq(settings.key, "known_tags")).all()[0] ?? { value: "[]" }).value) as string[];
  // 分诊用 LLM:优先 triage 角色,退回 executor 角色;配置残缺(缺 model/apiBase)也降级,不让端点 500
  const triageEx = (db.select().from(executors).all() as (typeof executors.$inferSelect)[])
    .find((e) => e.type === "llm" && e.enabled && (e.role === "triage" || e.role === "executor"));
  let cfg = null;
  try {
    cfg = triageEx ? executorLlmConfig(triageEx) : null;
  } catch (err) {
    console.warn("[triage] executorLlmConfig 解析失败,降级为无模型:", err);
    cfg = null;
  }

  const { result, degraded } = await triageTask(
    { title: task.title, description: task.description },
    knownTags, cfg,
  );

  // 固定排序保证同分并列时结果确定(依赖调用方排序是隐式契约,显式化之)
  const templates = db.select().from(flowTemplates).orderBy(flowTemplates.name, flowTemplates.id).all() as unknown as Parameters<typeof routeTemplate>[0];
  const matched = routeTemplate(templates, result.tags, result.complexity);

  const nowIso = new Date().toISOString();
  db.update(tasks).set({
    tags: JSON.stringify(result.tags),
    complexity: result.complexity,
    // 已绑定模板不被自动路由覆盖(人工选择优先);未绑定才落匹配结果
    flowTemplateId: task.flowTemplateId ?? matched?.id ?? null,
    status: "triaging",
    updatedAt: nowIso,
  }).where(eq(tasks.id, id)).run();

  const updated = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
  return NextResponse.json({ task: toApiTask(updated), suggestion: result, degraded, matched_template_id: matched?.id ?? null });
}
