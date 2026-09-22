"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Issue = {
  id: string; source: string; sourceId: string; sourceLabel: string;
  errorText: string; status: string; cause: string;
  fixKind: string; fixStatus: string; fixAttempts: number; fixResult: string;
  aiAnalysis: string; createdAt: string; updatedAt: string;
};
type Stats = { total: number; open: number; fixed: number; needsHuman: number; pendingFix: number };

const SOURCE_LABEL: Record<string, string> = { job: "求职雷达", step: "任务流程", quick_action: "快捷指令" };
const FIX_LABEL: Record<string, string> = {
  retry_step: "重试步骤", rerun_setup: "重启 Chrome", retry_job: "重跑抓取",
  needs_human: "需人工", none: "无法自动修复",
};

function errorOf(data: unknown, fallback: string): string {
  const err = data && typeof data === "object" ? (data as Record<string, unknown>).error : null;
  return typeof err === "string" && err ? err : fallback;
}

// 自我进化 · 自愈中心:失败自动入账(任务步骤/求职雷达/快捷指令三类钩子),
// 启发式诊断 + AI 补充分析 + 有界自动修复(重试/重启/重跑);需人工的给出明确指引。
export function SelfHealView() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/self-heal");
      const data = (await res.json()) as { issues?: Issue[]; stats?: Stats };
      setIssues(data.issues ?? []);
      setStats(data.stats ?? null);
    } catch {
      setError("加载失败,请刷新重试");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const raf = requestAnimationFrame(() => { void load(); });
    return () => cancelAnimationFrame(raf);
  }, [load]);

  const act = useCallback(async (action: string, id?: string) => {
    if (busy) return;
    setBusy(action + (id ?? ""));
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/self-heal", { method: "POST", body: JSON.stringify({ action, ...(id ? { id } : {}), force: action === "fix" && !!id }) });
      const data = await res.json();
      if (!res.ok && !data.results) {
        setError(errorOf(data, "操作失败"));
        return;
      }
      if (action === "scan") setNotice(`扫描完成:新增 ${data.created} 个 issue`);
      else if (action === "fix" && id) setNotice(`修复${data.ok ? "成功" : "未成功"}:${data.result ?? ""}`);
      else if (action === "fix") setNotice(`批量修复:${data.fixed}/${data.total} 个已自动修复`);
      else if (action === "analyze" && !id) setNotice(`AI 分析完成:${data.analyzed} 个`);
      else if (action === "ignore") setNotice("已忽略");
      await load();
    } catch {
      setError("请求失败,请重试");
    } finally {
      setBusy(null);
    }
  }, [busy, load]);

  // 自动修复:页面加载后对"重试任务步骤"类自动执行一轮(ref 防重入,单轮最多 3 个);
  // rerun_setup/retry_job 会拉起真实浏览器进程,仅保留手动「一键修复」触发
  const autoFixDone = useRef(false);
  useEffect(() => {
    if (loading || autoFixDone.current) return;
    autoFixDone.current = true;
    const targets = issues
      .filter((i) => i.status === "open" && i.fixKind === "retry_step" && i.fixStatus !== "applied")
      .slice(0, 3);
    void (async () => {
      for (const t of targets) await act("fix", t.id);
    })();
  }, [loading, issues, act]); // act 已用 useCallback 稳定;ref 保证本自动修复只执行一次

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">自我进化 · 自愈中心</h1>
      <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
        失败自动入账(任务步骤 / 求职雷达 / 快捷指令)→ 启发式诊断 → 自动修复有界重试(重试步骤 / 重启 Chrome /
        重跑抓取);超出能力范围标记「需人工」并给出指引。修复动作全部留痕,不删除任何数据。
      </p>

      {stats && (
        <div className="flex flex-wrap gap-2 mb-4">
          <span className="text-xs px-2.5 py-1.5 rounded" style={{ background: "var(--surface-2)" }}>累计 {stats.total}</span>
          <span className="text-xs px-2.5 py-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--warn)" }}>待处理 {stats.open}</span>
          <span className="text-xs px-2.5 py-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--ok)" }}>已修复 {stats.fixed}</span>
          <span className="text-xs px-2.5 py-1.5 rounded" style={{ background: "var(--surface-2)" }}>可自动修复 {stats.pendingFix}</span>
          <span className="text-xs px-2.5 py-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--danger)" }}>需人工 {stats.needsHuman}</span>
        </div>
      )}

      <div className="surface p-3 mb-4">
        <div className="flex flex-wrap gap-2 items-center">
          <button className="accent-btn text-xs px-3 py-1.5" onClick={() => void act("scan")} disabled={busy === "scan"}>扫描失败记录</button>
          <button className="ghost-btn text-xs px-3 py-1.5" onClick={() => void act("analyze")} disabled={busy === "analyze"}>🤖 AI 分析未处理的</button>
          <button className="accent-btn text-xs px-3 py-1.5" onClick={() => void act("fix")} disabled={busy === "fix"}>⚡ 一键修复可修复项</button>
          {loading && <span className="text-xs" style={{ color: "var(--muted)" }}>加载中…</span>}
        </div>
        {error && <div className="text-xs mt-2" style={{ color: "var(--danger)" }}>{error}</div>}
        {notice && <div className="text-xs mt-2" style={{ color: "var(--accent)" }}>{notice}</div>}
      </div>

      {issues.length === 0 ? (
        <div className="surface p-6 text-sm text-center" style={{ color: "var(--muted)" }}>
          {loading ? "" : "还没有失败记录。点「扫描失败记录」回溯历史失败,或正常使用——出现失败会自动入账。"}
        </div>
      ) : (
        <div className="space-y-2">
          {issues.map((i) => (
            <div key={i.id} className="surface p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)" }}>{SOURCE_LABEL[i.source] ?? i.source}</span>
                <span className="font-medium truncate max-w-64" title={i.sourceLabel}>{i.sourceLabel}</span>
                <span className="text-xs px-1.5 py-0.5 rounded" style={{
                  background: "var(--surface-2)",
                  color: i.status === "fixed" ? "var(--ok)" : i.fixStatus === "needs_human" ? "var(--danger)" : "var(--muted)",
                }}>{i.status === "fixed" ? "✅ 已修复" : FIX_LABEL[i.fixKind] ?? i.fixKind}</span>
                {i.fixAttempts > 0 && <span className="text-xs" style={{ color: "var(--muted)" }}>已试 {i.fixAttempts} 次</span>}
                <span className="text-xs ml-auto" style={{ color: "var(--muted)" }}>{new Date(i.updatedAt).toLocaleString()}</span>
              </div>
              <div className="text-xs mt-1.5 truncate" style={{ color: "var(--muted)" }}>
                诊断:{i.cause || "—"}
              </div>
              {i.aiAnalysis && <div className="text-xs mt-1" style={{ color: "var(--accent)" }}>🤖 {i.aiAnalysis}</div>}
              {i.fixResult && <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>修复记录:{i.fixResult}</div>}
              <div
                className="text-xs mt-1.5 cursor-pointer select-none"
                style={{ color: "var(--muted)" }}
                onClick={() => setExpanded(expanded === i.id ? null : i.id)}
              >
                {expanded === i.id ? "▾ 错误详情" : "▸ 错误详情"}
              </div>
              {expanded === i.id && (
                <pre className="text-xs whitespace-pre-wrap mt-1 p-2 rounded max-h-40 overflow-auto m-0" style={{ background: "var(--surface-2)", fontFamily: "inherit" }}>{i.errorText}</pre>
              )}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {i.status === "open" && i.fixKind !== "none" && i.fixKind !== "needs_human" && (
                  <button className="accent-btn text-xs px-2 py-1" onClick={() => void act("fix", i.id)} disabled={!!busy}>
                    {i.fixAttempts >= 2 ? "🔧 手动修复(不受自动上限限制)" : "⚡ 自动修复"}
                  </button>
                )}
                <button className="ghost-btn text-xs px-2 py-1" onClick={() => void act("analyze", i.id)} disabled={busy === "analyze" + i.id}>
                  {busy === "analyze" + i.id ? "分析中…" : "🤖 AI 分析"}
                </button>
                {i.status === "open" && (
                  <button className="ghost-btn text-xs px-2 py-1 ml-auto" onClick={() => void act("ignore", i.id)}>忽略</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
