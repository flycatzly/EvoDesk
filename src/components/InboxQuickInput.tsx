"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export interface InboxPrefill {
  noteId: string;
  title: string;
  body: string;
}

export function InboxQuickInput({ prefill }: { prefill?: InboxPrefill | null }) {
  const router = useRouter();
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [desc, setDesc] = useState(prefill?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(false);
  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, description: desc }) });
      if (!res.ok) return; // 保存失败保留输入,不丢用户敲的字
      // 来自笔记速记的预填:创建成功后回写关联,保持与「转任务」直转一致的链路
      if (prefill?.noteId) {
        const j = (await res.clone().json().catch(() => null)) as { task?: { id?: string } } | null;
        const taskId = j?.task?.id;
        if (taskId) {
          try {
            await fetch("/api/notes", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: prefill.noteId, task_id: taskId }) });
            setLinked(true);
          } catch { /* 关联失败不影响任务创建 */ }
        }
      }
      setTitle("");
      setDesc("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="surface p-3">
      {prefill && (
        <div className="text-xs mb-2 px-2 py-1 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
          ✎ 已带入笔记速记内容{linked ? ",任务创建后将自动关联" : ",确认无误后点「放入收件箱」"}
        </div>
      )}
      <input
        className="input w-full px-3 py-2 text-sm"
        placeholder="一句话记录任务…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }}
      />
      <textarea className="input w-full px-3 py-2 text-sm mt-2" rows={2} placeholder="补充描述(可选,有助 AI 分诊)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <button onClick={add} className="accent-btn px-4 py-1.5 text-sm mt-2">{busy ? "保存中…" : "放入收件箱"}</button>
    </div>
  );
}
