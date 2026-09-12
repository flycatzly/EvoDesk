"use client";
import { useCallback, useEffect, useState } from "react";

type LinkRow = { id: string; title: string; url: string; category: string; sort: number };
type BookmarkProfileMeta = { browser: string; profileName: string; bookmarksPath: string; count: number; folders: string[] };

const EMPTY_FORM = { title: "", url: "", category: "", sort: 0 };
// 分类筛选条默认展示个数,超出折叠进「更多」(浏览器书签全量导入后分类可达上百个)
const CHIP_LIMIT = 14;
// 分类少时默认全部展开,多时默认收起(点分类标题展开)
const AUTO_OPEN_CATEGORIES = 8;

// 常用链接管理:分类分组展示、行内编辑、删除、新增、分类重命名、关键字搜索(替代浏览器收藏夹);
// 支持读取 Chrome/Edge 本地收藏夹一键导入、导出书签 HTML
export function LinksView() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [q, setQ] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Record<string, Partial<LinkRow>>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 分类折叠:null = 未手动操作,按分类数默认(少展开/多收起)
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  // 分类行内重命名
  const [renaming, setRenaming] = useState<{ from: string; draft: string } | null>(null);
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
  const searching = q.trim().length > 0;
  const needle = q.trim().toLowerCase();
  const shown = links
    .filter((l) => (filter ? l.category === filter : true))
    .filter((l) =>
      searching
        ? l.title.toLowerCase().includes(needle) || l.url.toLowerCase().includes(needle) || l.category.toLowerCase().includes(needle)
        : true
    );
  const byCat = new Map<string, LinkRow[]>();
  for (const l of shown) {
    const list = byCat.get(l.category) ?? [];
    list.push(l);
    byCat.set(l.category, list);
  }
  const defaultOpen = categories.length <= AUTO_OPEN_CATEGORIES;
  const isOpen = (cat: string) => {
    if (searching) return true;
    if (expanded === null) return defaultOpen;
    return expanded.has(cat);
  };
  const toggleCat = (cat: string) => {
    const base = expanded ?? (defaultOpen ? new Set(categories) : new Set<string>());
    const next = new Set(base);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setExpanded(next);
  };
  const renameCategory = async (from: string, to: string) => {
    setError(null);
    setNotice(null);
    if (!to.trim() || to.trim() === from) { setRenaming(null); return; }
    const res = await fetch("/api/links/rename-category", { method: "POST", body: JSON.stringify({ from, to: to.trim() }) });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error ?? "重命名失败");
      return;
    }
    const updated = ((await res.json()) as { updated: number }).updated;
    if (filter === from) setFilter(to.trim());
    setExpanded((e) => (e === null ? e : new Set([...e].map((c) => (c === from ? to.trim() : c)))));
    setNotice(`已把 ${updated} 条链接从「${from}」改到「${to.trim()}」`);
    setRenaming(null);
    void load();
  };

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

  const chipCats = chipsExpanded ? categories : categories.slice(0, CHIP_LIMIT);
  const hiddenChips = categories.length - chipCats.length;

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
        {notice && <div className="text-xs mt-2" style={{ color: "var(--accent)" }}>{notice}</div>}
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

      <div className="flex flex-wrap gap-2 items-center mb-3">
        <input className="input text-sm flex-1 min-w-48" placeholder="搜索名称 / 链接 / 分类…" value={q}
          onChange={(e) => setQ(e.target.value)} />
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {loading ? "" : `共 ${links.length} 条 · ${categories.length} 个分类`}
        </span>
      </div>

      {categories.length > 1 && (
        <div className="flex gap-1.5 mb-3 flex-wrap items-center">
          <button className={`ghost-btn text-xs ${filter === "" ? "ring-1" : ""}`} style={filter === "" ? { color: "var(--accent)" } : undefined} onClick={() => setFilter("")}>全部</button>
          {chipCats.map((c) => (
            <button key={c} className={`ghost-btn text-xs ${filter === c ? "ring-1" : ""}`} style={filter === c ? { color: "var(--accent)" } : undefined} onClick={() => setFilter(c)}>{c}</button>
          ))}
          {hiddenChips > 0 && (
            <button className="ghost-btn text-xs" style={{ color: "var(--muted)" }} onClick={() => setChipsExpanded((v) => !v)}>
              {chipsExpanded ? "收起分类 ▴" : `更多 ${hiddenChips} 个分类 ▾`}
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-sm" style={{ color: "var(--muted)" }}>加载中…</div>
      ) : shown.length === 0 ? (
        <div className="surface p-6 text-sm text-center" style={{ color: "var(--muted)" }}>
          {searching || filter ? "没有匹配的链接,换个关键词或分类试试。" : "还没有链接,在上面添加第一条。"}
        </div>
      ) : (
        [...byCat.entries()].map(([cat, ls]) => (
          <section key={cat} className="mb-2">
            <div className="flex items-center gap-2 py-2">
              {renaming?.from === cat ? (
                <>
                  <input className="input text-sm w-44" value={renaming.draft} autoFocus
                    onChange={(e) => setRenaming({ ...renaming, draft: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") void renameCategory(cat, renaming.draft); if (e.key === "Escape") setRenaming(null); }} />
                  <button className="accent-btn text-xs" onClick={() => void renameCategory(cat, renaming.draft)}>保存</button>
                  <button className="ghost-btn text-xs" onClick={() => setRenaming(null)}>取消</button>
                </>
              ) : (
                <>
                  <h2 className="font-semibold text-sm">
                    <button className="inline-flex items-center gap-2 cursor-pointer hover:opacity-80" onClick={() => toggleCat(cat)} aria-expanded={isOpen(cat)}>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>{isOpen(cat) ? "▾" : "▸"}</span>
                      {cat}
                    </button>
                  </h2>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{ls.length} 条</span>
                  <button
                    className="ghost-btn text-xs px-1.5 py-0.5 ml-auto"
                    onClick={() => { setError(null); setNotice(null); setRenaming({ from: cat, draft: cat }); }}
                    title="批量修改该分类下所有链接的分类名(用于整理导入的杂乱分类)"
                  >
                    ✎ 重命名
                  </button>
                </>
              )}
            </div>
            {isOpen(cat) && (
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
            )}
          </section>
        ))
      )}
    </div>
  );
}
