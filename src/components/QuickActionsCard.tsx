"use client";
import { useState } from "react";
import type { quickActions } from "@/lib/db/schema";

type ActionRow = typeof quickActions.$inferSelect;

// 面板两态:确认区(preview 响应)或执行结果(confirm 响应);
// map 以 actionId 为键,每次只保留一个面板 —— 点其他按钮整体替换,自动收起上一个
type Panel =
  | { mode: "confirm"; rendered: string; risks: string[] }
  | { mode: "outcome"; status: string | null; output: string };

const OUTPUT_LIMIT = 500; // 结果输出截断,避免长输出撑爆卡片
const STATUS_LABEL: Record<string, string> = { ok: "成功", failed: "失败", timeout: "超时", canceled: "已取消" };

/** 失败提示:服务端 data.error 优先,兜底 fallback */
function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

export function QuickActionsCard({ actions }: { actions: ActionRow[] }) {
  const [busy, setBusy] = useState<string | null>(null); // 按 action id
  const [note, setNote] = useState<string | null>(null);
  const [panels, setPanels] = useState<Record<string, Panel>>({});

  const showPanel = (id: string, p: Panel | null) => setPanels(p ? { [id]: p } : {});

  // confirm 请求:url 型成功拿 url 开新窗;command/launch 型把 run 落成结果面板
  const confirmAction = async (action: ActionRow) => {
    const res = await fetch(`/api/quick-actions/${action.id}/confirm`, { method: "POST" });
    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) {
      setNote(errorOf(data, "执行失败,请重试"));
      return;
    }
    if (action.type === "url") {
      const url = typeof data?.url === "string" ? data.url : "";
      if (!url) {
        setNote("服务端未返回有效链接");
        return;
      }
      showPanel(action.id, null);
      window.open(url, "_blank");
      return;
    }
    const run = data?.run as Record<string, unknown> | undefined;
    showPanel(action.id, {
      mode: "outcome",
      status: typeof run?.status === "string" ? run.status : null,
      output: typeof run?.output === "string" ? run.output.slice(0, OUTPUT_LIMIT) : "",
    });
  };

  // 点动作按钮:url 直接执行;command/launch 先预览出确认区
  const act = async (action: ActionRow) => {
    if (busy) return;
    setBusy(action.id);
    setNote(null);
    try {
      if (action.type === "url") {
        await confirmAction(action);
        return;
      }
      const res = await fetch("/api/quick-actions/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: action.id }), // task_title 可省
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setNote(errorOf(data, "预览失败,请重试"));
        return;
      }
      const rendered = typeof data?.rendered === "string" ? data.rendered : "";
      const rawRisks = data?.risks;
      const risks = Array.isArray(rawRisks) ? rawRisks.filter((r): r is string => typeof r === "string") : [];
      if (data?.awaiting === false) {
        await confirmAction(action); // awaiting:false(url)直接执行,不需确认区
        return;
      }
      showPanel(action.id, { mode: "confirm", rendered, risks });
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  // 确认区按钮:确认执行 / 确认启动
  const doConfirm = async (action: ActionRow) => {
    if (busy) return;
    setBusy(action.id);
    setNote(null);
    try {
      await confirmAction(action);
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(null);
    }
  };

  const entry = Object.entries(panels)[0];
  const panel = entry ? { actionId: entry[0], ...entry[1] } : null;
  const panelAction = panel ? actions.find((a) => a.id === panel.actionId) : undefined;

  return (
    <section className="mb-6">
      <h2 className="font-semibold mb-2">快捷操作</h2>
      {note && <div className="surface p-2 mb-3 text-sm">{note}</div>}
      {actions.length === 0 ? (
        <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>暂无快捷指令</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={!!busy}
              className="ghost-btn px-3 py-1.5 text-sm disabled:opacity-40"
              onClick={() => act(a)}
            >
              {busy === a.id ? "执行中…" : (
                <>
                  {a.icon && <span className="mr-1">{a.icon}</span>}
                  {a.name}
                </>
              )}
            </button>
          ))}
        </div>
      )}
      {panel?.mode === "confirm" && (
        <div className="surface p-3 mt-3">
          <div className="text-sm mb-1">{panelAction?.name ?? "快捷指令"} · 待确认</div>
          {/* command:渲染后的命令;launch:含 claude.cmd 的启动命令预览 */}
          <pre className="text-xs whitespace-pre-wrap surface p-2 mb-2" style={{ color: "var(--muted)" }}>{panel.rendered}</pre>
          {panel.risks.length > 0 && (
            <div className="text-xs mb-2" style={{ color: "var(--warn)" }}>⚠ 命中 {panel.risks.length} 项风险模式</div>
          )}
          <button
            type="button"
            disabled={!!busy}
            className="accent-btn px-3 py-1.5 text-xs disabled:opacity-40"
            onClick={() => panelAction && doConfirm(panelAction)}
          >
            {busy === panel.actionId ? "执行中…" : panelAction?.type === "launch" ? "确认启动" : "确认执行"}
          </button>
        </div>
      )}
      {panel?.mode === "outcome" && (
        <div className="surface p-3 mt-3">
          <div className="text-sm mb-1">
            {panelAction?.name ?? "快捷指令"} ·{" "}
            <span style={{ color: panel.status === "ok" ? "var(--ok)" : "var(--danger)" }}>
              {panel.status ? (STATUS_LABEL[panel.status] ?? panel.status) : "已完成"}
            </span>
          </div>
          <pre className="text-xs whitespace-pre-wrap m-0" style={{ color: "var(--muted)" }}>{panel.output || "(无输出)"}</pre>
        </div>
      )}
    </section>
  );
}
