"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InboxQuickInput() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, description: desc }) });
      if (!res.ok) return; // 保存失败保留输入,不丢用户敲的字
      setTitle("");
      setDesc("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="surface p-3">
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
