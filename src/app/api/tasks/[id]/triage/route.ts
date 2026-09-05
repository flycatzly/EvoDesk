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
  // 分诊只属于前置环节:running 之后的状态不允许被外部调用拉回(triaging→triaging 保留,确认卡片可重分诊)
  if (!["inbox", "triaging", "ready"].includes(task.status)) {
    return NextResponse.json({ error: "当前状态不可分诊" }, { status: 409 });
  }

  // known_tags 仅用于提示词:解析损坏时不 500,降级为空列表;
  // 序列化契约(同 toApiTask):JSON 合法但非数组(null/123 等)也归一为 [],否则 join 崩溃导致无谓降级
  let knownTags: string[] = [];
  try {
    const parsed: unknown = JSON.parse((db.select().from(settings).where(eq(settings.key, "known_tags")).all()[0] ?? { value: "[]" }).value);
    knownTags = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[triage] known_tags 解析失败,按空列表处理:", err);
  }

  // 分诊用快模型(设计 §7.2):优先 triage 角色,缺位再退回 executor;配置残缺(缺 model/apiBase)也降级,不让端点 500
  const llmEnabled = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.type === "llm" && e.enabled);
  const triageEx = llmEnabled.find((e) => e.role === "triage") ?? llmEnabled.find((e) => e.role === "executor");
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
  const templates = db.select().from(flowTemplates).orderBy(flowTemplates.name, flowTemplates.id).all();
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
