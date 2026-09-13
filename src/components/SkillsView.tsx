"use client";
import { useCallback, useEffect, useState } from "react";

type SkillInfo = { path: string; name: string; description: string; category: string; mtime: string };
type ScanError = { dir: string; message: string };
type SkillMeta = Record<string, { star?: boolean; note?: string }>;
type McpServer = { name: string; command: string; args: string[] };
type McpConfig = { source: string; file: string; servers: McpServer[]; error?: string };
type Turn = { role: "user" | "assistant"; content: string };

// 技能地图:一键扫描本地 Skill 与 MCP 配置,分类汇总、搜索、星标/备注;
// 支持 AI 辅助创建技能(逐轮追问 → 生成 SKILL.md → 安装/导出)与技能包 zip 导出。
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
  // MCP 扫描
  const [mcpConfigs, setMcpConfigs] = useState<McpConfig[] | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  // 创建技能
  const [createOpen, setCreateOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [createInput, setCreateInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [finalMd, setFinalMd] = useState<string | null>(null);
  const [installDir, setInstallDir] = useState<string>("");
  const [installing, setInstalling] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

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

  const loadMcp = useCallback(async () => {
    try {
      const res = await fetch("/api/skills/mcp");
      const data = (await res.json()) as { configs?: McpConfig[] };
      setMcpConfigs(data.configs ?? []);
    } catch {
      setMcpConfigs([]);
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

  // —— AI 创建技能:逐轮追问 → 最终 SKILL.md → 安装/导出 ——
  const askCreate = async () => {
    const content = createInput.trim();
    if (!content || creating) return;
    setCreating(true);
    setCreateMsg(null);
    const mine: Turn = { role: "user", content };
    try {
      const res = await fetch("/api/skills/create", {
        method: "POST",
        body: JSON.stringify({ messages: [...turns, mine] }),
      });
      const data = (await res.json()) as { reply?: string; final?: string | null; error?: string };
      if (!res.ok) {
        setCreateMsg(data.error ?? "AI 调用失败");
        return;
      }
      const reply = data.reply ?? "";
      setTurns((t) => [...t, mine, { role: "assistant", content: reply }]);
      setCreateInput("");
      if (data.final) {
        setFinalMd(data.final);
        setInstallDir((d) => d || dirs[0] || "");
      }
    } catch {
      setCreateMsg("请求失败,请重试");
    } finally {
      setCreating(false);
    }
  };
  const installSkill = async () => {
    if (!finalMd || installing) return;
    setInstalling(true);
    setCreateMsg(null);
    try {
      const res = await fetch("/api/skills/install", {
        method: "POST",
        body: JSON.stringify({ content: finalMd, dir: installDir }),
      });
      const data = (await res.json()) as { path?: string; error?: string };
      if (!res.ok) {
        setCreateMsg(data.error ?? "安装失败");
        return;
      }
      setCreateMsg(`已安装到 ${data.path}`);
      void scan();
    } catch {
      setCreateMsg("安装请求失败");
    } finally {
      setInstalling(false);
    }
  };
  const downloadSkillMd = () => {
    if (!finalMd) return;
    const blob = new Blob([finalMd], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "SKILL.md";
    a.click();
    URL.revokeObjectURL(a.href);
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
  const mcpTotal = mcpConfigs?.reduce((n, c) => n + c.servers.length, 0) ?? 0;

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
        一键梳理本地 Skill 与 MCP:汇总基础信息、按目录分类;只读扫描,不执行任何 skill 内容。
      </p>

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center mb-2">
          <button className="accent-btn text-xs px-3 py-1.5" onClick={() => void scan()} disabled={scanning}>
            {scanning ? "扫描中…" : scanned ? "重新扫描" : "一键梳理"}
          </button>
          <button className="ghost-btn text-xs px-2 py-1" onClick={() => setCreateOpen((v) => !v)}>
            ➕ 创建技能(AI 辅助)
          </button>
          {/* API 路由文件下载(attachment),需原生 <a download> */}
          <a className="ghost-btn text-xs px-2 py-1" href="/api/skills/export" download>导出技能包(zip)</a>
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

      {createOpen && (
        <div className="surface p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-sm font-medium">➕ 创建技能(AI 辅助)</span>
            <span className="text-xs" style={{ color: "var(--muted)" }}>描述想做的技能,AI 逐轮追问(最多 5 轮)后生成 SKILL.md</span>
            <button className="ghost-btn text-xs px-1.5 py-0.5 ml-auto" onClick={() => { setCreateOpen(false); setTurns([]); setFinalMd(null); setCreateMsg(null); }}>收起</button>
          </div>
          {turns.length === 0 && !finalMd && (
            <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>
              例如:「做一个把当前目录图片按日期归档的技能」
            </div>
          )}
          <div className="space-y-1.5 mb-2 max-h-72 overflow-y-auto">
            {turns.map((t, i) => (
              <div key={i} className={`text-sm rounded p-2 ${t.role === "user" ? "ml-8" : "mr-8"}`}
                style={{ background: "var(--surface-2)" }}>
                <span className="text-xs mr-1" style={{ color: "var(--muted)" }}>{t.role === "user" ? "我:" : "教练:"}</span>
                <span className="whitespace-pre-wrap">{t.content}</span>
              </div>
            ))}
          </div>
          {!finalMd ? (
            <div className="flex gap-1.5">
              <input className="input text-sm flex-1" placeholder={turns.length === 0 ? "想做一个什么技能?" : "回答教练的问题…"}
                value={createInput} autoFocus
                onChange={(e) => setCreateInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void askCreate(); }}
                disabled={creating} />
              <button className="accent-btn text-xs px-3" onClick={() => void askCreate()} disabled={creating || !createInput.trim()}>
                {creating ? "思考中…" : "发送"}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-xs font-medium">✅ 已生成 SKILL.md(可编辑)</div>
              <textarea className="input text-xs w-full p-2 font-mono" rows={12} value={finalMd}
                onChange={(e) => setFinalMd(e.target.value)} />
              <div className="flex flex-wrap gap-2 items-center">
                <select className="input text-xs" value={installDir} onChange={(e) => setInstallDir(e.target.value)} aria-label="安装目录">
                  {dirs.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
                <button className="accent-btn text-xs px-3 py-1" onClick={() => void installSkill()} disabled={installing || !installDir}>
                  {installing ? "安装中…" : "安装到所选目录"}
                </button>
                <button className="ghost-btn text-xs px-2 py-1" onClick={downloadSkillMd}>下载 SKILL.md</button>
                <button className="ghost-btn text-xs px-2 py-1" onClick={() => { void navigator.clipboard.writeText(finalMd); setCreateMsg("已复制到剪贴板"); }}>复制</button>
                <button className="ghost-btn text-xs px-2 py-1" onClick={() => { setFinalMd(null); setTurns([]); setCreateMsg(null); }}>重新开始</button>
              </div>
            </div>
          )}
          {createMsg && <div className="text-xs mt-2" style={{ color: "var(--accent)" }}>{createMsg}</div>}
        </div>
      )}

      <div className="surface p-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">🔌 本机 MCP</span>
          <button className="ghost-btn text-xs px-2 py-1" onClick={() => { setMcpOpen((v) => !v); if (mcpConfigs === null) void loadMcp(); }}>
            {mcpOpen ? "收起" : `查看(${mcpConfigs === null ? "点击扫描" : `${mcpTotal} 台`})`}
          </button>
          <span className="text-xs" style={{ color: "var(--muted)" }}>只读解析 Claude Desktop / Claude Code 配置,不连接不执行</span>
        </div>
        {mcpOpen && mcpConfigs !== null && (
          <div className="mt-2 space-y-2">
            {mcpConfigs.length === 0 && <div className="text-xs" style={{ color: "var(--muted)" }}>未找到 MCP 配置文件(未安装或未配置 MCP 客户端)。</div>}
            {mcpConfigs.map((c) => (
              <div key={c.file} className="rounded p-2" style={{ border: "1px solid var(--border)" }}>
                <div className="text-xs mb-1">
                  <span className="font-medium">{c.source}</span>
                  <span className="ml-2" style={{ color: "var(--muted)" }} title={c.file}>{c.servers.length} 台</span>
                  {c.error && <span className="ml-2" style={{ color: "var(--danger)" }}>⚠ {c.error}</span>}
                </div>
                <div className="space-y-1">
                  {c.servers.map((s) => (
                    <div key={s.name} className="text-xs flex items-center gap-2">
                      <span className="px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{s.name}</span>
                      <span className="truncate flex-1" style={{ color: "var(--muted)" }} title={`${s.command} ${s.args.join(" ")}`}>
                        {s.command} {s.args.join(" ")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
