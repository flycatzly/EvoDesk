"use client";
import { useCallback, useEffect, useState } from "react";

type LibraryEntry = { relPath: string; name: string; category: string; size: number; mtime: string; isText: boolean };
type VaultMeta = Record<string, { summary: string; tags: string[]; at: string }>;

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** 失败提示:服务端业务文案优先 */
function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

// 资料库总览(多根):Obsidian / Apifox 导出 / myBase 目录等统一纳入——
// 按扩展智能分类统计、点分类筛选浏览、AI 内容补充(摘要+标签)、备份清单导出。
// 新增资料库目录写入 settings.vault_roots(白名单),路径越界一律由服务端拒绝。
export function VaultLibraries() {
  const [roots, setRoots] = useState<string[]>([]);
  const [root, setRoot] = useState("");
  const [stats, setStats] = useState<Record<string, number>>({});
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [cat, setCat] = useState("");
  const [meta, setMeta] = useState<VaultMeta>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addDraft, setAddDraft] = useState("");
  const [viewing, setViewing] = useState<{ path: string; text: string } | null>(null);
  const [summarizing, setSummarizing] = useState<string | null>(null);

  const loadRoots = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = (await res.json()) as { settings?: Record<string, unknown> };
    // 服务端 roots 以 /api/vault/index 的校验为准;这里仅取 vault_path 显示
    const vp = data.settings?.vault_path;
    const vr = data.settings?.vault_roots;
    const list = [
      ...(typeof vp === "string" && vp ? [vp] : []),
      ...(Array.isArray(vr) ? vr.filter((x): x is string => typeof x === "string") : []),
    ];
    setRoots(list);
    setRoot((r) => r || list[0] || "");
  }, []);

  const loadIndex = useCallback(async (target: string, category: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ ...(target ? { root: target } : {}), ...(category ? { cat: category } : {}) });
      const res = await fetch(`/api/vault/index?${qs}`);
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "索引加载失败"));
        setEntries([]);
        setStats({});
        return;
      }
      const d = data as { root: string; stats: Record<string, number>; entries: LibraryEntry[]; truncated: boolean };
      setEntries(d.entries ?? []);
      setStats(d.stats ?? {});
      setTruncated(!!d.truncated);
    } catch {
      setError("索引请求失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/vault/summarize");
      const data = (await res.json()) as { meta?: VaultMeta };
      setMeta(data.meta ?? {});
    } catch { /* 元数据读取失败不阻塞 */ }
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { void loadRoots(); void loadMeta(); });
    return () => cancelAnimationFrame(raf);
  }, [loadRoots, loadMeta]);

  useEffect(() => {
    if (!root) return;
    // rAF 包裹:避免 effect 内同步 setState(react-hooks/set-state-in-effect)
    const raf = requestAnimationFrame(() => { void loadIndex(root, cat); });
    return () => cancelAnimationFrame(raf);
  }, [root, cat, loadIndex]);

  const addRoot = async () => {
    const dir = addDraft.trim();
    if (!dir) return;
    setError(null);
    try {
      const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ vault_roots: [...roots.filter((r) => r !== dir), dir] }) });
      if (!res.ok) {
        setError("保存失败");
        return;
      }
      setAddDraft("");
      setNotice(`已添加资料库:${dir}`);
      await loadRoots();
    } catch {
      setError("保存请求失败");
    }
  };

  const openFile = async (rel: string, isText: boolean) => {
    if (!isText) {
      setNotice("二进制/不可读文件仅展示元数据(如 myBase 的 .nyf 内部格式不解析)。");
      return;
    }
    setError(null);
    try {
      const qs = new URLSearchParams({ path: rel, ...(root ? { root } : {}) });
      const res = await fetch(`/api/vault/file?${qs}`);
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "文件读取失败"));
        return;
      }
      setViewing({ path: rel, text: (data as { content?: string }).content ?? "" });
    } catch {
      setError("文件请求失败");
    }
  };

  const summarize = async (rel: string) => {
    if (summarizing) return;
    setSummarizing(rel);
    setError(null);
    try {
      const res = await fetch("/api/vault/summarize", { method: "POST", body: JSON.stringify({ root, path: rel }) });
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "AI 摘要失败"));
        return;
      }
      await loadMeta();
      setNotice(`已生成摘要:${rel}`);
    } catch {
      setError("AI 摘要请求失败");
    } finally {
      setSummarizing(null);
    }
  };

  const absKey = (rel: string) => (root ? `${root.replace(/[\\/]+$/, "")}\\${rel.replace(/\//g, "\\")}` : rel);
  const metaOf = (rel: string) => meta[absKey(rel)] ?? meta[`${root ? root.replace(/[\\/]+$/, "") : ""}/${rel}`];

  return (
    <div className="surface p-3 mb-4">
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <span className="text-sm font-medium">📚 资料库总览</span>
        <select className="input text-xs max-w-64" value={root} onChange={(e) => { setRoot(e.target.value); setCat(""); }} aria-label="切换资料库">
          {roots.length === 0 && <option value="">未配置资料库</option>}
          {roots.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <a className="ghost-btn text-xs px-2 py-1" href={`/api/vault/backup${root ? `?root=${encodeURIComponent(root)}` : ""}`} download>备份清单(JSON)</a>
        <button className="ghost-btn text-xs px-2 py-1" onClick={() => void loadIndex(root, cat)}>重新扫描</button>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center mb-2">
        <button className={`ghost-btn text-xs ${cat === "" ? "ring-1" : ""}`} style={cat === "" ? { color: "var(--accent)" } : undefined} onClick={() => setCat("")}>全部</button>
        {Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
          <button key={c} className={`ghost-btn text-xs ${cat === c ? "ring-1" : ""}`} style={cat === c ? { color: "var(--accent)" } : undefined} onClick={() => setCat(c)}>
            {c} {n}
          </button>
        ))}
        {Object.keys(stats).length === 0 && !loading && <span className="text-xs" style={{ color: "var(--muted)" }}>暂无文件</span>}
        {truncated && <span className="text-xs" style={{ color: "var(--warn)" }}>⚠ 文件过多,仅显示前一部分</span>}
      </div>
      <div className="flex flex-wrap gap-1.5 items-center mb-2">
        <input className="input text-xs flex-1 min-w-56" placeholder="添加资料库目录(如 Apifox 导出目录、myBase 文档目录),绝对路径…"
          value={addDraft} onChange={(e) => setAddDraft(e.target.value)} />
        <button className="accent-btn text-xs px-2 py-1" onClick={() => void addRoot()} disabled={!addDraft.trim()}>添加</button>
        <span className="text-xs" style={{ color: "var(--muted)" }}>支持任意目录:全部 md/文本可读,Apifox/myBase 导出文件按类型智能分类</span>
      </div>
      {error && <div className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</div>}
      {notice && <div className="text-xs mb-2" style={{ color: "var(--accent)" }}>{notice}</div>}
      {loading && <div className="text-xs" style={{ color: "var(--muted)" }}>索引中…</div>}

      {entries.length > 0 && (
        <div className="max-h-80 overflow-y-auto rounded" style={{ border: "1px solid var(--border)" }}>
          {entries.map((e) => {
            const m = metaOf(e.relPath);
            return (
              <div key={e.relPath} className="flex flex-wrap items-center gap-2 text-xs px-2 py-1.5" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{e.category}</span>
                <button className="font-medium hover:opacity-80 truncate max-w-72 text-left" title={e.relPath} onClick={() => void openFile(e.relPath, e.isText)}>
                  {e.name}
                </button>
                <span style={{ color: "var(--muted)" }}>{fmtSize(e.size)}</span>
                {m && <span className="truncate" style={{ color: "var(--muted)" }} title={m.summary}>🤖 {m.summary}{m.tags.length > 0 ? ` · ${m.tags.join("/")}` : ""}</span>}
                <span className="ml-auto flex gap-1.5">
                  {e.isText && (
                    <button className="ghost-btn text-xs px-1.5 py-0.5" onClick={() => void summarize(e.relPath)} disabled={summarizing === e.relPath}>
                      {summarizing === e.relPath ? "摘要中…" : "AI 摘要"}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {viewing && (
        <div className="mt-2 rounded p-2" style={{ border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium truncate">{viewing.path}</span>
            <button className="ghost-btn text-xs px-1.5 py-0.5 ml-auto" onClick={() => setViewing(null)}>关闭</button>
          </div>
          <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-y-auto m-0" style={{ fontFamily: "inherit" }}>{viewing.text}</pre>
        </div>
      )}
    </div>
  );
}
