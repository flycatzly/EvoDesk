import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks, flowRuns, flowTemplates, stepRuns } from "@/lib/db/schema";
import { RunView, StartButton } from "@/components/RunView";

export const dynamic = "force-dynamic";

export default async function TaskRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
  if (!task) notFound();
  // .at(-1) 取该任务最近一次 run:活跃 run 防重入保证了同时至多一个,但历史上存在已完结 run
  const run = (db.select().from(flowRuns).where(eq(flowRuns.taskId, id)).all() as (typeof flowRuns.$inferSelect)[]).at(-1) ?? null;
  const steps = run ? (db.select().from(stepRuns).where(eq(stepRuns.runId, run.id)).orderBy(stepRuns.stepIndex).all() as (typeof stepRuns.$inferSelect)[]) : [];
  const template = run ? db.select().from(flowTemplates).where(eq(flowTemplates.id, run.templateId)).all()[0] ?? null : null;
  const stepDefs = template ? (JSON.parse(template.steps) as { name: string; type: string; instruction?: string; command?: string; optional?: boolean }[]) : [];

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">{task.title}</h1>
      <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>
        {task.status} · {task.complexity} {run ? `· 流程:${template?.name ?? run.templateId}` : ""}
      </div>
      {task.description && <div className="surface p-3 text-sm mb-4 whitespace-pre-wrap">{task.description}</div>}
      {run && !["canceled", "failed"].includes(run.status) ? (
        <RunView taskId={task.id} taskStatus={task.status} run={{ ...run }} steps={[...steps]} stepDefs={stepDefs} />
      ) : (
        <div className="flex flex-col items-start gap-1">
          <StartButton taskId={task.id} disabled={task.status !== "ready"} />
          {run && ["canceled", "failed"].includes(run.status) && (
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              上次运行已{run.status === "canceled" ? "取消" : "失败"},可重新开始
            </span>
          )}
        </div>
      )}
    </div>
  );
}
