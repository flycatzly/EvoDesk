"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { docToHtml, markdownToHtml } from "@/lib/domain/md-render";

type GuideEntry = { relPath: string; name: string; title: string; category: string; folder: string; size: number; headline: string };
type Category = { name: string; count: number; folders: { name: string; count: number }[] };

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

type TreeNode = { name: string; label: string; path: string; children: TreeNode[]; count: number };

/** 面试宝典三栏工作台:文件夹树 | 文章列表 | 阅读详情;支持搜索、勾选导出/同步、AI 问答。 */
export function GuideView() {
  const [dirs, setDirs] = useState<string[]>([]);
  const [dir, setDir] = useState("");
  const [addDraft, setAddDraft] = useState("");
  const [categories, setCategories] = useState<Category[]>([]);
  const [entries, setEntries] = useState<GuideEntry[]>([]);
  const [cat, setCat] = useState("");
  const [folder, setFolder] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reading, setReading] = useState<{ path: string; content: string } | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [savingDoc, setSavingDoc] = useState(false);
  // 阅读弹框视图:preview=md 渲染 / edit=纯 md 编辑 / html=HTML 展示效果
  const [viewMode, setViewMode] = useState<"preview" | "edit" | "html">("preview");
  // 文档弹窗撑满浏览器(fixed 全屏);Esc 退出
  const [docMaxi, setDocMaxi] = useState(false);
  useEffect(() => {
    if (!docMaxi || !reading) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDocMaxi(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [docMaxi, reading]);
  const [exporting, setExporting] = useState<string | null>(null);
  // AI 问答
  const [qaQ, setQaQ] = useState("");
  const [qaBusy, setQaBusy] = useState(false);
  const [qa, setQa] = useState<{ answer: string; refs: string[] } | null>(null);
  const [qaError, setQaError] = useState<string | null>(null);

  const loadDirs = useCallback(async () => {
    const res = await fetch("/api/guide?list=1");
    const data = (await res.json()) as { dirs?: string[] };
    const list = data.dirs ?? [];
    setDirs(list);
    setDir((d) => d || list[0] || "");
  }, []);

  const load = useCallback(async () => {
    if (!dir) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ dir, ...(cat ? { cat } : {}), ...(folder ? { folder } : {}), ...(q ? { q } : {}) });
      const res = await fetch(`/api/guide?${qs}`);
      const data = await res.json();
      if (!res.ok) { setError(errorOf(data, "加载失败")); setEntries([]); setCategories([]); return; }
      const d = data as { categories: Category[]; entries: GuideEntry[] };
      setCategories(d.categories ?? []);
      setEntries(d.entries ?? []);
    } catch {
      setError("请求失败");
    } finally {
      setLoading(false);
    }
  }, [dir, cat, folder, q]);

  // mount: load dirs list (was missing)
  useEffect(() => {
    const raf0 = requestAnimationFrame(() => { void loadDirs(); });
    return () => cancelAnimationFrame(raf0);
  }, [loadDirs]);

  useEffect(() => {
    if (!dir) return;
    const t = setTimeout(() => { void load(); }, q ? 400 : 0);
    return () => clearTimeout(t);
  }, [dir, cat, folder, q, load]);

  const addDir = async () => {
    const d = addDraft.trim();
    if (!d) return;
    const next = [...dirs.filter((x) => x !== d), d];
    const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ guide_dirs: next }) });
    if (!res.ok) { setError("保存失败"); return; }
    setAddDraft("");
    setDirs(next);
    setDir(d);
    void loadDirs();
  };

  // 文件夹树:分类 → 子目录(从 categories 构建二级树)
  const tree: TreeNode[] = useMemo(() => {
    const roots: TreeNode[] = [{ name: "__all__", label: "全部文档", path: "", children: [], count: 0 }];
    for (const c of categories) {
      const node: TreeNode = { name: c.name, label: c.name, path: c.name, children: [], count: c.count };
      for (const f of c.folders) {
        node.children.push({ name: f.name, label: f.name, path: f.name, children: [], count: f.count });
      }
      roots.push(node);
    }
    return roots;
  }, [categories]);

  const toggle = (rel: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(rel)) next.delete(rel); else next.add(rel);
      return next;
    });
  };

  const doExport = async (mode: "md" | "html" | "obsidian") => {
    if (exporting) return;
    setExporting(mode);
    setError(null);
    setNotice(null);
    try {
      const paths = selected.size > 0 ? [...selected] : entries.map((e) => e.relPath);
      const res = await fetch("/api/guide/export", { method: "POST", body: JSON.stringify({ dir, mode, paths }) });
      if (mode === "obsidian") {
        const data = await res.json();
        if (!res.ok) { setError(errorOf(data, "同步失败")); return; }
        const d = data as { copied: number; target: string };
        setNotice(`已同步 ${d.copied} 篇到 Obsidian「${d.target}」`);
        setSelected(new Set());
        return;
      }
      if (!res.ok) { setError(errorOf(await res.json().catch(() => null), "导出失败")); return; }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = mode === "html" ? `guide-${Date.now()}.html` : `guide-${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
      setNotice(`已导出 ${paths.length} 篇(${mode === "html" ? "单文件 HTML" : "zip 打包"})`);
    } catch {
      setError("导出请求失败");
    } finally {
      setExporting(null);
    }
  };

  const openDoc = async (rel: string) => {
    setError(null);
    try {
      const res = await fetch("/api/guide", { method: "POST", body: JSON.stringify({ dir, path: rel }) });
      const data = await res.json();
      if (!res.ok) { setError(errorOf(data, "读取失败")); return; }
      setReading({ path: rel, content: (data as { content: string }).content });
      setEditMode(false);
    } catch {
      setError("读取请求失败");
    }
  };

  // 保存编辑(PUT 写回源文件,服务端自动备份 .bak)
  const saveDoc = async () => {
    if (!reading || !editMode || savingDoc) return;
    setSavingDoc(true);
    setError(null);
    try {
      const res = await fetch("/api/guide", { method: "PUT", body: JSON.stringify({ dir, path: reading.path, content: editDraft }) });
      const data = await res.json();
      if (!res.ok) { setError(errorOf(data, "保存失败")); return; }
      setReading({ ...reading, content: editDraft });
      setEditMode(false);
      setNotice(`已保存:${reading.path}(原文件备份为 .bak)`);
      void load();
    } catch {
      setError("保存请求失败");
    } finally {
      setSavingDoc(false);
    }
  };

  const askQa = async () => {
    const question = qaQ.trim();
    if (!question || qaBusy) return;
    setQaBusy(true);
    setQaError(null);
    try {
      const res = await fetch("/api/vault/qa", { method: "POST", body: JSON.stringify({ root: dir, question }) });
      const data = await res.json();
      if (!res.ok) { setQaError(errorOf(data, "问答失败")); return; }
      const d = data as { answer: string; refs: string[] };
      setQa({ answer: d.answer, refs: d.refs ?? [] });
    } catch {
      setQaError("问答请求失败");
    } finally {
      setQaBusy(false);
    }
  };

  return (
    <div className="max-w-full">
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <h1 className="text-xl font-bold">面试宝典</h1>
        <select className="input text-xs max-w-64" value={dir} onChange={(e) => { setDir(e.target.value); setCat(""); setFolder(""); setSelected(new Set()); }} aria-label="选择宝典源">
          {dirs.length === 0 && <option value="">未配置文档源</option>}
          {dirs.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <input className="input text-sm flex-1 min-w-56" placeholder="搜索标题 / 正文关键字…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="ghost-btn text-xs px-2 py-1" onClick={() => void load()}>刷新</button>
        <button className="ghost-btn text-xs px-2 py-1" onClick={() => { setAddDraft(""); (document.getElementById("guide-add-dir") as HTMLDialogElement | null)?.showModal?.(); }}>
          ⚙ 添加源
        </button>
      </div>

      {/* 添加源的内联面板(默认隐藏) */}
      <details className="surface p-3 mb-3" id="guide-add-dir-wrap">
        <summary className="text-xs cursor-pointer" style={{ color: "var(--muted)" }}>添加 / 管理文档源目录</summary>
        <div className="flex flex-wrap gap-1.5 items-center mt-2">
          <input id="guide-add-dir" className="input text-xs flex-1 min-w-56" placeholder="如 D:\Git\github\JavaGuide,绝对路径…"
            value={addDraft} onChange={(e) => setAddDraft(e.target.value)} />
          <button className="accent-btn text-xs px-2 py-1" onClick={() => void addDir()} disabled={!addDraft.trim()}>添加</button>
        </div>
      </details>

      {error && <div className="text-xs mb-3" style={{ color: "var(--danger)" }}>{error}</div>}
      {notice && <div className="text-xs mb-3" style={{ color: "var(--accent)" }}>{notice}</div>}

      {/* 三栏:文件夹树 | 文章列表(含导出/问答) | 阅读详情 */}
      <div className="flex gap-3 items-start">
        {/* 左:文件夹树 */}
        <div className="surface p-2 w-56 shrink-0 max-h-[70vh] overflow-y-auto hidden md:block">
          <div className="text-xs font-medium mb-1.5 px-1">📁 分类目录</div>
          {tree.map((node) => (
            <div key={node.name}>
              <button
                className={`w-full text-left text-xs px-2 py-1.5 rounded flex items-center gap-1 ${cat === node.path || node.path === "" ? "" : ""}`}
                style={cat === node.path ? { background: "var(--surface-2)", color: "var(--accent)" } : node.path === "" ? { color: "var(--muted)" } : undefined}
                onClick={() => { setCat(node.path === "" ? "" : node.name); setFolder(""); }}
              >
                <span className="truncate flex-1">{node.label}</span>
                {node.path !== "" && <span style={{ color: "var(--muted)" }}>{node.count}</span>}
              </button>
              {node.path !== "" && cat === node.name && node.children.length > 0 && (
                <div style={{ borderLeft: "1px solid var(--border)", marginLeft: 12 }}>
                  {node.children.map((ch) => (
                    <button key={ch.name}
                      className="w-full text-left text-xs px-2 py-1 truncate"
                      style={folder === ch.name ? { color: "var(--accent)" } : { color: "var(--muted)" }}
                      onClick={() => setFolder(folder === ch.name ? "" : ch.name)}
                      title={ch.label}>
                      {ch.label} {ch.count}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 中:文章列表 + 操作 + 问答 */}
        <div className="flex-1 min-w-0">
          <div className="surface p-3 mb-3">
            <div className="flex flex-wrap gap-1.5 items-center">
              <span className="text-xs" style={{ color: "var(--muted)" }}>{entries.length} 篇{selected.size > 0 ? ` · 已选 ${selected.size}` : ""}</span>
              <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>导出 / 同步(未选择=全部):</span>
              <button className="ghost-btn text-xs px-2 py-1" onClick={() => void doExport("obsidian")} disabled={!!exporting || entries.length === 0}>同步 Obsidian</button>
              <button className="ghost-btn text-xs px-2 py-1" onClick={() => void doExport("md")} disabled={!!exporting || entries.length === 0}>md zip</button>
              <button className="ghost-btn text-xs px-2 py-1" onClick={() => void doExport("html")} disabled={!!exporting || entries.length === 0}>离线 HTML</button>
              {selected.size > 0 && <button className="ghost-btn text-xs px-1.5 py-1" onClick={() => setSelected(new Set())}>取消</button>}
            </div>
          </div>

          {/* AI 问答(对宝典全文) */}
          <div className="surface p-3 mb-3">
            <div className="flex flex-wrap gap-1.5 items-center mb-1">
              <span className="text-xs font-medium">💬 问宝典</span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>AI 基于全文检索回答,附引用</span>
            </div>
            <div className="flex gap-1.5">
              <input className="input text-xs flex-1" placeholder="例:HashMap 在 JDK8 做了哪些改动?"
                value={qaQ} onChange={(e) => setQaQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void askQa(); }} disabled={qaBusy} />
              <button className="accent-btn text-xs px-3" onClick={() => void askQa()} disabled={qaBusy || !qaQ.trim()}>
                {qaBusy ? "检索+思考中…" : "提问"}
              </button>
            </div>
            {qaError && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{qaError}</div>}
            {qa && (
              <div className="rounded p-2 mt-2 text-xs" style={{ border: "1px solid var(--border)" }}>
                <div className="whitespace-pre-wrap mb-1.5">{qa.answer}</div>
                {qa.refs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {qa.refs.map((r) => (
                      <button key={r} className="ghost-btn text-xs px-1.5 py-0.5" onClick={() => void openDoc(r)} title={r}>
                        📄 {r.split("/").pop()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {loading && <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>扫描中…</div>}

          {entries.length > 0 ? (
            <div className="surface p-2 max-h-[52vh] overflow-y-auto">
              {entries.map((e) => (
                <div key={e.relPath} className="flex items-center gap-2 text-xs px-1 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                  <input type="checkbox" checked={selected.has(e.relPath)} onChange={() => toggle(e.relPath)} aria-label={`选择 ${e.title}`} />
                  <button className={`font-medium hover:opacity-80 truncate text-left ${e.relPath === reading?.path ? "" : ""}`}
                    style={e.relPath === reading?.path ? { color: "var(--accent)" } : undefined}
                    title={e.relPath} onClick={() => void openDoc(e.relPath)}>
                    {e.title}
                  </button>
                  <span className="truncate flex-1" style={{ color: "var(--muted)" }} title={e.headline}>{e.headline}</span>
                  <span className="shrink-0" style={{ color: "var(--muted)" }}>{fmtSize(e.size)}</span>
                </div>
              ))}
            </div>
          ) : (
            !loading && <div className="surface p-6 text-sm text-center" style={{ color: "var(--muted)" }}>没有匹配的文档。</div>
          )}
        </div>

      </div>

      {/* 阅读弹框:渲染 / 纯 md 编辑 / HTML 效果 三视图切换 */}
      {reading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.55)" }} onClick={() => { setReading(null); setEditMode(false); setDocMaxi(false); }}>
          <div
            className={`surface p-4 flex flex-col overflow-hidden ${docMaxi ? "fixed inset-0 z-[80] rounded-none" : "max-w-5xl w-full max-h-[88vh]"}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-xs truncate flex-1" style={{ color: "var(--muted)" }}>{reading.path}</span>
              <div className="flex gap-1 text-xs">
                <button className={`ghost-btn px-2 py-0.5 ${viewMode === "preview" ? "ring-1" : ""}`} style={viewMode === "preview" ? { color: "var(--accent)" } : undefined} onClick={() => setViewMode("preview")}>预览</button>
                <button className={`ghost-btn px-2 py-0.5 ${viewMode === "edit" ? "ring-1" : ""}`} style={viewMode === "edit" ? { color: "var(--accent)" } : undefined} onClick={() => { if (viewMode !== "edit") { setEditDraft(reading.content); setEditMode(true); setViewMode("edit"); } }}>纯 md 编辑</button>
                <button className={`ghost-btn px-2 py-0.5 ${viewMode === "html" ? "ring-1" : ""}`} style={viewMode === "html" ? { color: "var(--accent)" } : undefined} onClick={() => setViewMode("html")}>HTML 效果</button>
                <button
                  className="ghost-btn px-2 py-0.5"
                  onClick={() => setDocMaxi((v) => !v)}
                  title={docMaxi ? "还原窗口大小(Esc)" : "撑满浏览器(Esc 退出)"}
                >{docMaxi ? "⤡ 还原" : "⤢ 撑满"}</button>
              </div>
              {editMode ? (
                <>
                  <button className="accent-btn text-xs px-2 py-1" onClick={() => void saveDoc()} disabled={savingDoc}>{savingDoc ? "保存中…" : "保存"}</button>
                  <button className="ghost-btn text-xs px-1.5 py-1" onClick={() => { setEditMode(false); setViewMode("preview"); }}>取消</button>
                </>
              ) : (
                <button className="accent-btn text-xs px-2 py-1" onClick={() => { setEditDraft(reading.content); setEditMode(true); setViewMode("edit"); }}>✎ 编辑</button>
              )}
            </div>
            {editMode && viewMode === "edit" ? (
              <textarea className="w-full flex-1 text-xs font-mono p-3 rounded overflow-auto" style={{ background: "var(--surface-2)", minHeight: "50vh", outline: "none", border: "1px solid var(--border)", color: "var(--text)" }}
                value={editDraft} onChange={(e) => setEditDraft(e.target.value)} />
            ) : viewMode === "html" ? (
              <iframe
                title="HTML 预览"
                className="w-full flex-1 rounded"
                style={{ minHeight: "50vh", border: "1px solid var(--border)", background: "#fff" }}
                srcDoc={docToHtml(reading.path.split("/").pop() ?? "doc", editMode ? editDraft : reading.content)}
              />
            ) : (
              <div className="flex-1 min-h-0 overflow-auto text-sm guide-md" dangerouslySetInnerHTML={{ __html: markdownToHtml(editMode ? editDraft : reading.content) }} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
