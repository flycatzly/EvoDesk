"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { evolutionEvents, flowTemplates } from "@/lib/db/schema";
import type { StepDef } from "@/lib/domain/step-def";

type TemplateRow = typeof flowTemplates.$inferSelect;
type EventRow = typeof evolutionEvents.$inferSelect;

const STATUS_LABEL: Record<string, string> = { active: "活跃", experimental: "实验", retired: "已退役" };
const ORIGIN_LABEL: Record<string, string> = { seed: "种子", manual: "手动", evolution: "进化" };
const KIND_LABEL: Record<string, string> = { variant_created: "变体诞生", promoted: "已晋升", retired: "已退役", analysis_run: "复盘分析" };

function statusColor(status: string): string {
  if (status === "active") return "var(--ok)";
  if (status === "experimental") return "var(--warn)";
  return "var(--muted)";
}

function parseSteps(raw: string): StepDef[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as StepDef[]) : [];
  } catch {
    return [];
  }
}

// steps diff:按计划规格「以 name 对齐」的逐条标注(刻意不做复杂 diff 算法)。
// 展示顺序:先按变体自身步骤顺序列出 =/~/+(保留变体视角的步骤流),再按父版本顺序追加 `-` 移除项;
// 因此顺序不再暗示位置对应,行内不带序号前缀。
// 同名重复(add_step 复用同名等):配对父侧首个未消耗的同名出现,配不上的记 `+`。
// `=` 同名同类型且未改动;`~` 同名但 type/prompt/executorRole 变化(标注具体变化);`+` 变体新增;`-` 父版本被移除
type DiffLine = { mark: "=" | "~" | "+" | "-"; text: string };
const DIFF_COLOR: Record<DiffLine["mark"], string> = { "=": "var(--muted)", "~": "var(--warn)", "+": "var(--ok)", "-": "var(--danger)" };

function diffSteps(ours: StepDef[], parent: StepDef[]): DiffLine[] {
  const unused = [...parent]; // 未配对的父步骤(配对后移除,保持父版本顺序)
  const lines: DiffLine[] = [];
  for (const a of ours) {
    const idx = unused.findIndex((b) => b.name === a.name);
    if (idx < 0) { lines.push({ mark: "+", text: `${a.name}(${a.type})` }); continue; }
    const [b] = unused.splice(idx, 1);
    const changes: string[] = [];
    if (a.type !== b.type) changes.push(`类型 ${b.type}→${a.type}`);
    if ((a.prompt ?? "") !== (b.prompt ?? "")) changes.push("prompt 改动");
    if ((a.executorRole ?? "") !== (b.executorRole ?? "")) changes.push(`角色 ${b.executorRole ?? "-"}→${a.executorRole ?? "-"}`);
    if (changes.length === 0) lines.push({ mark: "=", text: `${a.name}(${a.type})` });
    else lines.push({ mark: "~", text: `${a.name}(${a.type}):${changes.join("、")}` });
  }
  for (const b of unused) lines.push({ mark: "-", text: `${b.name}(${b.type})` });
  return lines;
}

export function FlowsView({ templates, events }: { templates: TemplateRow[]; events: EventRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const act = async (id: string, action: "clone" | "retire" | "promote") => {
    if (busy) return;
    if (action === "retire" && !window.confirm("确认退役该流程?退役后不再参与自动路由")) return;
    setBusy(`${action}-${id}`);
    try {
      const res = await fetch(`/api/templates/${id}/${action}`, {
        method: "POST",
        ...(action === "retire"
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "手动退役" }) }
          : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setNote(data?.error ?? "操作失败,请重试"); return; }
      router.refresh();
    } catch {
      setNote("网络异常,请重试"); // 失败不改任何状态,原样保留
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      {note && <div className="surface p-2 mb-3 text-sm">{note}</div>}
      {templates.length === 0 && (
        <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>
          暂无流程模板。内置种子流程会在首次使用时创建;进化引擎复盘产出的实验变体也会出现在这里,退役模板可通过克隆重启。
        </div>
      )}
      <div className="space-y-2">
        {templates.map((t) => {
          const stepsCount = parseSteps(t.steps).length;
          const parent = t.parentId ? templates.find((p) => p.id === t.parentId) : undefined;
          const diff = t.status === "experimental" && parent ? diffSteps(parseSteps(t.steps), parseSteps(parent.steps)) : [];
          return (
            <div key={t.id} className="surface p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.name}</span>
                <span
                  className="text-xs px-1.5 rounded"
                  style={{ color: statusColor(t.status), border: `1px solid ${statusColor(t.status)}`, fontWeight: t.status === "active" ? 600 : 400 }}
                >
                  {STATUS_LABEL[t.status] ?? t.status}
                </span>
                <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{ORIGIN_LABEL[t.origin] ?? t.origin}</span>
                <div className="ml-auto flex gap-2">
                  <button onClick={() => act(t.id, "clone")} disabled={!!busy} className="ghost-btn px-2 py-1 text-xs">
                    {busy === `clone-${t.id}` ? "克隆中…" : "克隆"}
                  </button>
                  {(t.status === "active" || t.status === "experimental") && (
                    <button onClick={() => act(t.id, "retire")} disabled={!!busy} className="ghost-btn px-2 py-1 text-xs">
                      {busy === `retire-${t.id}` ? "退役中…" : "退役"}
                    </button>
                  )}
                  {t.status === "experimental" && (
                    <button onClick={() => act(t.id, "promote")} disabled={!!busy} className="ghost-btn px-2 py-1 text-xs">
                      {busy === `promote-${t.id}` ? "晋升中…" : "晋升"}
                    </button>
                  )}
                </div>
              </div>
              <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                复杂度 {t.complexity} · v{t.version} · 谱系 {t.lineageId.slice(0, 8)} · {stepsCount} 步
              </div>
              {t.statRuns > 0 && (
                <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
                  {t.statRuns} 次 · 成功率 {Math.round(t.statSuccessRate * 100)}% · 均 ${t.statAvgCostUsd.toFixed(4)} · 均 {Math.round(t.statAvgDurationMs / 1000)}s
                  {t.statAvgSatisfaction > 0 && ` · 满意 ${t.statAvgSatisfaction.toFixed(1)}`}
                </div>
              )}
              {t.status === "experimental" && (
                <div className="mt-2 pt-2 text-xs" style={{ borderTop: "1px solid var(--border)" }}>
                  <div style={{ color: "var(--muted)" }}>
                    变更理由:{t.description || "未记录"} · 父版本:{parent ? parent.name : "已不存在"}
                  </div>
                  {diff.length > 0 && (
                    <div className="mt-1 font-mono leading-5">
                      {diff.map((d, i) => (
                        <div key={i} style={{ color: DIFF_COLOR[d.mark] }}>{d.mark} {d.text}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <section className="mt-6">
        <h2 className="font-semibold mb-2">进化事件</h2>
        {events.length === 0 ? (
          <div className="surface p-3 text-sm" style={{ color: "var(--muted)" }}>暂无进化事件</div>
        ) : (
          <div className="surface p-3 text-sm space-y-1.5">
            {events.map((ev) => (
              <div key={ev.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{KIND_LABEL[ev.kind] ?? ev.kind}</span>
                {/* 本地化时间由服务端与浏览器各自计算(本地应用同机同区),suppressHydrationWarning 兜底格式差异 */}
                <span className="text-xs tabular-nums" style={{ color: "var(--muted)" }} suppressHydrationWarning>
                  {new Date(ev.ts).toLocaleString("zh-CN", { hour12: false })}
                </span>
                {ev.reason && <span className="text-xs">{ev.reason}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
