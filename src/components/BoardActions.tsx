"use client";
import { useRouter } from "next/navigation";

export function ProjectFilter({ projects, current }: { projects: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <select className="input px-2 py-1.5 text-sm" value={current} onChange={(e) => router.push(e.target.value ? `/tasks?project=${e.target.value}` : "/tasks")}>
      <option value="">全部项目</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

export function StatusButton({ taskId, to, label }: { taskId: string; to: string; label: string }) {
  const router = useRouter();
  const go = async () => {
    const res = await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: to }) });
    if (!res.ok) return; // 失败(含非法流转 422)不刷新,卡片停留原列,可重试
    router.refresh();
  };
  return <button onClick={go} className="ghost-btn px-2 py-1 text-xs">{label}</button>;
}
