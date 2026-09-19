"use client";
import { useCallback, useEffect, useState } from "react";

type GuideEntry = { relPath: string; name: string; title: string; category: string; folder: string; size: number; headline: string };
type Category = { name: string; count: number; folders: { name: string; count: number }[] };

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

// 面试宝典:把 JavaGuide 等外部文档库作为只读源挂载——分类树导航、标题/正文搜索、
// 在线阅读、同步到 Obsidian(按分类复制)、导出 md 打包(zip)或单文件离线 HTML。
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

  const loadDirs = useCallback(async () => {
    const res = await fetch("/api/guide");
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

  useEffect(() => {
    const raf = requestAnimationFrame(() => void loadDirs());
    return () => cancelAnimationFrame(raf);
  }, [loadDirs]);

  useEffect(() => {
    if (!dir) return;
    const t = setTimeout(() => { void load(); }, q ? 400 : 0); // 搜索防抖
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
  };

  const toggle = (rel: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(rel)) next.delete(rel); else next.add(rel);
      return next;
    });
  };
  const clearSel = () => setSelected(new Set());

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
        clearSel();
        return;
      }
      if (!res.ok) { setError(errorOf(await res.json().catch(() => null), "导出失败")); return; }
      // 文件下载
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

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">面试宝典</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        把 JavaGuide 等面试文档库挂载为只读知识源:分类导航、全文搜索、在线阅读;
        可同步到 Obsidian、导出 md 打包或单文件离线 HTML。源目录只读,不影响原仓库。
      </p>

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <select className="input text-xs max-w-72" value={dir} onChange={(e) => { setDir(e.target.value); setCat(""); setFolder(""); }} aria-label="选择宝典源">
            {dirs.length === 0 && <option value="">未配置文档源</option>}
            {dirs.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button className="ghost-btn text-xs px-2 py-1" onClick={() => void load()}>重新扫描</button>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <input className="input text-xs flex-1 min-w-56" placeholder="添加文档源目录(如 D:\Git\github\JavaGuide),绝对路径…"
            value={addDraft} onChange={(e) => setAddDraft(e.target.value)} />
          <button className="accent-btn text-xs px-2 py-1" onClick={() => void addDir()} disabled={!addDraft.trim()}>添加</button>
        </div>
      </div>

      {error && <div className="text-xs mb-3" style={{ color: "var(--danger)" }}>{error}</div>}
      {notice && <div className="text-xs mb-3" style={{ color: "var(--accent)" }}>{notice}</div>}

      {categories.length > 0 && (
        <div className="surface p-3 mb-4">
          <div className="flex flex-wrap gap-1.5 mb-2">
            <button className={`ghost-btn text-xs ${cat === "" ? "ring-1" : ""}`} style={cat === "" ? { color: "var(--accent)" } : undefined}
              onClick={() => { setCat(""); setFolder(""); }}>全部 {entries.length || ""}</button>
            {categories.map((c) => (
              <button key={c.name} className={`ghost-btn text-xs ${cat === c.name ? "ring-1" : ""}`}
                style={cat === c.name ? { color: "var(--accent)" } : undefined}
                onClick={() => { setCat(cat === c.name ? "" : c.name); setFolder(""); }}>
                {c.name} {c.count}
              </button>
            ))}
          </div>
          {cat && categories.find((c) => c.name === cat)?.folders.length ? (
            <div className="flex flex-wrap gap-1.5">
              <button className={`ghost-btn text-xs ${folder === "" ? "ring-1" : ""}`} style={folder === "" ? { color: "var(--accent)" } : undefined} onClick={() => setFolder("")}>全部子目录</button>
              {categories.find((c) => c.name === cat)!.folders.map((f) => (
                <button key={f.name} className={`ghost-btn text-xs ${folder === f.name ? "ring-1" : ""}`}
                  style={folder === f.name ? { color: "var(--accent)" } : undefined} onClick={() => setFolder(folder === f.name ? "" : f.name)}>
                  {f.name} {f.count}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <input className="input text-sm flex-1 min-w-48" placeholder="搜索标题 / 正文关键字…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>{entries.length} 篇{selected.size > 0 ? ` · 已选 ${selected.size}` : ""}</span>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-xs" style={{ color: "var(--muted)" }}>导出:</span>
          <button className="ghost-btn text-xs px-2 py-1" onClick={() => void doExport("obsidian")} disabled={!!exporting || entries.length === 0}>同步到 Obsidian</button>
          <button className="ghost-btn text-xs px-2 py-1" onClick={() => void doExport("md")} disabled={!!exporting || entries.length === 0}>导出 md(zip)</button>
          <button className="ghost-btn text-xs px-2 py-1" onClick={() => void doExport("html")} disabled={!!exporting || entries.length === 0}>导出离线 HTML</button>
          {selected.size > 0 && <button className="ghost-btn text-xs px-2 py-1" onClick={clearSel}>取消选择({selected.size})</button>}
          <span className="text-xs" style={{ color: "var(--muted)" }}>未选择时导出全部</span>
        </div>
      </div>

      {loading && <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>扫描中…</div>}

      {entries.length > 0 && (
        <div className="surface p-3">
          <div className="max-h-[60vh] overflow-y-auto">
            {entries.map((e) => (
              <div key={e.relPath} className="flex items-center gap-2 text-xs px-1 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <input type="checkbox" checked={selected.has(e.relPath)} onChange={() => toggle(e.relPath)} aria-label={`选择 ${e.title}`} />
                <span className="px-1.5 rounded shrink-0" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{e.category}</span>
                <button className="font-medium hover:opacity-80 truncate text-left" style={{ maxWidth: 320 }} title={e.headline || e.relPath} onClick={() => void openDoc(e.relPath)}>
                  {e.title}
                </button>
                <span className="truncate flex-1" style={{ color: "var(--muted)" }} title={e.headline}>{e.headline}</span>
                <span className="shrink-0" style={{ color: "var(--muted)" }}>{fmtSize(e.size)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {reading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-6" style={{ background: "rgba(0,0,0,.5)" }} onClick={() => setReading(null)}>
          <div className="surface p-4 max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium truncate">{reading.path}</span>
              <button className="ghost-btn text-xs px-2 py-1 ml-auto" onClick={() => setReading(null)}>关闭</button>
            </div>
            <pre className="text-sm whitespace-pre-wrap overflow-auto m-0" style={{ fontFamily: "inherit", maxHeight: "70vh" }}>{reading.content}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
