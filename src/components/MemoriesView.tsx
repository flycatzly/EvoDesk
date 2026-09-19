"use client";
import { useCallback, useEffect, useState } from "react";

type Memory = { id: string; content: string; sourceChatId: string | null; pinned: boolean; hits: number; createdAt: string };

// 记忆库:AI 对话自动提取的长期事实 + 手动补充;置顶的永不淘汰。
export function MemoriesView() {
  const [items, setItems] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memories");
      const data = (await res.json()) as { memories?: Memory[] };
      setItems(data.memories ?? []);
    } catch { /* 保持旧数据 */ } finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const raf = requestAnimationFrame(() => void load());
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const add = async () => {
    if (!draft.trim()) return;
    await fetch("/api/memories", { method: "POST", body: JSON.stringify({ content: draft.trim() }) });
    setDraft("");
    void load();
  };
  const togglePin = async (m: Memory) => {
    await fetch("/api/memories", { method: "PATCH", body: JSON.stringify({ id: m.id, pinned: !m.pinned }) });
    void load();
  };
  const remove = async (id: string) => {
    if (!window.confirm("删除这条记忆?")) return;
    await fetch("/api/memories", { method: "DELETE", body: JSON.stringify({ id }) });
    void load();
  };
  const saveEdit = async () => {
    if (!editing) return;
    await fetch("/api/memories", { method: "PATCH", body: JSON.stringify({ id: editing.id, content: editing.draft }) });
    setEditing(null);
    void load();
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">记忆库</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        AI 对话中自动提取的长期事实(偏好/项目背景/工作习惯),新对话自动注入作为上下文;
        置顶记忆永不淘汰。可在对话里手动补充,也可在这里整理。
      </p>

      <div className="surface p-3 mb-4">
        <div className="flex gap-2 items-center">
          <input className="input text-sm flex-1" placeholder="手动添加一条记忆,如:主力语言是 TypeScript,偏好 pnpm"
            value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }} />
          <button className="accent-btn text-xs px-3 py-1.5" onClick={() => void add()} disabled={!draft.trim()}>添加</button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm" style={{ color: "var(--muted)" }}>加载中…</div>
      ) : items.length === 0 ? (
        <div className="surface p-6 text-sm text-center" style={{ color: "var(--muted)" }}>
          还没有记忆。去对话台聊几句,AI 会自动记住重要信息;或在上面手动添加。
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((m) => (
            <div key={m.id} className="surface p-2.5 flex flex-wrap items-center gap-2 text-sm">
              <button onClick={() => void togglePin(m)} title={m.pinned ? "取消置顶" : "置顶(永不淘汰)"}
                style={{ color: m.pinned ? "var(--warn)" : "var(--muted)" }}>
                {m.pinned ? "★" : "☆"}
              </button>
              {editing?.id === m.id ? (
                <>
                  <input className="input text-sm flex-1 min-w-48" value={editing.draft} autoFocus
                    onChange={(e) => setEditing({ ...editing, draft: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveEdit(); if (e.key === "Escape") setEditing(null); }} />
                  <button className="accent-btn text-xs px-2 py-1" onClick={() => void saveEdit()}>保存</button>
                  <button className="ghost-btn text-xs px-2 py-1" onClick={() => setEditing(null)}>取消</button>
                </>
              ) : (
                <>
                  <span className="flex-1 min-w-48">{m.content}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{new Date(m.createdAt).toLocaleDateString()}</span>
                  <button className="ghost-btn text-xs px-1.5 py-0.5" onClick={() => setEditing({ id: m.id, draft: m.content })}>编辑</button>
                  <button className="ghost-btn text-xs px-1.5 py-0.5" style={{ color: "var(--danger)" }} onClick={() => void remove(m.id)}>删除</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
