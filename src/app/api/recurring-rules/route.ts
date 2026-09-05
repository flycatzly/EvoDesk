import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { recurringRules } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREQS = ["daily", "weekdays", "weekly"];

export async function GET(_req: NextRequest) {
  return NextResponse.json({ rules: getDb().select().from(recurringRules).all() });
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
  const rule = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    description: typeof body.description === "string" ? body.description : "",
    tags: JSON.stringify(Array.isArray(body.tags) ? body.tags : []),
    complexity: ["S", "M", "L"].includes(body.complexity) ? body.complexity : "S",
    priority: Number.isInteger(body.priority) ? body.priority : 1,
    projectId: typeof body.project_id === "string" ? body.project_id : null,
    freq: body.freq,
    weekday: Number.isInteger(body.weekday) ? body.weekday : null,
    enabled: true,
    nextRunAt: next.toISOString(),
    createdAt: new Date().toISOString(),
  };
  getDb().insert(recurringRules).values(rule).run();
  // 回读补全 DB 默认列(lastTaskId 等),与 POST /api/tasks 的回读模式一致
  const created = getDb().select().from(recurringRules).where(eq(recurringRules.id, rule.id)).all()[0];
  return NextResponse.json({ rule: created }, { status: 201 });
}
