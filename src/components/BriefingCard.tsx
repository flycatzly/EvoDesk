"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "evodesk-briefing-date";

/** AI 今日简报卡片:每天首次打开自动生成一次(按本地日期记忆),可手动刷新。 */
export function BriefingCard() {
  const [brief, setBrief] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(true);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/briefing", { method: "POST" });
      const data = (await res.json()) as { brief?: string; error?: string };
      if (!res.ok || !data.brief) {
        setError(data.error ?? "生成失败");
        return;
      }
      setBrief(data.brief);
      try { localStorage.setItem(KEY, new Date().toISOString().slice(0, 10)); } catch { /* 忽略 */ }
    } catch {
      setError("请求失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 每天首次访问自动生成;当天已生成过则不重复调 AI
    const raf = requestAnimationFrame(() => {
      let today = "";
      let last = "";
      try {
        today = new Date().toISOString().slice(0, 10);
        last = localStorage.getItem(KEY) ?? "";
      } catch { /* 隐私模式:每次手动 */ }
      setDismissed(false);
      if (today && last !== today) void generate();
    });
    return () => cancelAnimationFrame(raf);
  }, [generate]);

  if (dismissed) return null;

  return (
    <div className="surface p-3 mb-4 text-sm" style={{ borderColor: "var(--accent)" }}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-medium">🌅 今日简报</span>
        {loading && <span className="text-xs" style={{ color: "var(--muted)" }}>AI 生成中…</span>}
        <button className="ghost-btn text-xs px-1.5 py-0.5 ml-auto" onClick={() => void generate()} disabled={loading} title="重新生成">↻</button>
        <button className="ghost-btn text-xs px-1.5 py-0.5" onClick={() => setDismissed(true)} aria-label="收起简报">✕</button>
      </div>
      {error && <div className="text-xs" style={{ color: "var(--danger)" }}>{error}(未配置 AI 时此卡片只作提醒,可在设置配置执行器)</div>}
      {brief && <div className="text-sm whitespace-pre-wrap" style={{ color: "var(--text)" }}>{brief}</div>}
      {!brief && !loading && !error && <div className="text-xs" style={{ color: "var(--muted)" }}>点击 ↻ 生成今日简报</div>}
    </div>
  );
}
