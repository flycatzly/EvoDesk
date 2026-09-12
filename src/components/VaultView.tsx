"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

type VaultEntry = { name: string; type: "dir" | "md" | "file" };
type Hit = { path: string; snippet: string };

/** 失败提示:服务端 data.error 优先(403 越界/400 白名单等业务文案),兜底 fallback */
function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

function toEntries(raw: unknown): VaultEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is VaultEntry => {
    if (!e || typeof e !== "object") return false;
    const o = e as Record<string, unknown>;
    return typeof o.name === "string" && (o.type === "dir" || o.type === "md" || o.type === "file");
  });
}

function toHits(raw: unknown): Hit[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is Hit => {
    if (!h || typeof h !== "object") return false;
    const o = h as Record<string, unknown>;
    return typeof o.path === "string" && typeof o.snippet === "string";
  });
}

export function VaultView({ vaultConfigured }: { vaultConfigured: boolean }) {
  // busy 按动作标记:root / tree:<path> / file / save / search / create
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [rootState, setRootState] = useState<"loading" | "ok" | "error">("loading");
  const [rootEntries, setRootEntries] = useState<VaultEntry[]>([]);
  const [children, setChildren] = useState<Record<string, VaultEntry[]>>({}); // 已懒加载的子目录
  // 搜索
  const [searchQ, setSearchQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  // 编辑器
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [content, setContent] = useState("");

  const loadTree = useCallback(async (rel: string): Promise<boolean> => {
    setBusy(rel === "" ? "root" : `tree:${rel}`);
    try {
      const res = await fetch(`/api/vault/tree?path=${encodeURIComponent(rel)}`);
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setNote(errorOf(data, "目录加载失败"));
        if (rel === "") setRootEntries([]);
        return false;
      }
      const entries = toEntries(data?.entries);
      if (rel === "") setRootEntries(entries);
      else setChildren((c) => ({ ...c, [rel]: entries }));
      return true;
    } catch {
      setNote("网络异常,请重试");
      return false;
    } finally {
      setBusy(null);
    }
  }, []);

  // 根目录 on mount 加载;vault 目录不存在等失败 → 错误态引导(与未配置同理)
  useEffect(() => {
    if (!vaultConfigured) return;
    void (async () => {
      const ok = await loadTree("");
      setRootState(ok ? "ok" : "error");
    })();
  }, [vaultConfigured, loadTree]);

  const openFile = async (rel: string) => {
    if (busy) return;
    setBusy("file");
    setNote(null);
    try {
      const res = await fetch(`/api/vault/file?path=${encodeURIComponent(rel)}`);
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "文件加载失败")); return; }
      setCurrentPath(rel);
      setContent(typeof data?.content === "string" ? data.content : "");
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (busy || !currentPath) return;
    setBusy("save");
    setNote(null);
    try {
      const res = await fetch("/api/vault/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: currentPath, content }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "保存失败,请重试")); return; }
      setNote("已保存");
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const doSearch = async () => {
    const q = searchQ.trim();
    if (busy || !q) return;
    setBusy("search");
    setNote(null);
    try {
      const res = await fetch(`/api/vault/search?q=${encodeURIComponent(q)}`);
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "搜索失败,请重试")); return; }
      setHits(toHits(data?.hits));
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  // 新建文件:文件名交给用户输入,不强制 .md(服务端白名单校验,400 提示);创建在 vault 根
  const createFile = async () => {
    if (busy) return;
    const name = window.prompt("新文件名(建议以 .md 结尾)");
    if (name === null) return; // 用户取消
    const rel = name.trim();
    if (!rel) return;
    setBusy("create");
    setNote(null);
    try {
      const res = await fetch("/api/vault/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: rel, content: "" }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) { setNote(errorOf(data, "创建失败,请重试")); return; }
      setNote(`已创建:${rel}`);
      setCurrentPath(rel);
      setContent("");
      await loadTree(""); // 刷新根目录(新建固定落在根)
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  if (!vaultConfigured) {
    return (
      <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>
        尚未配置知识库:请先在 <Link href="/settings" className="underline" style={{ color: "var(--accent)" }}>设置页</Link>{" "}
        配置 Obsidian vault 路径,配置后即可在此浏览、搜索与编辑 vault 内的 Markdown 笔记。
      </div>
    );
  }

  const renderEntries = (entries: VaultEntry[], base: string): ReactNode => (
    <ul className="space-y-0.5">
      {entries.map((e) => {
        const rel = base ? `${base}/${e.name}` : e.name;
        if (e.type === "dir") {
          const kids = children[rel];
          return (
            <li key={rel}>
              <details
                onToggle={(ev) => {
                  // 展开时懒加载子目录(收起不重复拉取)
                  if (ev.currentTarget.open && !children[rel]) void loadTree(rel);
                }}
              >
                <summary className="cursor-pointer text-sm px-1 py-0.5 rounded select-none">
                  📁 {e.name}
                </summary>
                <div className="ml-4">
                  {kids
                    ? kids.length === 0
                      ? <div className="text-xs px-1 py-0.5" style={{ color: "var(--muted)" }}>(空)</div>
                      : renderEntries(kids, rel)
                    : <div className="text-xs px-1 py-0.5" style={{ color: "var(--muted)" }}>加载中…</div>}
                </div>
              </details>
            </li>
          );
        }
        if (e.type === "md") {
          const active = currentPath === rel;
          return (
            <li key={rel}>
              <button
                type="button"
                disabled={!!busy}
                className="text-left text-sm px-1 py-0.5 w-full rounded truncate disabled:opacity-60"
                style={active ? { color: "var(--accent)", background: "var(--surface-2)" } : { color: "var(--text)" }}
                onClick={() => openFile(rel)}
                title={rel}
              >
                📄 {e.name}
              </button>
            </li>
          );
        }
        // 非 md 文件只读展示,不可编辑(v1 白名单仅 md/txt 在线编辑)
        return (
          <li key={rel} className="text-sm px-1 py-0.5 opacity-50 truncate" title={rel}>{e.name}</li>
        );
      })}
    </ul>
  );

  return (
    <div>
      {/* 一致性栏:成功/失败提示全程在此呈现 */}
      {note && <div className="surface p-2 mb-3 text-sm">{note}</div>}

      {/* 顶部:搜索 + 新建文件 */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          className="input flex-1 min-w-48 px-3 py-2 text-sm"
          placeholder="搜索 Markdown 内容,回车执行"
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void doSearch(); }}
        />
        <button type="button" disabled={!!busy || !searchQ.trim()} className="ghost-btn px-3 py-1.5 text-sm disabled:opacity-40" onClick={doSearch}>
          {busy === "search" ? "搜索中…" : "搜索"}
        </button>
        <button type="button" disabled={!!busy} className="ghost-btn px-3 py-1.5 text-sm disabled:opacity-40" onClick={createFile}>
          + 新建文件
        </button>
      </div>

      {/* 命中列表:点击加载该文件到编辑器 */}
      {hits !== null && (
        <div className="surface p-2 mb-3 text-sm">
          {hits.length === 0 ? (
            <span style={{ color: "var(--muted)" }}>无命中</span>
          ) : (
            <div className="space-y-0.5">
              {hits.map((h) => (
                <button
                  key={h.path}
                  type="button"
                  disabled={!!busy}
                  className="block w-full text-left px-2 py-1 rounded disabled:opacity-60"
                  onClick={() => openFile(h.path)}
                >
                  <span className="font-medium">{h.path}</span>
                  <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>{h.snippet}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-3 items-start">
        {/* 左侧目录树 */}
        <div className="surface p-3 w-full md:w-64 shrink-0 max-h-[70vh] overflow-auto">
          <div className="text-xs uppercase mb-2" style={{ color: "var(--muted)" }}>目录</div>
          {rootState === "loading" && <div className="text-sm" style={{ color: "var(--muted)" }}>加载中…</div>}
          {rootState === "error" && (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              vault 目录加载失败。请确认已在 <Link href="/settings" className="underline">设置页</Link>{" "}
              配置有效的 Obsidian vault 路径,再刷新本页重试。
            </div>
          )}
          {rootState === "ok" && (
            rootEntries.length === 0
              ? <div className="text-sm" style={{ color: "var(--muted)" }}>(空目录,可点上方「+ 新建文件」)</div>
              : renderEntries(rootEntries, "")
          )}
        </div>

        {/* 右侧编辑器 */}
        <div className="surface p-3 flex-1 w-full min-w-0">
          {currentPath ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium truncate" title={currentPath}>{currentPath}</span>
                <button
                  type="button"
                  disabled={!!busy}
                  className="accent-btn ml-auto px-3 py-1.5 text-xs disabled:opacity-40 shrink-0"
                  onClick={save}
                >
                  {busy === "save" ? "保存中…" : "保存"}
                </button>
              </div>
              <textarea
                className="input w-full px-3 py-2 text-sm font-mono min-h-96 whitespace-pre-wrap"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                spellCheck={false}
              />
            </>
          ) : (
            <div className="text-sm" style={{ color: "var(--muted)" }}>
              从左侧选择一个 Markdown 文件开始编辑;搜索命中后点击也可直接打开。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
