import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { recurringRules } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREQS = ["daily", "weekdays", "weekly"];

export async function GET(_req: NextRequest) {
  return NextResponse.json({ rules: (await (await getAnyDb()).select().from(recurringRules)) });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw : null;
  if (!body || typeof body.title !== "string" || !body.title.trim() || !FREQS.includes(body.freq)) {
    return NextResponse.json({ error: "title 与 freq(daily|weekdays|weekly) 必填" }, { status: 400 });
  }
  // weekly 必须带整数 weekday 0-6(周日=0);否则 tick 的 nextRunAfter 无法稳定推进
  if (body.freq === "weekly" && (!Number.isInteger(body.weekday) || (body.weekday as number) < 0 || (body.weekday as number) > 6)) {
    return NextResponse.json({ error: "weekly 需要 weekday(0-6)" }, { status: 400 });
  }
  // next_run_at 统一为明天 UTC 零点(UTC-ISO 约定见 schema.ts 头注),避免创建即触发 tick
  const next = new Date();
  next.setUTCHours(0, 0, 0, 0);
  next.setUTCDate(next.getUTCDate() + 1);
  // 归一化与 POST /api/tasks 同契约:tickRecurring 会把 priority/tags 原样复制进生成的任务,绕过任务级校验,
  // 必须在规则入口截断(priority 0-3、tags ≤5);weekday 仅 weekly 语义有效,非 weekly 一律存 null
  const rule = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    description: typeof body.description === "string" ? body.description : "",
    tags: JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 5) : []),
    complexity: ["S", "M", "L"].includes(body.complexity) ? body.complexity : "S",
    priority: Number.isInteger(body.priority) ? Math.min(3, Math.max(0, body.priority)) : 1,
    projectId: typeof body.project_id === "string" ? body.project_id : null,
    freq: body.freq,
    weekday: body.freq === "weekly" && Number.isInteger(body.weekday) ? body.weekday : null,
    enabled: true,
    nextRunAt: next.toISOString(),
    createdAt: new Date().toISOString(),
  };
  await (await getAnyDb()).insert(recurringRules).values(rule);
  // 回读补全 DB 默认列(lastTaskId 等),与 POST /api/tasks 的回读模式一致
  const created = (await (await getAnyDb()).select().from(recurringRules).where(eq(recurringRules.id, rule.id)))[0];
  return NextResponse.json({ rule: created }, { status: 201 });
}
