import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { flowRuns, flowTemplates } from "@/lib/db/schema";

export function refreshTemplateStats(db: Db, templateId: string): void {
  const runs = db.select().from(flowRuns).where(eq(flowRuns.templateId, templateId)).all() as (typeof flowRuns.$inferSelect)[];
  const finished = runs.filter((r) => r.status === "done" || r.status === "failed");
  const done = finished.filter((r) => r.status === "done");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sats = runs.map((r) => r.satisfaction).filter((s): s is number => s != null);
  db.update(flowTemplates).set({
    statRuns: runs.length,
    statSuccessRate: finished.length ? done.length / finished.length : 0,
    statAvgCostUsd: avg(done.map((r) => r.totalCostUsd)),
    statAvgDurationMs: Math.round(avg(done.map((r) => r.totalDurationMs))),
    statAvgSatisfaction: avg(sats),
    statLastUsedAt: runs.map((r) => r.startedAt).sort().at(-1) ?? null,
    updatedAt: new Date().toISOString(),
  }).where(eq(flowTemplates.id, templateId)).run();
}
