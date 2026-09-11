import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { flowRuns, tasks, stepRuns } from "@/lib/db/schema";
import { refreshTemplateStats } from "@/lib/domain/template-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const run = db.select().from(flowRuns).where(eq(flowRuns.id, id)).all()[0];
  if (!run) return NextResponse.json({ error: "run 不存在" }, { status: 404 });
  if (!["running", "waiting_human"].includes(run.status)) return NextResponse.json({ error: "当前状态不可取消" }, { status: 409 });
  const nowIso = new Date().toISOString();
  db.update(flowRuns).set({ status: "canceled", finishedAt: nowIso }).where(eq(flowRuns.id, id)).run();
  // 只跳过非终态步骤,保留 done/skipped 历史(打回率/统计口径依赖)
  db.update(stepRuns).set({ status: "skipped", finishedAt: nowIso })
    .where(and(eq(stepRuns.runId, id), inArray(stepRuns.status, ["pending", "running", "awaiting_confirmation"]))).run();
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0];
  if (task && ["running", "waiting_human"].includes(task.status)) {
    db.update(tasks).set({ status: "ready", updatedAt: nowIso }).where(eq(tasks.id, task.id)).run();
  }
  refreshTemplateStats(db, run.templateId);
  return NextResponse.json({ run: db.select().from(flowRuns).where(eq(flowRuns.id, id)).all()[0] });
}
