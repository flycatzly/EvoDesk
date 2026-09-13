"use client";
import { useCallback, useEffect, useState } from "react";

type ScanEntry = { name: string; relPath: string; isDir: boolean; category: string; size: number; mtime: string };
type DupGroup = { hash: string; files: { relPath: string; size: number }[] };
type PlanItem = { from: string; toDir: string };

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

// 本地文件整理:白名单目录的类型统计、散文件智能分类移动(先预览后应用,只移动不删除)、
// 同内容重复检测(SHA-256)与"移入重复文件区"(可找回)。输出目录 _分类/_重复文件 不会被二次整理。
export function FileOrganizerView() {
  const [dirs, setDirs] = useState<string[]>([]);
  const [dir, setDir] = useState("");
  const [addDraft, setAddDraft] = useState("");
  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [dupGroups, setDupGroups] = useState<DupGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanItem[] | null>(null);

  const loadDirs = useCallback(async () => {
    const res = await fetch("/api/settings");
    const data = (await res.json()) as { settings?: Record<string, unknown> };
    const arr = data.settings?.organize_dirs;
    const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    setDirs(list);
    setDir((d) => d || list[0] || "");
  }, []);

  const scan = useCallback(async (target: string, withDupes: boolean) => {
    if (!target) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ dir: target, ...(withDupes ? { dupes: "1" } : {}) });
      const res = await fetch(`/api/files/scan?${qs}`);
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "扫描失败"));
        setEntries([]);
        setStats({});
        setDupGroups([]);
        return;
      }
      const d = data as { entries: ScanEntry[]; stats: Record<string, number>; duplicateGroups?: DupGroup[] };
      setEntries(d.entries ?? []);
      setStats(d.stats ?? {});
      if (withDupes) setDupGroups(d.duplicateGroups ?? []);
    } catch {
      setError("扫描请求失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const raf = requestAnimationFrame(() => { void loadDirs(); });
    return () => cancelAnimationFrame(raf);
  }, [loadDirs]);

  useEffect(() => {
    if (!dir) return;
    // rAF 包裹:避免 effect 内同步 setState(react-hooks/set-state-in-effect)
    const raf = requestAnimationFrame(() => { void scan(dir, false); });
    return () => cancelAnimationFrame(raf);
  }, [dir, scan]);

  const addDir = async () => {
    const d = addDraft.trim();
    if (!d) return;
    const next = [...dirs.filter((x) => x !== d), d];
    const res = await fetch("/api/settings", { method: "PUT", body: JSON.stringify({ organize_dirs: next }) });
    if (!res.ok) {
      setError("保存失败");
      return;
    }
    setAddDraft("");
    setDirs(next);
    setDir(d);
  };

  const previewClassify = async () => {
    if (!dir || busy) return;
    setBusy("classify");
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/files/classify", { method: "POST", body: JSON.stringify({ dir }) });
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "预览失败"));
        return;
      }
      setPlan((data as { plan: PlanItem[] }).plan ?? []);
    } finally {
      setBusy(null);
    }
  };
  const applyClassify = async () => {
    if (!dir || busy) return;
    setBusy("classify-apply");
    try {
      const res = await fetch("/api/files/classify", { method: "POST", body: JSON.stringify({ dir, apply: true }) });
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "整理失败"));
        return;
      }
      const d = data as { applied: number };
      setNotice(`整理完成:已移动 ${d.applied} 个文件到分类子目录`);
      setPlan(null);
      void scan(dir, false);
    } finally {
      setBusy(null);
    }
  };
  const previewDedupe = async () => {
    if (!dir || busy) return;
    setBusy("dedupe");
    setError(null);
    setNotice(null);
    try {
      await scan(dir, true);
    } finally {
      setBusy(null);
    }
  };
  const applyDedupe = async () => {
    if (!dir || busy) return;
    setBusy("dedupe-apply");
    try {
      const res = await fetch("/api/files/dedupe", { method: "POST", body: JSON.stringify({ dir, apply: true }) });
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "去重失败"));
        return;
      }
      const d = data as { moved: number; dest: string };
      setNotice(`去重完成:${d.moved} 个重复文件已移入 ${d.dest}(未删除,可随时找回)`);
      void scan(dir, false);
    } finally {
      setBusy(null);
    }
  };

  const rootFiles = entries.filter((e) => !e.isDir);

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">本地文件整理</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        按类型分析分类目录下的文件(文本/图片智能分类),同内容去重;只移动不删除——重复文件移入
        「_重复文件/时间戳」目录,随时可人工找回。整理范围仅限白名单目录。
      </p>

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <select className="input text-xs max-w-64" value={dir} onChange={(e) => { setDir(e.target.value); setPlan(null); }} aria-label="选择整理目录">
            {dirs.length === 0 && <option value="">未配置整理目录</option>}
            {dirs.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
          <button className="ghost-btn text-xs px-2 py-1" onClick={() => void scan(dir, false)} disabled={loading || !dir}>重新扫描</button>
          <button className="accent-btn text-xs px-2 py-1" onClick={() => void previewClassify()} disabled={loading || !dir}>🪄 智能分类整理</button>
          <button className="ghost-btn text-xs px-2 py-1" onClick={() => void previewDedupe()} disabled={loading || !dir}>🔍 查找重复(含图片)</button>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          <input className="input text-xs flex-1 min-w-56" placeholder="添加要整理的目录(绝对路径)…" value={addDraft} onChange={(e) => setAddDraft(e.target.value)} />
          <button className="accent-btn text-xs px-2 py-1" onClick={() => void addDir()} disabled={!addDraft.trim()}>添加</button>
        </div>
      </div>

      {error && <div className="text-xs mb-3" style={{ color: "var(--danger)" }}>{error}</div>}
      {notice && <div className="text-xs mb-3" style={{ color: "var(--accent)" }}>{notice}</div>}

      {plan !== null && (
        <div className="surface p-3 mb-4">
          <div className="text-sm font-medium mb-1">分类预览({plan.length} 个文件将被移动)</div>
          <div className="text-xs mb-2 max-h-40 overflow-y-auto" style={{ color: "var(--muted)" }}>
            {plan.map((p) => <div key={p.from}>{p.from} → {p.toDir}/</div>)}
          </div>
          <div className="flex gap-2">
            <button className="accent-btn text-xs px-3 py-1" onClick={() => void applyClassify()} disabled={busy === "classify-apply"}>
              {busy === "classify-apply" ? "整理中…" : "确认执行"}
            </button>
            <button className="ghost-btn text-xs px-3 py-1" onClick={() => setPlan(null)}>取消</button>
          </div>
        </div>
      )}

      {Object.keys(stats).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {Object.entries(stats).sort((a, b) => b[1] - a[1]).map(([c, n]) => (
            <span key={c} className="text-xs px-2 py-1 rounded" style={{ background: "var(--surface-2)" }}>{c} {n}</span>
          ))}
        </div>
      )}

      {dupGroups.length > 0 && (
        <div className="surface p-3 mb-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-medium">重复文件({dupGroups.length} 组)</span>
            <button className="accent-btn text-xs px-2 py-1 ml-auto" onClick={() => void applyDedupe()} disabled={busy === "dedupe-apply"}>
              {busy === "dedupe-apply" ? "移动中…" : "全部移入重复文件区"}
            </button>
          </div>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>每组保留最早修改的一条,其余移动到 _重复文件/(同内容 = SHA-256 完全一致)</div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {dupGroups.map((g) => (
              <div key={g.hash} className="text-xs rounded p-2" style={{ border: "1px solid var(--border)" }}>
                <div className="font-medium">{g.files[0].relPath}</div>
                <div style={{ color: "var(--muted)" }}>与其他 {g.files.length - 1} 个相同:{g.files.slice(1).map((f) => f.relPath).join("、")}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {rootFiles.length > 0 && (
        <div className="surface p-3">
          <div className="text-sm font-medium mb-2">文件清单({rootFiles.length})</div>
          <div className="max-h-96 overflow-y-auto">
            {entries.map((e) => (
              <div key={e.relPath} className="flex flex-wrap items-center gap-2 text-xs px-1 py-1" style={{ borderBottom: "1px solid var(--border)" }}>
                <span className="px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{e.isDir ? "目录" : e.category}</span>
                <span className="truncate flex-1" title={e.relPath}>{e.name}</span>
                <span style={{ color: "var(--muted)" }}>{e.isDir ? "" : fmtSize(e.size)}</span>
                <span style={{ color: "var(--muted)" }}>{new Date(e.mtime).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
