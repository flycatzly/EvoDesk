"use client";
import { useRouter } from "next/navigation";
import { ClipBar } from "./ClipBar";
import { useState } from "react";
import type { notes } from "@/lib/db/schema";

type NoteRow = typeof notes.$inferSelect;

const SOURCE_LABEL: Record<string, string> = { manual: "手动", chat: "对话", task: "任务", news_digest: "资讯" };
const BODY_PREVIEW = 200; // 卡片流正文预览截断,完整内容走「编辑」查看

/** 失败提示:服务端 data.error 优先(409/400 的业务文案),兜底 fallback */
function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

function parseTags(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function NotesView({ notes: rows }: { notes: NoteRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null); // 按 noteId+action(create/edit-<id>/totask-<id>/tovault-<id>)
  const [note, setNote] = useState<string | null>(null);
  // 新建表单
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  // 行内编辑态:仅记录正在编辑的卡片,取消时直接丢弃草稿即还原
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const create = async () => {
    if (busy) return;
    if (!newTitle.trim()) { setNote("标题必填"); return; }
    setBusy("create");
    setNote(null);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: newTitle, body: newBody }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "保存失败,请重试")); return; }
      setNewTitle("");
      setNewBody("");
      router.refresh();
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const startEdit = (n: NoteRow) => {
    setNote(null);
    setEditingId(n.id);
    setEditTitle(n.title);
    setEditBody(n.body);
  };

  const saveEdit = async () => {
    if (busy || !editingId) return;
    if (!editTitle.trim()) { setNote("标题必填"); return; }
    setBusy(`edit-${editingId}`);
    setNote(null);
    try {
      const res = await fetch("/api/notes", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editingId, title: editTitle, body: editBody }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "保存失败,请重试")); return; }
      setEditingId(null);
      router.refresh();
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const toTask = async (id: string) => {
    if (busy) return;
    setBusy(`totask-${id}`);
    setNote(null);
    try {
      const res = await fetch(`/api/notes/${id}/to-task`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "转任务失败,请重试")); return; }
      setNote("已创建任务并关联");
      router.refresh();
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const toVault = async (id: string) => {
    if (busy) return;
    setBusy(`tovault-${id}`);
    setNote(null);
    try {
      const res = await fetch(`/api/notes/${id}/to-vault`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "存入失败,请重试")); return; }
      const vp = typeof data?.vaultPath === "string" ? data.vaultPath : "";
      setNote(`已存入:${vp || "Obsidian vault"}`);
      router.refresh();
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const removeNote = async (id: string) => {
    if (busy) return;
    if (!window.confirm("删除这条笔记?不可恢复。")) return;
    setBusy(`del-${id}`);
    setNote(null);
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "删除失败,请重试")); return; }
      setNote("已删除");
      router.refresh();
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {/* 一致性栏:成功/失败提示全程在此呈现 */}
      {note && <div className="surface p-2 mb-3 text-sm">{note}</div>}

      <ClipBar />

      {/* 新建:顶部 surface 卡 */}
      <div className="surface p-3 mb-4">
        <input
          className="input w-full px-3 py-2 text-sm mb-2"
          placeholder="标题"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
        />
        <textarea
          className="input w-full px-3 py-2 text-sm mb-2"
          rows={3}
          placeholder="记点什么…(支持多行)"
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
        />
        <button type="button" disabled={!!busy} className="accent-btn px-3 py-1.5 text-sm disabled:opacity-40" onClick={create}>
          {busy === "create" ? "保存中…" : "保存"}
        </button>
      </div>

      {rows.length === 0 && (
        <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>
          暂无笔记。在上方写下第一条灵感;对话台结论转任务、资讯摘要也会自动收集成笔记。
        </div>
      )}

      <div className="space-y-2">
        {rows.map((n) => {
          const tags = parseTags(n.tags);
          const preview = n.body.length > BODY_PREVIEW ? `${n.body.slice(0, BODY_PREVIEW)}…` : n.body;
          return (
            <div key={n.id} className="surface p-3 text-sm">
              {editingId === n.id ? (
                <>
                  <input
                    className="input w-full px-3 py-2 text-sm mb-2"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                  />
                  <textarea
                    className="input w-full px-3 py-2 text-sm mb-2"
                    rows={6}
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button type="button" disabled={!!busy} className="accent-btn px-3 py-1.5 text-xs disabled:opacity-40" onClick={saveEdit}>
                      {busy === `edit-${n.id}` ? "保存中…" : "保存"}
                    </button>
                    <button type="button" disabled={!!busy} className="ghost-btn px-3 py-1.5 text-xs" onClick={() => setEditingId(null)}>
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{n.title}</span>
                    {n.pinned && <span title="置顶">📌</span>}
                    <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>
                      {SOURCE_LABEL[n.source] ?? n.source}
                    </span>
                    {tags.map((t) => (
                      <span key={t} className="text-xs" style={{ color: "var(--accent)" }}>#{t}</span>
                    ))}
                    {/* 本地化时间由服务端与浏览器各自计算,suppressHydrationWarning 兜底格式差异 */}
                    <span className="ml-auto text-xs tabular-nums" style={{ color: "var(--muted)" }} suppressHydrationWarning>
                      {new Date(n.updatedAt).toLocaleString("zh-CN", { hour12: false })}
                    </span>
                  </div>
                  {preview && (
                    <div className="mt-1 whitespace-pre-wrap break-words" style={{ color: "var(--muted)" }}>{preview}</div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!!busy} className="ghost-btn px-2 py-1 text-xs" onClick={() => startEdit(n)}>
                      编辑
                    </button>
                    <button type="button" disabled={!!busy} className="ghost-btn px-2 py-1 text-xs" onClick={() => toTask(n.id)}>
                      {busy === `totask-${n.id}` ? "创建中…" : "转任务"}
                    </button>
                    <button type="button" disabled={!!busy} className="ghost-btn px-2 py-1 text-xs" onClick={() => toVault(n.id)}>
                      {busy === `tovault-${n.id}` ? "存入中…" : "存入 Obsidian"}
                    </button>
                    <button
                      type="button"
                      disabled={!!busy}
                      className="ghost-btn px-2 py-1 text-xs"
                      style={{ color: "var(--danger)" }}
                      onClick={() => removeNote(n.id)}
                      title="删除这条笔记(不可恢复)"
                    >
                      {busy === `del-${n.id}` ? "删除中…" : "删除"}
                    </button>
                    {n.taskId && <span className="text-xs" style={{ color: "var(--muted)" }}>已关联任务</span>}
                    {n.vaultPath && <span className="text-xs" style={{ color: "var(--muted)" }}>已存入 Obsidian</span>}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
