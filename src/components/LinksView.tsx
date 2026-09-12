"use client";
import { useEffect, useState } from "react";

type LinkRow = { id: string; title: string; url: string; category: string; sort: number };

const EMPTY_FORM = { title: "", url: "", category: "", sort: 0 };

// 常用链接管理:分类分组展示、行内编辑、删除、新增(替代浏览器收藏夹)
export function LinksView() {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [filter, setFilter] = useState<string>("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<Record<string, Partial<LinkRow>>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const res = await fetch("/api/links");
      const data = (await res.json()) as { links?: LinkRow[] };
      setLinks(data.links ?? []);
    } catch {
      setError("加载失败,请刷新重试");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

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
