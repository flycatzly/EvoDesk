import Link from "next/link";
import type { tasks } from "@/lib/db/schema";

type Task = typeof tasks.$inferSelect;

const STATUS_LABEL: Record<string, string> = {
  inbox: "收件箱", triaging: "分诊中", ready: "就绪", running: "执行中",
  waiting_human: "待人工", review: "评审", done: "完成", archived: "归档", canceled: "已取消",
};
const COMPLEXITY_COLOR: Record<string, string> = { S: "var(--ok)", M: "var(--warn)", L: "var(--danger)" };

// tags 列是 JSON 字符串;损坏数据不应炸掉整页渲染,解析失败/非数组一律按空处理
function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function TaskCard({ task, projectName }: { task: Task; projectName?: string }) {
  const tags = parseTags(task.tags);
  return (
    <Link href={`/tasks#task-${task.id}`} className="surface block p-3 mb-2 hover:opacity-90">
      <div className="flex items-center gap-2">
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{STATUS_LABEL[task.status]}</span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: COMPLEXITY_COLOR[task.complexity] }}>{task.complexity}</span>
        {task.dueDate && <span className="text-xs" style={{ color: "var(--danger)" }}>{task.dueDate}</span>}
      </div>
      <div className="mt-1 text-sm font-medium">{task.title}</div>
      <div className="mt-1 flex gap-1 flex-wrap">
        {projectName && <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{projectName}</span>}
        {tags.map((t) => <span key={t} className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>#{t}</span>)}
      </div>
    </Link>
  );
}
