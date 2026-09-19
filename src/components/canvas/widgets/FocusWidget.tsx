"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "idle" | "focus" | "break";

// 番茄钟专注组件:25 分钟专注 / 5 分钟休息,本轮结束自动切换并计数。
// 结束专注时弹出「这段时间做了什么?」一句话日志 → 存为灵感笔记(POST /api/notes)。
// 纯客户端计时,不持久化运行态(刷新重置,会话计数保留在 localStorage)。
export function FocusWidget() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [remain, setRemain] = useState(25 * 60);
  const [rounds, setRounds] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [logDraft, setLogDraft] = useState("");
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const deadlineRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    try { setRounds(Number(localStorage.getItem("evodesk-focus-rounds") ?? "0") || 0); } catch { /* 忽略 */ }
  }, []);

  const stop = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }, []);

  const start = (p: Exclude<Phase, "idle">) => {
    stop();
    setPhase(p);
    setRemain(p === "focus" ? 25 * 60 : 5 * 60);
    deadlineRef.current = Date.now() + (p === "focus" ? 25 * 60 : 5 * 60) * 1000;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.round((deadlineRef.current - Date.now()) / 1000));
      setRemain(left);
      if (left <= 0) {
        stop();
        if (p === "focus") {
          setRounds((r) => {
            const n = r + 1;
            try { localStorage.setItem("evodesk-focus-rounds", String(n)); } catch { /* 忽略 */ }
            return n;
          });
          setPhase("break");
          setRemain(5 * 60);
          setLogOpen(true); // 专注结束 → 问一句做了什么
        } else {
          setPhase("idle");
        }
      }
    }, 500);
  };

  useEffect(() => stop, [stop]);

  const saveLog = async () => {
    const title = logDraft.trim();
    setLogOpen(false);
    setLogDraft("");
    if (!title) return;
    try {
      await fetch("/api/notes", { method: "POST", body: JSON.stringify({ title: `🍅 ${title}` }) });
      setSavedMsg("已存入灵感笔记");
      setTimeout(() => setSavedMsg(null), 2500);
    } catch { /* 保存失败静默 */ }
  };

  const mm = String(Math.floor(remain / 60)).padStart(2, "0");
  const ss = String(remain % 60).padStart(2, "0");
  const label = phase === "focus" ? "🍅 专注中" : phase === "break" ? "☕ 休息" : "准备开始";

  return (
    <div className="text-center py-1">
      <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{label} · 已完成 {rounds} 轮</div>
      <div className="text-4xl font-bold tabular-nums my-1" style={{ color: phase === "focus" ? "var(--accent)" : "var(--text)" }}>{mm}:{ss}</div>
      <div className="flex justify-center gap-2 mt-2">
        {phase === "idle" && <button className="accent-btn text-xs px-4 py-1.5" onClick={() => start("focus")}>开始专注 25′</button>}
        {phase === "focus" && <button className="ghost-btn text-xs px-3 py-1.5" onClick={() => { stop(); setPhase("idle"); setRemain(25 * 60); }}>放弃</button>}
        {phase === "break" && <button className="accent-btn text-xs px-4 py-1.5" onClick={() => start("focus")}>再来一轮</button>}
      </div>
      {logOpen && (
        <div className="mt-2 text-left">
          <input className="input text-xs w-full" autoFocus placeholder="这段时间做了什么?(回车存为灵感笔记)"
            value={logDraft}
            onChange={(e) => setLogDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void saveLog(); }} />
          <div className="flex gap-1.5 mt-1">
            <button className="accent-btn text-xs px-2 py-0.5" onClick={() => void saveLog()}>存笔记</button>
            <button className="ghost-btn text-xs px-2 py-0.5" onClick={() => setLogOpen(false)}>跳过</button>
          </div>
        </div>
      )}
      {savedMsg && <div className="text-xs mt-1" style={{ color: "var(--ok)" }}>{savedMsg}</div>}
    </div>
  );
}
