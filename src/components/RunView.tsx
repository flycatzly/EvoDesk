"use client";
// 执行视图:步骤时间线 + 当前步骤动作面板 + SSE 流式输出。
// 稳定性约定(与 M1/M2 一致):所有 fetch 包 try/catch/finally 并检查 res.ok;
// 失败只 setNote 不丢用户输入;按钮统一 busy 防重入;本页无 Enter 提交,无需 IME 守卫。
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { flowRuns, stepRuns } from "@/lib/db/schema";

type FlowRun = typeof flowRuns.$inferSelect;
type StepRun = typeof stepRuns.$inferSelect;
export type StepDefLite = { name: string; type: string; instruction?: string; command?: string; optional?: boolean };

const TYPE_ICON: Record<string, string> = { llm: "🤖", manual: "✍️", checkpoint: "✅", script: "⚙️" };
const STEP_STATUS: Record<string, string> = {
  pending: "待执行", awaiting_confirmation: "待确认", running: "执行中",
  done: "完成", skipped: "已跳过", failed: "失败",
};
const STEP_TERMINAL = ["done", "skipped"];

export function StartButton({ taskId, disabled }: { taskId: string; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="flex gap-2 items-center">
      <button
        type="button"
        disabled={disabled || busy}
        className="accent-btn px-4 py-2 text-sm disabled:opacity-40"
        onClick={async () => {
          if (busy) return;
          setBusy(true);
          setNote(null);
          try {
            const res = await fetch(`/api/tasks/${taskId}/start`, { method: "POST" });
            if (res.ok) { window.location.reload(); return; }
            const d = await res.json().catch(() => null);
            setNote(d && typeof d.error === "string" ? d.error : "开始失败,请重试");
          } catch {
            setNote("开始失败,请重试");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "启动中…" : "开始执行"}
      </button>
      {disabled && <span className="text-xs" style={{ color: "var(--muted)" }}>仅就绪任务可开始执行</span>}
      {note && <span className="text-xs" style={{ color: "var(--danger)" }}>{note}</span>}
    </div>
  );
}

export function RunView({ taskId: _taskId, taskStatus, run, steps, stepDefs }: {
  taskId: string;
  taskStatus: string;
  run: FlowRun;
  steps: StepRun[];
  stepDefs: StepDefLite[];
}) {
  const router = useRouter();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState(""); // manual 产出 / 人工接管产出(复用)
  const [rejectNote, setRejectNote] = useState("");
  const [streamText, setStreamText] = useState("");
  const [risks, setRisks] = useState<string[]>([]);
  const [satisfaction, setSatisfaction] = useState(run.satisfaction ?? 0);
  const [outcome, setOutcome] = useState("");
  // 去重并发触发的 effect(流进行中不重复 advance);dev StrictMode 卸载重挂会再触发一次,
  // 属良性:llm execute 无副作用,stream 路由的条件 UPDATE 抢占保证单流,败者 409 走轮询恢复
  const streamingRef = useRef(false);
  const pollActiveRef = useRef(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const current = steps.find((s) => !STEP_TERMINAL.includes(s.status)) ?? null;
  const stepIndex = current?.stepIndex; // 提升为原始绑定:react-compiler 要求 deps 与推断依赖一致
  const def = current ? stepDefs[current.stepIndex] : undefined;

  // 409-正在执行 兜底(回导航/刷新返回时步骤已在服务端执行):轮询至该步骤离开 running 再刷新,不报错
  const pollRunning = useCallback(async () => {
    if (pollActiveRef.current) return;
    pollActiveRef.current = true;
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        if (!aliveRef.current) return;
        try {
          const res = await fetch(`/api/runs/${run.id}`);
          if (!res.ok) return;
          const data = await res.json();
          const s = (data.steps as { stepIndex: number; status: string }[]).find((x) => x.stepIndex === stepIndex);
          if (!s || s.status !== "running") { router.refresh(); return; }
        } catch { return; }
      }
    } finally {
      pollActiveRef.current = false;
    }
  }, [run.id, stepIndex, router]);

  // advance 封装:成功返回响应体;"正在执行"类失败静默转轮询并返回 null;其余失败 setNote 返回 null
  const advance = useCallback(async (action: string, extra?: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    try {
      const res = await fetch(`/api/runs/${run.id}/steps/${stepIndex}/advance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      const data = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (res.ok && data) return data;
      // 双保险:优先机器可读 code(step_running),保留文案 includes 兜底
      if (data?.code === "step_running" || (typeof data?.error === "string" && data.error.includes("正在执行"))) {
        pollRunning();
        return null;
      }
      setNote("操作失败,请重试");
      return null;
    } catch {
      setNote("操作失败,请重试");
      return null;
    }
  }, [run.id, stepIndex, pollRunning]);

  const act = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const data = await advance(action, extra);
      if (data) {
        // script 确认门:execute 响应携带 {command, risks, awaiting},风险列表存状态供确认面板渲染
        if (data.awaiting === true) setRisks(Array.isArray(data.risks) ? (data.risks as string[]) : []);
        // 成功才清空:失败路径保留用户输入;接管/提交成功后清空,避免旧产出残留在后续面板
        if (action === "submit" || action === "manual_override") setInput("");
        if (action === "reject") setRejectNote("");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }, [busy, advance, router]);

  // 自动执行:run 运行中且当前步骤为 pending llm 时,advance(execute) 后挂 EventSource 消费流;
  // 若挂载时步骤已是 running(中途离开再返回),不重复触发,转轮询等待结果。
  useEffect(() => {
    if (run.status !== "running" || !current || current.executorType !== "llm") return;
    if (current.status === "running") { pollRunning(); return; }
    if (current.status !== "pending" || streamingRef.current) return;
    streamingRef.current = true;
    let disposed = false;
    let es: EventSource | null = null;
    (async () => {
      const started = await advance("execute");
      if (!started || disposed) { streamingRef.current = false; return; }
      const streamPath = typeof started.stream === "string" ? started.stream : null;
      if (!streamPath) { streamingRef.current = false; return; }
      es = new EventSource(streamPath);
      es.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as { delta?: string; done?: boolean };
          if (msg.delta) setStreamText((t) => t + msg.delta);
          if (msg.done) {
            es?.close();
            streamingRef.current = false;
            setStreamText("");
            router.refresh();
          }
        } catch { /* 坏帧忽略,以轮询兜底 */ }
      };
      // 瞬断/正常关闭都可能触发 onerror:不 setNote,关闭后以轮询结果决定刷新
      es.onerror = () => {
        es?.close();
        streamingRef.current = false;
        pollRunning();
      };
    })();
    return () => { disposed = true; es?.close(); streamingRef.current = false; setStreamText(""); };
  }, [run.status, current, advance, pollRunning, router]);

  const cancelRun = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/runs/${run.id}/cancel`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        setNote(d && typeof d.error === "string" ? d.error : "取消失败,请重试");
        return;
      }
      router.refresh();
    } catch {
      setNote("取消失败,请重试");
    } finally {
      setBusy(false);
    }
  };

  const submitFeedback = async () => {
    if (busy || satisfaction < 1) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/runs/${run.id}/feedback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ satisfaction, outcome_note: outcome }),
      });
      if (!res.ok) { setNote("提交失败,请重试"); return; }
      router.refresh();
    } catch {
      setNote("提交失败,请重试");
    } finally {
      setBusy(false);
    }
  };

  const actionRow = "accent-btn px-3 py-1.5 text-xs disabled:opacity-40";
  const ghostRow = "px-3 py-1.5 text-xs disabled:opacity-40";

  const panel = () => {
    if (!current) {
      const label = { done: "执行完成", failed: "执行失败", canceled: "已取消" }[run.status];
      return label ? <div className="text-sm mb-4" style={{ color: "var(--muted)" }}>{label}</div> : null;
    }
    const instruction = def?.instruction ?? "请完成该步骤";
    const skippable = def?.optional ?? false;
    if (current.executorType === "llm") {
      if (current.status === "running" || current.status === "pending") {
        return (
          <div className="surface p-3 mb-4">
            <div className="text-sm mb-2">{def?.name ?? current.stepName} · 执行中…</div>
            <pre className="text-xs whitespace-pre-wrap m-0" style={{ color: "var(--muted)" }}>{current.output || streamText || "…"}</pre>
            {current.status === "pending" && skippable && (
              <div className="flex gap-2 mt-2">
                <button type="button" disabled={busy} className={ghostRow} onClick={() => act("skip")}>跳过</button>
              </div>
            )}
          </div>
        );
      }
      if (current.status === "failed") {
        return (
          <div className="surface p-3 mb-4">
            <div className="text-sm mb-1">{def?.name ?? current.stepName}</div>
            <div className="text-xs mb-2" style={{ color: "var(--danger)" }}>{current.error ?? "执行失败"}</div>
            <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={4} placeholder="人工产出(必填,后续步骤将以其作为上游输入)" value={input} onChange={(e) => setInput(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" disabled={busy} className={actionRow} onClick={() => act("retry")}>重试</button>
              <button type="button" disabled={busy || !input.trim()} className={ghostRow} onClick={() => act("manual_override", { output: input })}>人工填写</button>
            </div>
          </div>
        );
      }
    }
    if (current.executorType === "manual" && current.status === "pending") {
      return (
        <div className="surface p-3 mb-4">
          <div className="text-sm mb-1">{def?.name ?? current.stepName}</div>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>{instruction}</div>
          <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={4} value={input} onChange={(e) => setInput(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" disabled={busy || !input.trim()} className={actionRow} onClick={() => act("submit", { output: input })}>提交产出</button>
            {skippable && <button type="button" disabled={busy} className={ghostRow} onClick={() => act("skip")}>跳过</button>}
          </div>
        </div>
      );
    }
    if (current.executorType === "checkpoint" && current.status === "pending") {
      return (
        <div className="surface p-3 mb-4">
          <div className="text-sm mb-1">{def?.name ?? current.stepName}</div>
          <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>{instruction}</div>
          <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={2} placeholder="打回原因(打回上一步时必填)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" disabled={busy} className={actionRow} onClick={() => act("approve")}>通过</button>
            <button type="button" disabled={busy || !rejectNote.trim()} className={ghostRow} onClick={() => act("reject", { note: rejectNote })}>打回上一步</button>
          </div>
        </div>
      );
    }
    if (current.executorType === "script") {
      if (current.status === "pending") {
        return (
          <div className="surface p-3 mb-4">
            <div className="text-sm mb-1">{def?.name ?? current.stepName}</div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} className={actionRow} onClick={() => act("execute")}>执行脚本</button>
              {skippable && <button type="button" disabled={busy} className={ghostRow} onClick={() => act("skip")}>跳过</button>}
            </div>
          </div>
        );
      }
      if (current.status === "awaiting_confirmation") {
        return (
          <div className="surface p-3 mb-4">
            <div className="text-sm mb-1">{def?.name ?? current.stepName} · 待确认</div>
            <pre className="text-xs whitespace-pre-wrap surface p-2 mb-2" style={{ color: "var(--muted)" }}>{current.input ?? def?.command ?? ""}</pre>
            {risks.length > 0 && <div className="text-xs mb-2" style={{ color: "var(--warn)" }}>⚠ 命中风险模式:{risks.join("、")}</div>}
            <div className="flex gap-2">
              <button type="button" disabled={busy} className={actionRow} onClick={() => act("confirm")}>确认执行</button>
            </div>
          </div>
        );
      }
      if (current.status === "done") {
        return (
          <div className="surface p-3 mb-4">
            <div className="text-sm mb-2">{def?.name ?? current.stepName} · 完成</div>
            <pre className="text-xs whitespace-pre-wrap m-0" style={{ color: "var(--muted)" }}>{current.output || "…"}</pre>
          </div>
        );
      }
      if (current.status === "failed") {
        return (
          <div className="surface p-3 mb-4">
            <div className="text-sm mb-1">{def?.name ?? current.stepName}</div>
            <div className="text-xs mb-2" style={{ color: "var(--danger)" }}>{current.error ?? "执行失败"}</div>
            <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={4} placeholder="人工产出(必填,后续步骤将以其作为上游输入)" value={input} onChange={(e) => setInput(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" disabled={busy} className={actionRow} onClick={() => act("retry")}>重试</button>
              <button type="button" disabled={busy || !input.trim()} className={ghostRow} onClick={() => act("manual_override", { output: input })}>人工填写</button>
            </div>
          </div>
        );
      }
    }
    return null;
  };

  return (
    <div>
      {note && <div className="surface p-2 mb-3 text-xs" style={{ color: "var(--danger)" }}>{note}</div>}
      {["running", "waiting_human"].includes(run.status) && (
        <div className="flex justify-end mb-2">
          <button type="button" disabled={busy} className={ghostRow} style={{ color: "var(--danger)" }} onClick={cancelRun}>取消执行</button>
        </div>
      )}
      {/* 规格 §11:左时间线右操作区;窄屏 grid 单列自然堆叠。min-w-0 防 grid 子项被长 token 撑破 */}
      <div className="grid md:grid-cols-[240px_1fr] gap-4">
        <div className="min-w-0">
          {steps.map((s) => (
            <div key={s.id} className="p-2 mb-1 text-sm" style={{ border: "1px solid var(--border)", borderColor: current?.id === s.id ? "var(--accent)" : "var(--border)", borderRadius: 10 }}>
              <div className="flex items-center gap-2 flex-wrap">
                <span>{TYPE_ICON[s.executorType] ?? "•"}</span>
                <span>{s.stepName}</span>
                <span className="text-xs" style={{ color: s.status === "failed" ? "var(--danger)" : "var(--muted)" }}>{STEP_STATUS[s.status] ?? s.status}</span>
                {s.status === "done" && (
                  <span className="text-xs" style={{ color: "var(--muted)" }}>
                    {s.tokensIn > 0 && ` · ${s.tokensIn}→${s.tokensOut} tok`}
                    {s.costUsd > 0 && ` · $${s.costUsd.toFixed(4)}`}
                    {s.durationMs > 0 && ` · ${(s.durationMs / 1000).toFixed(1)}s`}
                  </span>
                )}
                {s.rejected > 0 && <span className="text-xs" style={{ color: "var(--danger)" }}>被退回 {s.rejected} 次</span>}
              </div>
              {/* done 产出回看:明细(tokens/cost/duration)已在上方 meta 行,details 只放 output,避免重复展示 */}
              {s.status === "done" && s.output && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs" style={{ color: "var(--muted)" }}>查看产出</summary>
                  <pre className="text-xs whitespace-pre-wrap m-0 mt-1 surface p-2" style={{ color: "var(--muted)" }}>
                    {s.output.length > 2000 ? `${s.output.slice(0, 2000)}…` : s.output}
                  </pre>
                </details>
              )}
            </div>
          ))}
        </div>
        <div className="min-w-0">{panel()}</div>
      </div>
      {taskStatus === "review" && (
        <div className="surface p-3">
          <div className="text-sm font-semibold mb-2">评审</div>
          <div className="flex gap-1 mb-2">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" disabled={busy} className="text-lg leading-none" style={{ color: n <= satisfaction ? "var(--warn)" : "var(--border)" }} onClick={() => setSatisfaction(n)}>★</button>
            ))}
          </div>
          <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={2} placeholder="结论(可选)" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
          <button type="button" disabled={busy || satisfaction < 1} className={actionRow} onClick={submitFeedback}>提交评审</button>
        </div>
      )}
    </div>
  );
}
