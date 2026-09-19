"use client";
import { useCallback, useEffect, useMemo, useState } from "react";

type GuideEntry = { relPath: string; name: string; title: string; category: string; folder: string; size: number; headline: string };
type Category = { name: string; count: number; folders: { name: string; count: number }[] };

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

/** 简易 md 渲染(阅读面板):标题/粗体/行内代码/代码块/列表/引用/链接 */
function renderMd(md: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    escape(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const out: string[] = [];
  let inCode = false;
  let inList = false;
  let inQuote = false;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (line.startsWith("```")) {
      if (inCode) { out.push("</code></pre>"); inCode = false; }
      else { if (inList) { out.push("</ul>"); inList = false; } if (inQuote) { out.push("</blockquote>"); inQuote = false; } out.push('<pre><code>'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escape(raw)); continue; }
    if (/^>\s?/.test(line)) {
      if (!inQuote) { out.push("<blockquote>"); inQuote = true; }
      out.push(inline(line.replace(/^>\s?/, "")));
      continue;
    }
    if (inQuote) { out.push("</blockquote>"); inQuote = false; }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); continue; }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.replace(/^\s*(?:[-*]|\d+\.)\s+/, ""))}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    if (!line.trim()) continue;
    out.push(`<p>${inline(line)}</p>`);
  }
  if (inList) out.push("</ul>");
  if (inQuote) out.push("</blockquote>");
  if (inCode) out.push("</code></pre>");
  return out.join("\n");
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
    } catch {
      setError("读取请求失败");
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

        {/* 右:阅读详情(桌面端常驻;移动端为弹层) */}
        <div className="surface p-4 w-[46%] shrink-0 max-h-[78vh] overflow-auto hidden lg:block sticky top-4">
          {reading ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs truncate" style={{ color: "var(--muted)" }}>{reading.path}</span>
                <button className="ghost-btn text-xs px-1.5 py-0.5 ml-auto" onClick={() => setReading(null)}>✕</button>
              </div>
              <div className="text-sm guide-md" dangerouslySetInnerHTML={{ __html: renderMd(reading.content) }} />
            </>
          ) : (
            <div className="text-sm text-center py-16" style={{ color: "var(--muted)" }}>
              点击左侧文章标题查看详情。<br />
              <span className="text-xs">支持搜索、勾选导出、AI 问答。</span>
            </div>
          )}
        </div>
      </div>

      {/* 移动端阅读弹层 */}
      {reading && (
        <div className="lg:hidden fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,.5)" }} onClick={() => setReading(null)}>
          <div className="surface p-4 max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium truncate">{reading.path}</span>
              <button className="ghost-btn text-xs px-1.5 py-0.5 ml-auto" onClick={() => setReading(null)}>✕</button>
            </div>
            <div className="overflow-auto text-sm guide-md" dangerouslySetInnerHTML={{ __html: renderMd(reading.content) }} />
          </div>
        </div>
      )}
    </div>
  );
}
