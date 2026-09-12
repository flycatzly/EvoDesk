"use client";
import { useCallback, useEffect, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from "@dnd-kit/core";

type LinkRow = { id: string; title: string; url: string; category: string; sort: number };
type BookmarkProfileMeta = { browser: string; profileName: string; bookmarksPath: string; count: number; folders: string[] };
type OrganizePreview = {
  auto: { id: string; title: string; from: string; to: string }[];
  renames: { from: string; to: string; reason: string; count: number }[];
  duplicateGroups: { key: string; links: { id: string; title: string; category: string }[] }[];
};

const EMPTY_FORM = { title: "", url: "", category: "", sort: 0 };
// 分类筛选条默认展示个数,超出折叠进「更多」(浏览器书签全量导入后分类可达上百个)
const CHIP_LIMIT = 14;
// 分类少时默认全部展开,多时默认收起(点分类标题展开)
const AUTO_OPEN_CATEGORIES = 8;

// 常用链接管理:分类分组、行内编辑、分类重命名、关键字搜索、拖拽移动目录、
// 智能整理(自动分类/归纳合并/去重,先预览后应用)、浏览器收藏夹导入与书签/JSON 导出
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
  // 智能整理
  const [orgOpen, setOrgOpen] = useState(false);
  const [orgLoading, setOrgLoading] = useState(false);
  const [org, setOrg] = useState<OrganizePreview | null>(null);
  const [orgPick, setOrgPick] = useState({ auto: new Set<string>(), renames: new Set<string>(), dups: new Set<string>() });
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

  const flash = (msg: string) => setNotice(msg);

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

  // —— 拖拽移动目录:拖链接行到目标分类标题/分组上 ——
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const moveLinkTo = async (id: string, toCategory: string) => {
    const link = links.find((l) => l.id === id);
    if (!link || link.category === toCategory) return;
    const res = await fetch(`/api/links/${id}`, { method: "PATCH", body: JSON.stringify({ category: toCategory }) });
    if (res.ok) { flash(`「${link.title}」已移到「${toCategory}」`); void load(); }
    else setError("移动失败");
  };
  const onDragEnd = (e: DragEndEvent) => {
    const activeId = String(e.active.id);
    if (!activeId.startsWith("link:") || e.over === null) return;
    const overId = String(e.over.id);
    const linkId = activeId.slice(5);
    if (overId.startsWith("cat:")) void moveLinkTo(linkId, overId.slice(4));
    else if (overId.startsWith("link:")) {
      const target = links.find((l) => l.id === overId.slice(5));
      if (target) void moveLinkTo(linkId, target.category);
    }
  };

  // —— 智能整理:预览(自动分类/归纳合并/去重)→ 勾选应用 ——
  const runPreview = async () => {
    setOrgLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/links/organize", { method: "POST", body: JSON.stringify({ action: "preview" }) });
      const data = (await res.json()) as OrganizePreview;
      setOrg(data);
      setOrgPick({
        auto: new Set(data.auto.map((a) => a.id)),
        renames: new Set(data.renames.map((r) => `${r.from}→${r.to}`)),
        dups: new Set(data.duplicateGroups.map((g) => g.key)),
      });
      setOrgOpen(true);
    } catch {
      setError("整理预览失败");
    } finally {
      setOrgLoading(false);
    }
  };
  const applyOrganize = async () => {
    if (!org) return;
    setError(null);
    const msgs: string[] = [];
    if (orgPick.auto.size > 0) {
      // 按勾选项逐条 PATCH(auto 接口是全量应用,不支持子集)
      const picks = org.auto.filter((a) => orgPick.auto.has(a.id));
      const results = await Promise.all(picks.map((a) => fetch(`/api/links/${a.id}`, { method: "PATCH", body: JSON.stringify({ category: a.to }) })));
      if (results.every((r) => r.ok)) msgs.push(`自动分类 ${picks.length} 条`);
    }
    if (orgPick.renames.size > 0) {
      const pairs = org.renames.filter((r) => orgPick.renames.has(`${r.from}→${r.to}`)).map((r) => ({ from: r.from, to: r.to }));
      const res = await fetch("/api/links/organize", { method: "POST", body: JSON.stringify({ action: "rename", pairs }) });
      if (res.ok) msgs.push(`归纳合并 ${pairs.length} 组`);
    }
    if (orgPick.dups.size > 0) {
      // 仅删除勾选组的冗余项:逐组调用 dedupe 会动到全部组,故走单条删除(保留每组最早一条)
      const ids: string[] = [];
      for (const g of org.duplicateGroups) {
        if (!orgPick.dups.has(g.key)) continue;
        ids.push(...g.links.slice(1).map((l) => l.id));
      }
      await Promise.all(ids.map((id) => fetch(`/api/links/${id}`, { method: "DELETE" })));
      msgs.push(`去重删除 ${ids.length} 条`);
    }
    setOrg(null);
    setOrgOpen(false);
    if (msgs.length > 0) flash(`整理完成:${msgs.join(",")}`);
    void load();
  };

  // —— 浏览器收藏夹:读取 → 勾选目录 → 导入;导出书签 HTML / 分组 JSON ——
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
          <span className="text-sm font-medium">🪄 目录整理</span>
          <button className="accent-btn text-xs px-2 py-1" onClick={() => void runPreview()} disabled={orgLoading}>
            {orgLoading ? "分析中…" : "🪄 智能整理(自动分类 · 归纳 · 去重)"}
          </button>
          {/* API 路由文件下载(attachment),需原生 <a download>,非页面导航 */}
          <a className="ghost-btn text-xs px-2 py-1" href="/api/links/export-bookmarks" download>导出书签 HTML</a>
          <a className="ghost-btn text-xs px-2 py-1" href="/api/links/export-json" download>导出分组 JSON</a>
          {notice && <span className="text-xs" style={{ color: "var(--accent)" }}>{notice}</span>}
        </div>
        {orgOpen && org && (
          <div className="mt-2 space-y-3 text-sm">
            <OrgSection title={`自动分类(${org.auto.length} 条)`} hint="仅重排 收藏夹/书签栏/已导入 等杂物分类下的链接,按域名与关键词规则">
              {org.auto.length === 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>没有可自动分类的链接。</div>}
              {org.auto.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={orgPick.auto.has(a.id)}
                    onChange={(e) => setOrgPick((p) => {
                      const next = new Set(p.auto);
                      if (e.target.checked) next.add(a.id); else next.delete(a.id);
                      return { ...p, auto: next };
                    })} />
                  <span className="truncate max-w-64" title={a.title}>{a.title}</span>
                  <span style={{ color: "var(--muted)" }}>{a.from} →</span>
                  <span style={{ color: "var(--accent)" }}>{a.to}</span>
                </label>
              ))}
            </OrgSection>
            <OrgSection title={`归纳合并(${org.renames.length} 组)`} hint="同名/近名分类归并,零散小分类收编进「其他」">
              {org.renames.length === 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>分类结构已经干净,无需归并。</div>}
              {org.renames.map((r) => (
                <label key={`${r.from}→${r.to}`} className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={orgPick.renames.has(`${r.from}→${r.to}`)}
                    onChange={(e) => setOrgPick((p) => {
                      const next = new Set(p.renames);
                      const key = `${r.from}→${r.to}`;
                      if (e.target.checked) next.add(key); else next.delete(key);
                      return { ...p, renames: next };
                    })} />
                  <span className="truncate max-w-48">{r.from}</span>
                  <span style={{ color: "var(--muted)" }}>→</span>
                  <span style={{ color: "var(--accent)" }}>{r.to}</span>
                  <span style={{ color: "var(--muted)" }}>({r.count} 条 · {r.reason})</span>
                </label>
              ))}
            </OrgSection>
            <OrgSection title={`重复链接(${org.duplicateGroups.length} 组)`} hint="同一网址(忽略协议/www/跟踪参数)只保留最早一条">
              {org.duplicateGroups.length === 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>没有重复链接。</div>}
              {org.duplicateGroups.map((g) => (
                <div key={g.key} className="flex items-start gap-2 text-xs">
                  <input type="checkbox" className="mt-0.5" checked={orgPick.dups.has(g.key)}
                    onChange={(e) => setOrgPick((p) => {
                      const next = new Set(p.dups);
                      if (e.target.checked) next.add(g.key); else next.delete(g.key);
                      return { ...p, dups: next };
                    })} />
                  <div className="min-w-0">
                    <div className="truncate" style={{ color: "var(--muted)" }}>{g.key}</div>
                    <div className="truncate">保留「{g.links[0]?.title}」({g.links[0]?.category}),删除其余 {g.links.length - 1} 条</div>
                  </div>
                </div>
              ))}
            </OrgSection>
            <div className="flex gap-2">
              <button className="accent-btn text-xs px-3 py-1" onClick={() => void applyOrganize()}
                disabled={orgPick.auto.size + orgPick.renames.size + orgPick.dups.size === 0}>
                应用所选
              </button>
              <button className="ghost-btn text-xs px-3 py-1" onClick={() => { setOrgOpen(false); setOrg(null); }}>取消</button>
            </div>
          </div>
        )}
      </div>

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-1">
          <span className="text-sm font-medium">🌐 浏览器收藏夹</span>
          <button className="accent-btn text-xs px-2 py-1" onClick={() => void scanBookmarks()} disabled={bmScanning}>
            {bmScanning ? "读取中…" : bmProfiles === null ? "读取 Chrome/Edge 收藏夹" : "重新读取"}
          </button>
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {[...byCat.entries()].map(([cat, ls]) => (
            <CategorySection
              key={cat}
              cat={cat}
              links={ls}
              open={isOpen(cat)}
              renaming={renaming?.from === cat ? renaming : null}
              onToggle={() => toggleCat(cat)}
              onRenameStart={() => { setError(null); setNotice(null); setRenaming({ from: cat, draft: cat }); }}
              onRenameDraft={(draft) => setRenaming((r) => (r ? { ...r, draft } : r))}
              onRenameCommit={() => renaming && void renameCategory(renaming.from, renaming.draft)}
              onRenameCancel={() => setRenaming(null)}
            >
              {ls.map((l) => {
                const e = editing[l.id];
                if (e) {
                  return (
                    <div key={l.id} className="surface p-2.5 flex flex-wrap items-center gap-2 text-sm">
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
                    </div>
                  );
                }
                return (
                  <DraggableLink key={l.id} link={l} onEdit={() => setEditing({ ...editing, [l.id]: {} })} onDelete={() => void remove(l.id)} />
                );
              })}
            </CategorySection>
          ))}
        </DndContext>
      )}
    </div>
  );
}

function OrgSection({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="rounded p-2" style={{ border: "1px solid var(--border)" }}>
      <div className="text-xs font-medium mb-1">{title}</div>
      <div className="text-xs mb-1.5" style={{ color: "var(--muted)" }}>{hint}</div>
      <div className="space-y-1 max-h-44 overflow-y-auto">{children}</div>
    </div>
  );
}

/** 分类分区:标题(可折叠/可重命名/拖拽投放目标)+ 链接行 */
function CategorySection({
  cat, links, open, renaming, onToggle, onRenameStart, onRenameDraft, onRenameCommit, onRenameCancel, children,
}: {
  cat: string;
  links: LinkRow[];
  open: boolean;
  renaming: { from: string; draft: string } | null;
  onToggle: () => void;
  onRenameStart: () => void;
  onRenameDraft: (draft: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `cat:${cat}` });
  return (
    <section className="mb-2" ref={setNodeRef}>
      <div className="flex items-center gap-2 py-2 rounded px-1" style={isOver ? { outline: "2px dashed var(--accent)" } : undefined}>
        {renaming ? (
          <>
            <input className="input text-sm w-44" value={renaming.draft} autoFocus
              onChange={(e) => onRenameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onRenameCommit(); if (e.key === "Escape") onRenameCancel(); }} />
            <button className="accent-btn text-xs" onClick={onRenameCommit}>保存</button>
            <button className="ghost-btn text-xs" onClick={onRenameCancel}>取消</button>
          </>
        ) : (
          <>
            <h2 className="font-semibold text-sm">
              <button className="inline-flex items-center gap-2 cursor-pointer hover:opacity-80" onClick={onToggle} aria-expanded={open}>
                <span className="text-xs" style={{ color: "var(--muted)" }}>{open ? "▾" : "▸"}</span>
                {cat}
              </button>
            </h2>
            <span className="text-xs" style={{ color: "var(--muted)" }}>{links.length} 条</span>
            <button
              className="ghost-btn text-xs px-1.5 py-0.5 ml-auto"
              onClick={onRenameStart}
              title="批量修改该分类下所有链接的分类名(用于整理导入的杂乱分类)"
            >
              ✎ 重命名
            </button>
          </>
        )}
      </div>
      {open && <div className="space-y-1.5">{children}</div>}
    </section>
  );
}

/** 链接行:整行可拖拽(拖到目标分类完成移动),点击行为不受影响(8px 拖拽激活阈值) */
function DraggableLink({ link, onEdit, onDelete }: { link: LinkRow; onEdit: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `link:${link.id}`, data: { type: "link" } });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="surface p-2.5 flex flex-wrap items-center gap-2 text-sm touch-none"
      style={isDragging ? { opacity: 0.5, zIndex: 10, position: "relative" } : undefined}
      title="拖动到目标分类可移动"
    >
      <span className="cursor-grab text-xs select-none" style={{ color: "var(--muted)" }} aria-hidden>⠿</span>
      <a href={link.url} target="_blank" rel="noreferrer" className="font-medium hover:opacity-80 flex-1 truncate" onClick={(e) => e.stopPropagation()}>{link.title} ↗</a>
      <span className="text-xs truncate max-w-48" style={{ color: "var(--muted)" }}>{link.url}</span>
      <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>#{link.sort}</span>
      <button className="ghost-btn text-xs" onClick={(e) => { e.stopPropagation(); onEdit(); }}>编辑</button>
      <button className="ghost-btn text-xs" style={{ color: "var(--danger)" }} onClick={(e) => { e.stopPropagation(); onDelete(); }}>删除</button>
    </div>
  );
}
