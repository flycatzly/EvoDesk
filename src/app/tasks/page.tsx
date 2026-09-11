import Link from "next/link";
import { getDb } from "@/lib/db/client";
import { tasks, projects } from "@/lib/db/schema";
import { ProjectFilter, StatusButton } from "@/components/BoardActions";

export const dynamic = "force-dynamic";

const COLUMNS: { status: string; label: string }[] = [
  { status: "ready", label: "就绪" },
  { status: "running", label: "执行中" },
  { status: "waiting_human", label: "待人工" },
  { status: "review", label: "评审" },
  { status: "done", label: "完成" },
];

const NEXT_ACTIONS: Record<string, { to: string; label: string }[]> = {
  ready: [{ to: "canceled", label: "取消" }],
  review: [{ to: "done", label: "通过完成" }, { to: "canceled", label: "取消" }],
  waiting_human: [{ to: "ready", label: "退回就绪" }],
};

// 这些状态有执行视图(运行中/待人工/评审实时推进,done 可看历史留痕),卡片标题可点进详情。
const LINKABLE_STATUSES = new Set(["ready", "running", "waiting_human", "review", "done"]);

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  const db = getDb();
  const all = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
  const projectRows = db.select().from(projects).all() as (typeof projects.$inferSelect)[];
  const shown = project ? all.filter((t) => t.projectId === project) : all;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-4 mb-4">
        <h1 className="text-xl font-bold">任务看板</h1>
        <ProjectFilter projects={projectRows.map((p) => ({ id: p.id, name: p.name }))} current={project ?? ""} />
      </div>
      <div className="grid md:grid-cols-5 gap-3">
        {COLUMNS.map((col) => {
          const list = shown.filter((t) => t.status === col.status);
          return (
            <div key={col.status} className="min-w-0">
              <div className="text-sm font-semibold mb-2">{col.label} <span style={{ color: "var(--muted)" }}>{list.length}</span></div>
              {list.map((t) => (
                <div key={t.id} id={`task-${t.id}`} className="surface p-3 mb-2">
                  <div className="text-sm">
                    {LINKABLE_STATUSES.has(t.status)
                      ? <Link href={`/tasks/${t.id}`} className="hover:underline" style={{ color: "var(--accent)" }}>{t.title}</Link>
                      : t.title}
                  </div>
                  <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {t.complexity}
                    {t.dueDate ? ` · 截止 ${t.dueDate}` : ""}
                    {t.flowTemplateId ? " · 已绑定流程" : ""}
                  </div>
                  <div className="mt-2 flex gap-1 flex-wrap">
                    {(NEXT_ACTIONS[t.status] ?? []).map((a) => (
                      <StatusButton key={a.to} taskId={t.id} to={a.to} label={a.label} />
                    ))}
                  </div>
                </div>
              ))}
              {list.length === 0 && <div className="text-xs p-2" style={{ color: "var(--muted)" }}>空</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
