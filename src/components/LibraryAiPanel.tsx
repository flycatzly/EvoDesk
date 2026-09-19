"use client";
import { useState } from "react";

type LibraryEntry = { relPath: string; name: string; category: string; size: number; mtime: string; isText: boolean };
type PlanCategory = { name: string; files: string[] };
type PlanMerge = { target: string; sources: string[] };
type AiPlan = { categories: PlanCategory[]; merges: PlanMerge[]; enrich: string[] };
type SimGroup = { kind: string; files: string[] };

function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

/** 资料库 AI 整理面板:自然语言指令 → 生成计划(智能分类 / 相似合并 / 内容完善)→ 勾选应用;
 *  支持把文件导入到 Obsidian 主库(全部或按勾选)。所有写入都有备份/归档,不丢原件。 */
export function LibraryAiPanel({ root, entries, selected, onReload }: {
  root: string;
  entries: LibraryEntry[];
  selected?: Set<string>;
  onReload: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [planning, setPlanning] = useState(false);
  const [similar, setSimilar] = useState<SimGroup[] | null>(null);
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  type EnrichResult = { file: string; ok: boolean; note: string; after?: string; before?: string };
  const [pickedCats, setPickedCats] = useState<Set<string>>(new Set());
  const [pickedMerges, setPickedMerges] = useState<Set<string>>(new Set());
  const [pickedEnrich, setPickedEnrich] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  // 内容完善确认制:先"生成推荐修改"(仅预览,不写库),逐篇 diff 对比后确认才应用
  const [enrichPreview, setEnrichPreview] = useState<Record<string, { before: string; after: string }>>({});
  const [genBusy, setGenBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 导入 Obsidian
  const [importFolder, setImportFolder] = useState("Apifox导入");

  const analyze = async () => {
    setPlanning(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/vault/ai-organize", {
        method: "POST",
        body: JSON.stringify({ action: "plan", root, instruction }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "分析失败"));
        return;
      }
      const d = data as { similar?: SimGroup[]; plan?: AiPlan; aiError?: string };
      setSimilar(d.similar ?? []);
      setPlan(d.plan ?? { categories: [], merges: [], enrich: [] });
      setPickedCats(new Set((d.plan?.categories ?? []).map((c) => c.name)));
      setPickedMerges(new Set((d.plan?.merges ?? []).map((m) => m.target)));
      setPickedEnrich(new Set(d.plan?.enrich ?? []));
      setAiError(d.aiError ?? null);
    } catch {
      setError("分析请求失败");
    } finally {
      setPlanning(false);
    }
  };

  /** 单篇完善:调 AI 生成推荐修改(仅存预览,不写文件) */
  const genEnrich = async (f: string) => {
    if (genBusy || !root) return;
    setGenBusy(f);
    setError(null);
    try {
      // 读原文
      const readRes = await fetch(`/api/guide`, { method: "POST", body: JSON.stringify({ dir: root, path: f }) });
      void readRes;
      // 走 ai-organize apply 单篇"仅生成不写入"不存在——这里用独立通道:直接调 summarize?不行。
      // 简化:ai-organize apply 单文件模式(enrich 数组只含该文件),服务端先返回 diff 而不写入(add &dry_run)
      const res = await fetch("/api/vault/ai-organize", {
        method: "POST",
        body: JSON.stringify({ action: "apply", root, plan: { categories: [], merges: [], enrich: [f] }, dry_run: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(errorOf(data, "生成推荐失败")); return; }
      const enr = (data as { enrich?: EnrichResult[] }).enrich?.[0];
      if (!enr?.ok) { setError(`生成失败:${enr?.note ?? ""}`); return; }
      setEnrichPreview((prev) => ({ ...prev, [f]: { before: enr.before ?? "", after: enr.after ?? "" } }));
    } catch {
      setError("生成请求失败");
    } finally {
      setGenBusy(null);
    }
  };

  /** 确认应用单篇推荐(真正写入,服务端备份原件) */
  const acceptEnrich = async (f: string, after: string) => {
    if (!root) return;
    try {
      const res = await fetch("/api/vault/ai-organize", {
        method: "POST",
        body: JSON.stringify({ action: "apply_enrich", root, path: f, content: after }),
      });
      const data = await res.json();
      if (!res.ok) { setError(errorOf(data, "写入失败")); return; }
      setNotice(`已应用推荐修改:${f}(原件备份 .bak)`);
      setEnrichPreview((prev) => { const n = { ...prev }; delete n[f]; return n; });
      onReload();
    } catch {
      setError("写入请求失败");
    }
  };

  const applyPlan = async () => {
    if (!plan || applying) return;
    setApplying(true);
    setError(null);
    try {
      const applied: AiPlan = {
        categories: plan.categories.filter((c) => pickedCats.has(c.name)),
        merges: plan.merges.filter((m) => pickedMerges.has(m.target)),
        enrich: plan.enrich.filter((f) => pickedEnrich.has(f)),
      };
      const res = await fetch("/api/vault/ai-organize", { method: "POST", body: JSON.stringify({ action: "apply", root, plan: applied }) });
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "应用失败"));
        return;
      }
      const d = data as { categories: { moved: number }; merges: { ok: boolean; target: string }[]; enrich: { ok: number }[]; backupDir: string };
      const okMerges = d.merges.filter((m) => m.ok).length;
      const okEnrich = d.enrich.filter((e) => e.ok).length;
      setNotice(`已应用:移动 ${d.categories.moved} 个文件 · 合并 ${okMerges}/${d.merges.length} · 完善 ${okEnrich}/${d.enrich.length}(原件备份于 ${d.backupDir})`);
      setPlan(null);
      onReload();
    } catch {
      setError("应用请求失败");
    } finally {
      setApplying(false);
    }
  };

  const importToVault = async (pathsArg: string[]) => {
    const rels = pathsArg.length > 0 ? pathsArg : entries.map((e) => e.relPath);
    if (rels.length === 0) {
      setError("该资料库没有文件");
      return;
    }
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/vault/ai-organize", {
        method: "POST",
        body: JSON.stringify({ action: "import", root, paths: rels, folder: importFolder }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(errorOf(data, "导入失败"));
        return;
      }
      const d = data as { imported: number; skipped: number; target: string };
      setNotice(`已导入 ${d.imported} 个文件到 Obsidian「${d.target}」(跳过 ${d.skipped})`);
    } catch {
      setError("导入请求失败");
    }
  };

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setter(next);
  };

  return (
    <div className="surface p-3 mb-4">
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <span className="text-sm font-medium">🤖 AI 整理</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>自然语言描述要求:智能分类 · 相似合并 · 内容完善 · 导入 Obsidian</span>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center mb-2">
        <input className="input text-xs flex-1 min-w-64" placeholder="例:按内容主题分类;把重复的接口文档合并成一篇完整版;补充缺少示例的文档…"
          value={instruction} onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void analyze(); }} />
        <button className="accent-btn text-xs px-3 py-1" onClick={() => void analyze()} disabled={planning}>
          {planning ? "分析中…" : "🪄 分析并生成计划"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 items-center mb-1">
        <input className="input text-xs w-40" placeholder="Obsidian 目标文件夹" value={importFolder} onChange={(e) => setImportFolder(e.target.value)} />
        <button className="ghost-btn text-xs px-2 py-1" onClick={() => void importToVault(entries.map((e) => e.relPath))}>全部导入 Obsidian</button>
        {selected && selected.size > 0 && (
          <button className="accent-btn text-xs px-2 py-1" onClick={() => void importToVault([...selected])}>
            导入所选({selected.size})
          </button>
        )}
        <span className="text-xs" style={{ color: "var(--muted)" }}>共 {entries.length} 个文件;合并/完善的原件会备份到 _原始备份,不会丢失</span>
      </div>
      {aiError && <div className="text-xs mt-1" style={{ color: "var(--warn)" }}>⚠ AI 计划未生成({aiError});下方离线相似检测仍可用。</div>}
      {error && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{error}</div>}
      {notice && <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>{notice}</div>}

      {(similar !== null || plan !== null) && (
        <div className="mt-2 space-y-2 text-xs">
          {similar && similar.length > 0 && (
            <div className="rounded p-2" style={{ border: "1px solid var(--border)" }}>
              <div className="font-medium mb-1">相似文章({similar.length} 组,离线检测)</div>
              {similar.map((g, i) => (
                <div key={i} className="truncate" style={{ color: "var(--muted)" }}>
                  [{g.kind}] {g.files.join(" ⇋ ")}
                </div>
              ))}
            </div>
          )}
          {plan && plan.categories.length > 0 && (
            <div className="rounded p-2" style={{ border: "1px solid var(--border)" }}>
              <div className="font-medium mb-1">智能分类划分({plan.categories.length} 类)</div>
              {plan.categories.map((c) => (
                <label key={c.name} className="flex items-center gap-2 py-0.5 cursor-pointer">
                  <input type="checkbox" checked={pickedCats.has(c.name)} onChange={() => toggle(pickedCats, c.name, setPickedCats)} />
                  <span style={{ color: "var(--accent)" }}>{c.name}</span>
                  <span className="truncate flex-1" style={{ color: "var(--muted)" }}>{c.files.length} 个文件</span>
                </label>
              ))}
            </div>
          )}
          {plan && plan.merges.length > 0 && (
            <div className="rounded p-2" style={{ border: "1px solid var(--border)" }}>
              <div className="font-medium mb-1">合并重生成({plan.merges.length} 组)</div>
              {plan.merges.map((m) => (
                <label key={m.target} className="flex items-center gap-2 py-0.5 cursor-pointer">
                  <input type="checkbox" checked={pickedMerges.has(m.target)} onChange={() => toggle(pickedMerges, m.target, setPickedMerges)} />
                  <span className="truncate">{m.target}</span>
                  <span className="truncate flex-1" style={{ color: "var(--muted)" }}>← {m.sources.join(" + ")}</span>
                </label>
              ))}
            </div>
          )}
          {plan && plan.enrich.length > 0 && (
            <div className="rounded p-2" style={{ border: "1px solid var(--border)" }}>
              <div className="font-medium mb-1">内容完善({plan.enrich.length} 篇)</div>
              <div className="text-xs mb-1.5" style={{ color: "var(--muted)" }}>AI 先给出推荐修改(新原文对比),你逐篇确认后才会写入</div>
              {plan.enrich.map((f) => {
                const st = enrichPreview[f];
                return (
                  <div key={f} className="mb-2">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={pickedEnrich.has(f)} onChange={() => toggle(pickedEnrich, f, setPickedEnrich)} />
                      <span className="truncate">{f}</span>
                      {!st && <button className="ghost-btn text-xs px-1.5 py-0.5 ml-auto" onClick={() => void genEnrich(f)} disabled={genBusy === f}>
                        {genBusy === f ? "生成中…" : "生成推荐修改"}
                      </button>}
                    </div>
                    {st && <DiffBlock before={st.before} after={st.after} onAccept={() => acceptEnrich(f, st.after)} />}
                  </div>
                );
              })}
            </div>
          )}
          {plan && (plan.categories.length > 0 || plan.merges.length > 0 || plan.enrich.length > 0) && (
            <button className="accent-btn text-xs px-3 py-1" onClick={() => void applyPlan()} disabled={applying}>
              {applying ? "执行中…(合并/完善需调用 AI,请稍候)" : "应用所选(移动 / 合并重生成 / 完善)"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 行级 diff 对比(前/后),绿色=新增行,红色=删除行 */
function DiffBlock({ before, after, onAccept }: { before: string; after: string; onAccept: () => void }) {
  const a = before.split("\n");
  const b = after.split("\n");
  const bSet = new Set(b);
  const rows: { kind: "same" | "add" | "del"; text: string }[] = [];
  for (const line of a) if (!bSet.has(line)) rows.push({ kind: "del", text: line });
  const aSet = new Set(a);
  for (const line of b) if (!aSet.has(line)) rows.push({ kind: "add", text: line });
  return (
    <div className="mt-1 rounded p-2 max-h-56 overflow-auto" style={{ border: "1px solid var(--border)", background: "var(--surface-2)" }}>
      <div className="text-xs font-mono whitespace-pre-wrap">
        {rows.map((r, i) => (
          <div key={i} style={{ color: r.kind === "add" ? "var(--ok)" : "var(--danger)", whiteSpace: "pre-wrap" }}>
            {r.kind === "add" ? "+ " : r.kind === "del" ? "- " : "  "}{r.text}
          </div>
        ))}
      </div>
      <button className="accent-btn text-xs px-2 py-0.5 mt-1.5" onClick={onAccept}>确认应用此修改</button>
    </div>
  );
}
