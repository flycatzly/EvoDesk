"use client";
import { useCallback, useEffect, useState } from "react";

type LinkRow = { id: string; title: string; url: string; category: string; sort: number };
type BookmarkProfileMeta = { browser: string; profileName: string; bookmarksPath: string; count: number; folders: string[] };

const EMPTY_FORM = { title: "", url: "", category: "", sort: 0 };

// 常用链接管理:分类分组展示、行内编辑、删除、新增(替代浏览器收藏夹);
// 支持读取 Chrome/Edge 本地收藏夹一键导入、导出书签 HTML
export function LinksView() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Record<string, Partial<LinkRow>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 浏览器收藏夹导入
  const [bmProfiles, setBmProfiles] = useState<BookmarkProfileMeta[] | null>(null);
  const [bmScanning, setBmScanning] = useState(false);
  const [bmFolders, setBmFolders] = useState<Record<string, boolean>>({});
  const [bmMsg, setBmMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/links");
      const data = (await res.json()) as { links?: LinkRow[] };
      setLinks(data.links ?? []);
    } catch {
      setError("加载失败,请刷新重试");
    } finally {
      setLoading(false);
    }
  }, []);
  // 下一帧加载:避免 effect 内同步 setState(react-hooks/set-state-in-effect)
  useEffect(() => {
    const raf = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const categories = [...new Set(links.map((l) => l.category))];
  const shown = filter ? links.filter((l) => l.category === filter) : links;
  const byCat = new Map<string, LinkRow[]>();
  for (const l of shown) {
    const list = byCat.get(l.category) ?? [];
    list.push(l);
    byCat.set(l.category, list);
  }

  const add = async () => {
    setError(null);
    const res = await fetch("/api/links", { method: "POST", body: JSON.stringify({ ...form, sort: Number(form.sort) || 0 }) });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "添加失败");
      return;
    }
    setForm(EMPTY_FORM);
    void load();
  };
  const patch = async (id: string, body: Partial<LinkRow>) => {
    const res = await fetch(`/api/links/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!res.ok) setError("保存失败");
    else { setEditing((e) => { const n = { ...e }; delete n[id]; return n; }); void load(); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("删除该链接?")) return;
    await fetch(`/api/links/${id}`, { method: "DELETE" });
    void load();
  };

  // —— 浏览器收藏夹:读取 → 勾选目录 → 导入;导出书签 HTML ——
  const scanBookmarks = async () => {
    setBmScanning(true);
    setBmMsg(null);
    try {
      const res = await fetch("/api/links/bookmarks");
      const data = (await res.json()) as { profiles?: BookmarkProfileMeta[] };
      setBmProfiles(data.profiles ?? []);
      if ((data.profiles ?? []).length === 0) setBmMsg("未找到 Chrome/Edge 收藏夹(浏览器是否安装?)");
    } catch {
      setBmMsg("读取收藏夹失败");
    } finally {
      setBmScanning(false);
    }
  };
  const importBookmarks = async (profile: BookmarkProfileMeta) => {
    setBmMsg(null);
    const folders = Object.entries(bmFolders).filter(([k, v]) => v && k.startsWith(profile.bookmarksPath)).map(([k]) => k.slice(profile.bookmarksPath.length + 2));
    try {
      const res = await fetch("/api/links/import-bookmarks", {
        method: "POST",
        body: JSON.stringify({ bookmarksPath: profile.bookmarksPath, folders }),
      });
      const data = (await res.json()) as { added?: number; skipped?: number; error?: string };
      if (!res.ok) {
        setBmMsg(data.error ?? "导入失败");
        return;
      }
      setBmMsg(`导入完成:新增 ${data.added} 条,跳过重复 ${data.skipped} 条`);
      void load();
    } catch {
      setBmMsg("导入请求失败");
    }
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">常用链接</h1>
      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <input className="input text-sm flex-1 min-w-32" placeholder="名称" value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input text-sm flex-[2] min-w-48" placeholder="https://…" value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })} />
          <input className="input text-sm w-28" placeholder="分类(默认常用)" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })} />
          <button className="accent-btn text-xs" onClick={() => void add()} disabled={!form.title.trim() || !form.url.trim()}>添加</button>
        </div>
        {error && <div className="text-xs mt-2" style={{ color: "var(--danger)" }}>{error}</div>}
      </div>

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-1">
          <span className="text-sm font-medium">🌐 浏览器收藏夹</span>
          <button className="accent-btn text-xs px-2 py-1" onClick={() => void scanBookmarks()} disabled={bmScanning}>
            {bmScanning ? "读取中…" : bmProfiles === null ? "读取 Chrome/Edge 收藏夹" : "重新读取"}
          </button>
          {/* API 路由文件下载(attachment),需原生 <a download>,非页面导航 */}
          <a className="ghost-btn text-xs px-2 py-1" href="/api/links/export-bookmarks" download>导出书签 HTML(可导入浏览器)</a>
          {bmMsg && <span className="text-xs" style={{ color: "var(--accent)" }}>{bmMsg}</span>}
        </div>
        {bmProfiles !== null && bmProfiles.length > 0 && (
          <div className="space-y-2">
            {bmProfiles.map((p) => {
              const pathKey = (f: string) => `${p.bookmarksPath}||${f}`;
              const anyCheckedInProfile = p.folders.some((f) => bmFolders[pathKey(f)]);
              return (
                <div key={p.bookmarksPath} className="rounded p-2" style={{ border: "1px solid var(--border)" }}>
                  <div className="flex flex-wrap items-center gap-2 text-sm mb-1">
                    <span className="font-medium">{p.browser} · {p.profileName}</span>
                    <span className="text-xs" style={{ color: "var(--muted)" }}>{p.count} 条收藏</span>
                    <label className="text-xs flex items-center gap-1" style={{ color: "var(--muted)" }}>
                      <input
                        type="checkbox"
                        checked={p.folders.length > 0 && p.folders.every((f) => bmFolders[pathKey(f)])}
                        onChange={(e) => {
                          const next = { ...bmFolders };
                          for (const f of p.folders) next[pathKey(f)] = e.target.checked;
                          setBmFolders(next);
                        }}
                      />
                      全选
                    </label>
                    <button className="accent-btn text-xs px-2 py-1 ml-auto" onClick={() => void importBookmarks(p)} disabled={!anyCheckedInProfile && p.folders.length > 0}>
                      导入所选目录
                    </button>
                  </div>
                  {p.folders.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.folders.map((f) => (
                        <label key={f} className="text-xs px-2 py-0.5 rounded flex items-center gap-1 cursor-pointer" style={{ background: "var(--surface-2)" }}>
                          <input
                            type="checkbox"
                            checked={!!bmFolders[pathKey(f)]}
                            onChange={(e) => setBmFolders({ ...bmFolders, [pathKey(f)]: e.target.checked })}
                          />
                          {f}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {categories.length > 1 && (
        <div className="flex gap-1.5 mb-3 flex-wrap">
          <button className={`ghost-btn text-xs ${filter === "" ? "ring-1" : ""}`} style={filter === "" ? { color: "var(--accent)" } : undefined} onClick={() => setFilter("")}>全部</button>
          {categories.map((c) => (
            <button key={c} className="ghost-btn text-xs" style={filter === c ? { color: "var(--accent)" } : undefined} onClick={() => setFilter(c)}>{c}</button>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: "var(--muted)" }}>加载中…</div>
      ) : links.length === 0 ? (
        <div className="surface p-6 text-sm text-center" style={{ color: "var(--muted)" }}>还没有链接,在上面添加第一条。</div>
      ) : (
        [...byCat.entries()].map(([cat, ls]) => (
          <section key={cat} className="mb-4">
            <h2 className="font-semibold text-sm mb-2">{cat}</h2>
            <div className="space-y-1.5">
              {ls.map((l) => {
                const e = editing[l.id];
                return (
                  <div key={l.id} className="surface p-2.5 flex flex-wrap items-center gap-2 text-sm">
                    {e ? (
                      <>
                        <input className="input text-sm flex-1 min-w-28" value={e.title ?? l.title}
                          onChange={(ev) => setEditing({ ...editing, [l.id]: { ...e, title: ev.target.value } })} />
                        <input className="input text-sm flex-[2] min-w-44" value={e.url ?? l.url}
                          onChange={(ev) => setEditing({ ...editing, [l.id]: { ...e, url: ev.target.value } })} />
                        <input className="input text-sm w-24" value={e.category ?? l.category}
                          onChange={(ev) => setEditing({ ...editing, [l.id]: { ...e, category: ev.target.value } })} />
                        <input className="input text-sm w-14" type="number" value={e.sort ?? l.sort}
                          onChange={(ev) => setEditing({ ...editing, [l.id]: { ...e, sort: Number(ev.target.value) } })} />
                        <button className="accent-btn text-xs" onClick={() => void patch(l.id, e)}>保存</button>
                        <button className="ghost-btn text-xs" onClick={() => setEditing((x) => { const n = { ...x }; delete n[l.id]; return n; })}>取消</button>
                      </>
                    ) : (
                      <>
                        <a href={l.url} target="_blank" rel="noreferrer" className="font-medium hover:opacity-80 flex-1 truncate">{l.title} ↗</a>
                        <span className="text-xs truncate max-w-48" style={{ color: "var(--muted)" }}>{l.url}</span>
                        <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>#{l.sort}</span>
                        <button className="ghost-btn text-xs" onClick={() => setEditing({ ...editing, [l.id]: {} })}>编辑</button>
                        <button className="ghost-btn text-xs" style={{ color: "var(--danger)" }} onClick={() => void remove(l.id)}>删除</button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
