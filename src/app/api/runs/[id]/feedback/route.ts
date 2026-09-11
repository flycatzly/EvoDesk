import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { flowRuns, tasks } from "@/lib/db/schema";
import { refreshTemplateStats } from "@/lib/domain/template-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 评分闭环:任务 review → done,评分与结论同时落到 run 与 task,模板统计随之刷新
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const run = db.select().from(flowRuns).where(eq(flowRuns.id, id)).all()[0];
  if (!run) return NextResponse.json({ error: "run 不存在" }, { status: 404 });
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const satisfaction = Number(body.satisfaction);
  if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
    return NextResponse.json({ error: "satisfaction 需要 1-5 整数" }, { status: 400 });
  }
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0];
  if (!task || task.status !== "review") return NextResponse.json({ error: "任务不在评审状态" }, { status: 409 });
  const note = typeof body.outcome_note === "string" ? body.outcome_note : null;
  db.update(flowRuns).set({ satisfaction, outcomeNote: note }).where(eq(flowRuns.id, id)).run();
  db.update(tasks).set({ status: "done", outcomeNote: note, updatedAt: new Date().toISOString() }).where(eq(tasks.id, task.id)).run();
  refreshTemplateStats(db, run.templateId);
  return NextResponse.json({ run: db.select().from(flowRuns).where(eq(flowRuns.id, id)).all()[0], task: db.select().from(tasks).where(eq(tasks.id, task.id)).all()[0] });
}
