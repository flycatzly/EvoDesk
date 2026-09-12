"use client";
import { useCallback, useEffect, useState } from "react";

type SkillInfo = { path: string; name: string; description: string; category: string; mtime: string };
type ScanError = { dir: string; message: string };
type SkillMeta = Record<string, { star?: boolean; note?: string }>;

// 技能地图:一键扫描本地 Skill 目录,分类汇总、搜索、星标/备注(备注存 settings.skills_meta)
export function SkillsView() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [errors, setErrors] = useState<ScanError[]>([]);
  const [dirs, setDirs] = useState<string[]>([]);
  const [dirsDraft, setDirsDraft] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [q, setQ] = useState("");
  const [meta, setMeta] = useState<SkillMeta>({});
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");

  const loadMeta = useCallback(async () => {
    try {
      const res = await fetch("/api/settings");
      const data = (await res.json()) as { settings?: Record<string, unknown> };
      const m = data.settings?.skills_meta;
      setMeta(m && typeof m === "object" ? (m as SkillMeta) : {});
      const d = data.settings?.skills_dirs;
      if (Array.isArray(d)) {
        const arr = d.filter((x): x is string => typeof x === "string");
        setDirs(arr);
        setDirsDraft(arr.join("\n"));
      }
    } catch {
      /* 设置读取失败不阻塞扫描 */
    }
  }, []);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/skills/scan");
      const data = (await res.json()) as { skills?: SkillInfo[]; errors?: ScanError[]; dirs?: string[] };
      setSkills(data.skills ?? []);
      setErrors(data.errors ?? []);
      setDirs(data.dirs ?? []);
      setScanned(true);
    } catch {
      setErrors([{ dir: "-", message: "扫描请求失败" }]);
    } finally {
      setScanning(false);
    }
  }, []);

  // 下一帧初始化:避免 effect 内同步 setState
  useEffect(() => {
    const raf = requestAnimationFrame(() => { void loadMeta(); void scan(); });
    return () => cancelAnimationFrame(raf);
  }, [loadMeta, scan]);

  const saveMeta = async (next: SkillMeta) => {
    setMeta(next);
    try {
      await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ skills_meta: next }) });
    } catch {
      /* 备注保存失败:界面状态已更新,重新扫描会回读真实值 */
    }
  };
  const toggleStar = (path: string) => {
    const cur = meta[path] ?? {};
    void saveMeta({ ...meta, [path]: { ...cur, star: !cur.star } });
  };
  const saveNote = (path: string) => {
    const cur = meta[path] ?? {};
    const n = { ...meta };
    const text = noteDraft.trim();
    if (text) n[path] = { ...cur, note: text };
    else if (cur.star) delete (n[path] as { note?: string }).note;
    else delete n[path];
    void saveMeta(n);
    setNoteEditing(null);
  };
  const saveDirs = async () => {
    const arr = dirsDraft.split("\n").map((s) => s.trim()).filter(Boolean);
    try {
      await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ skills_dirs: arr }) });
      setDirs(arr);
      void scan();
    } catch {
      /* 保存失败保持草稿 */
    }
  };

  const filtered = q.trim()
    ? skills.filter((s) => `${s.name} ${s.description} ${s.category} ${s.path}`.toLowerCase().includes(q.trim().toLowerCase()))
    : skills;
  const starred = filtered.filter((s) => meta[s.path]?.star);
  const byCat = new Map<string, SkillInfo[]>();
  for (const s of filtered) {
    // 已进「★ 常用」的不再在分类区重复展示
    if (meta[s.path]?.star) continue;
    const list = byCat.get(s.category) ?? [];
    list.push(s);
    byCat.set(s.category, list);
  }
  const categories = [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const renderSkill = (s: SkillInfo) => {
    const m = meta[s.path] ?? {};
    return (
      <div key={s.path} className="rounded p-2" style={{ border: "1px solid var(--border)" }}>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => toggleStar(s.path)} aria-label="星标" style={{ color: m.star ? "var(--warn)" : "var(--muted)" }}>
            {m.star ? "★" : "☆"}
          </button>
          <span className="font-medium">{s.name}</span>
          <span className="text-xs truncate flex-1" style={{ color: "var(--muted)" }} title={s.path}>{s.description || s.path}</span>
          <button className="ghost-btn text-xs px-1.5 py-0.5" onClick={() => { setNoteEditing(noteEditing === s.path ? null : s.path); setNoteDraft(m.note ?? ""); }}>
            {m.note ? "备注✓" : "备注"}
          </button>
        </div>
        {m.note && noteEditing !== s.path && <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>📝 {m.note}</div>}
        {noteEditing === s.path && (
          <div className="mt-1.5 flex gap-1.5">
            <input className="input text-xs flex-1" placeholder="这个 skill 怎么用?什么时候用?" value={noteDraft} autoFocus
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveNote(s.path); if (e.key === "Escape") setNoteEditing(null); }} />
            <button className="accent-btn text-xs px-2 py-1" onClick={() => saveNote(s.path)}>保存</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">技能地图</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        一键梳理本地 Skill:汇总基础信息、按目录分类;只读扫描,不执行任何 skill 内容。
      </p>

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <button className="accent-btn text-xs px-3 py-1.5" onClick={() => void scan()} disabled={scanning}>
            {scanning ? "扫描中…" : scanned ? "重新扫描" : "一键梳理"}
          </button>
          <input className="input text-sm flex-1 min-w-48" placeholder="搜索名称 / 描述 / 路径…" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs" style={{ color: "var(--muted)" }}>{scanned ? `共 ${skills.length} 个` : "尚未扫描"}</span>
        </div>
        <details>
          <summary className="text-xs cursor-pointer" style={{ color: "var(--muted)" }}>扫描目录({dirs.length} 个,点击编辑)</summary>
          <textarea className="input text-xs w-full mt-2 p-2" rows={3} value={dirsDraft} onChange={(e) => setDirsDraft(e.target.value)}
            placeholder={"每行一个目录,支持 ~/,如:\n~/.agents/skills\n~/.claude/skills"} />
          <button className="accent-btn text-xs px-2 py-1 mt-1" onClick={() => void saveDirs()}>保存目录并重扫</button>
        </details>
        {errors.length > 0 && (
          <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>
            {errors.map((e) => <div key={e.dir}>⚠ {e.dir}:{e.message}</div>)}
          </div>
        )}
      </div>

      {scanned && filtered.length === 0 ? (
        <div className="surface p-6 text-sm text-center" style={{ color: "var(--muted)" }}>
          {q ? "没有匹配的 skill。" : "未发现 SKILL.md —— 检查上方扫描目录是否正确。"}
        </div>
      ) : (
        <>
          {starred.length > 0 && (
            <section className="mb-4">
              <h2 className="font-semibold text-sm mb-2">★ 常用</h2>
              <div className="grid md:grid-cols-2 gap-2">{starred.map(renderSkill)}</div>
            </section>
          )}
          {categories.map(([cat, list]) => (
            <section key={cat} className="mb-4">
              <h2 className="font-semibold text-sm mb-2">{cat} <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>({list.length})</span></h2>
              <div className="grid md:grid-cols-2 gap-2">{list.map(renderSkill)}</div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
