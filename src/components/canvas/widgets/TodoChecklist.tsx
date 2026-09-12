"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { TaskLite } from "@/lib/domain/canvas-data";

const PRIORITY_COLOR: Record<number, string> = { 3: "var(--danger)", 2: "var(--warn)" };

// 流程执行中的任务不能勾选直达 done(状态机禁止:有活跃 flow_run,须在执行视图完成/取消)
const IN_FLOW: ReadonlySet<string> = new Set(["running", "waiting_human"]);

// 待办勾选清单:点击完成/恢复,乐观更新 + router.refresh 同步服务端计数
export function TodoChecklist({ tasks }: { tasks: TaskLite[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const toggle = async (t: TaskLite) => {
    if (busyId) return;
    setBusyId(t.id);
    try {
      const nextStatus = t.status === "done" ? "ready" : "done";
      const res = await fetch(`/api/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      if (res.ok) startTransition(() => router.refresh());
    } finally {
      setBusyId(null);
    }
  };

  if (tasks.length === 0) {
    return <div className="text-sm py-2" style={{ color: "var(--muted)" }}>今天没有截止任务,安排点小事或休息。</div>;
  }
  return (
    <ul className="space-y-1">
      {tasks.map((t) => (
        <li key={t.id} className="flex items-center gap-2 py-1">
          <span className="w-0.5 self-stretch rounded" style={{ background: PRIORITY_COLOR[t.priority] ?? "var(--border)" }} />
          <input
            type="checkbox"
            checked={t.status === "done"}
            disabled={busyId === t.id || IN_FLOW.has(t.status)}
            title={IN_FLOW.has(t.status) ? "流程执行中,请到执行视图完成或取消" : undefined}
            onChange={() => toggle(t)}
            className="shrink-0"
            aria-label={`完成:${t.title}`}
          />
          <span className={`text-sm truncate ${t.status === "done" ? "line-through" : ""}`} style={{ color: t.status === "done" ? "var(--muted)" : undefined }} title={t.title}>
            {t.title}
          </span>
          {t.overdue && <span className="text-xs shrink-0" style={{ color: "var(--danger)" }}>逾期</span>}
          {t.dueDate && !t.overdue && <span className="text-xs shrink-0" style={{ color: "var(--muted)" }}>{t.dueDate.slice(5)}</span>}
          {t.projectName && <span className="text-xs px-1 rounded shrink-0" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{t.projectName}</span>}
        </li>
      ))}
    </ul>
  );
}
