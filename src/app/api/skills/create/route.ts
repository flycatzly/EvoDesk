import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";
import { callLlmWithRetry, executorLlmConfig } from "@/lib/llm/client";
import { skillCreateSystemPrompt, SKILL_CREATE_MAX_ROUNDS, extractSkillMd } from "@/lib/domain/skill-create";
import type { LlmMessage } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Turn = { role: "user" | "assistant"; content: string };

// AI 辅助创建技能(POST {messages, executor_id?}):逐轮追问,最终回复含完整 SKILL.md。
// 非流式单次调用;轮次由客户端按 assistant 回复数推进,服务端只做上限与结构校验。
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const turns = Array.isArray(body?.messages) ? (body!.messages as unknown[]) : null;
  if (!turns || turns.length === 0 || turns.length > 2 * SKILL_CREATE_MAX_ROUNDS + 2) {
    return NextResponse.json({ error: "messages 缺失或超长" }, { status: 400 });
  }
  const clean: Turn[] = [];
  for (const t of turns) {
    const o = t as Record<string, unknown>;
    if (!o || typeof o.content !== "string" || !o.content.trim()) continue;
    if (o.role !== "user" && o.role !== "assistant") continue;
    clean.push({ role: o.role, content: o.content.slice(0, 16_000) });
  }
  if (clean.length === 0 || clean[clean.length - 1].role !== "user") {
    return NextResponse.json({ error: "最后一条须为用户消息" }, { status: 400 });
  }
  const roundsUsed = clean.filter((m) => m.role === "assistant").length;
  if (roundsUsed > SKILL_CREATE_MAX_ROUNDS) {
    return NextResponse.json({ error: "超出最大轮次" }, { status: 400 });
  }

  const db = getDb();
  const enabledLlm = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.enabled && e.type === "llm");
  const requested = typeof body?.executor_id === "string" ? enabledLlm.find((e) => e.id === body!.executor_id) : undefined;
  const ex = requested ?? enabledLlm.find((e) => e.role === "executor") ?? enabledLlm[0];
  if (!ex) {
    return NextResponse.json({ error: "未配置可用的 AI 执行器:请到「执行器」页导入供应商档案并派生执行器" }, { status: 400 });
  }
  let cfg;
  try {
    cfg = executorLlmConfig(ex);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "执行器配置无效" }, { status: 400 });
  }

  const messages: LlmMessage[] = [{ role: "system", content: skillCreateSystemPrompt(roundsUsed) }, ...clean];
  try {
    const result = await callLlmWithRetry(cfg, messages);
    return NextResponse.json({
      reply: result.text,
      final: extractSkillMd(result.text),
      rounds: roundsUsed + 1,
      model: result.model,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? `AI 调用失败:${e.message}` : "AI 调用失败" }, { status: 502 });
  }
}
