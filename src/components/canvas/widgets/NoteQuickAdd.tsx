"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

// 灵感速记:一行输入,回车/按钮即存(标题即内容),成功后刷新列表
export function NoteQuickAdd() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const save = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/notes", { method: "POST", body: JSON.stringify({ title: trimmed }) });
      if (res.ok) {
        setTitle("");
        startTransition(() => router.refresh());
      } else {
        setError("保存失败,请重试");
      }
    } catch {
      setError("网络异常,请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-2">
      <div className="flex gap-1">
        <input
          className="input flex-1 text-sm"
          placeholder="记一条灵感…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
          disabled={saving}
        />
        <button className="accent-btn text-xs shrink-0" onClick={() => void save()} disabled={saving || !title.trim()}>
          {saving ? "保存中…" : "记下"}
        </button>
      </div>
      {error && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{error}</div>}
    </div>
  );
}
