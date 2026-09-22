"use client";
import { useState } from "react";

type QaTurn = { q: string; a: string; refs: string[] };

/** Vault QA:对当前资料库自然语言提问,AI 基于检索到的 md 片段回答,引用可点开原文。 */
export function VaultQa({ root, onOpenFile }: { root: string; onOpenFile: (rel: string) => void }) {
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<QaTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const question = q.trim();
    if (busy) return;
    if (!question) {
      // 空问题给可见反馈,而不是 disabled 按钮的"无反应"
      setHint("请先在上方输入框输入问题,再点「提问」");
      setTimeout(() => setHint(null), 2500);
      return;
    }
    setBusy(true);
    setError(null);
    setWaited(0);
    // 活性计时:LLM 检索+生成常需 10-30 秒,让用户知道系统在工作
    const timer = setInterval(() => setWaited((s) => s + 1), 1000);
    try {
      const res = await fetch("/api/vault/qa", { method: "POST", body: JSON.stringify({ root, question }) });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "问答失败");
        return;
      }
      const d = data as { answer: string; refs: string[] };
      setTurns((t) => [...t, { q: question, a: d.answer, refs: d.refs ?? [] }]);
      setQ("");
      setTimeout(() => {
        document.getElementById("qa-latest")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
    } catch {
      setError("请求失败");
    } finally {
      clearInterval(timer);
      setBusy(false);
    }
  };

  return (
    <div className="surface p-3 mb-4">
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <span className="text-sm font-medium">💬 问我的知识库</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>AI 基于检索到的 md 内容回答,附引用来源</span>
      </div>
      <div className="flex gap-1.5 items-center mb-1">
        <input className="input text-xs flex-1" placeholder="例:我的部署流程是什么?哪些笔记提到 Agent?"
          value={q} onChange={(e) => { setQ(e.target.value); if (hint) setHint(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void ask(); }} disabled={busy} />
        <button className="accent-btn text-xs px-3 py-1" onClick={() => void ask()} disabled={busy}>
          {busy ? `思考中…(${waited}s)` : "提问"}
        </button>
      </div>
      {hint && <div className="text-xs mt-1" style={{ color: "var(--warn)" }}>{hint}</div>}
      {busy && waited >= 3 && (
        <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>正在检索库内 md 片段并调用模型,通常 10-30 秒,请稍候…</div>
      )}
      {error && <div className="text-xs mt-1" style={{ color: "var(--danger)" }}>{error}</div>}
      {turns.map((t, i) => (
        <div key={i} id={i === turns.length - 1 ? "qa-latest" : undefined} className="rounded p-2 mt-2 text-xs" style={{ border: "1px solid var(--border)" }}>
          <div className="font-medium mb-1">Q:{t.q}</div>
          <div className="whitespace-pre-wrap mb-1.5" style={{ color: "var(--text)" }}>{t.a}</div>
          {t.refs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {t.refs.map((r) => (
                <button key={r} className="ghost-btn text-xs px-1.5 py-0.5" onClick={() => onOpenFile(r)} title={r}>
                  📄 {r.split("/").pop()}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
