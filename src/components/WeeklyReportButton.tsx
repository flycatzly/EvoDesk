"use client";
import { useCallback, useEffect, useState } from "react";

const KEY = "evodesk-weekly-report-date";

/** 周报生成:本周日提醒,任意时刻可手动生成;每周只自动提醒一次(localStorage 记忆)。 */
export function WeeklyReportButton() {
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [shouldRemind, setShouldRemind] = useState(false);

  const isSunday = () => new Date().getDay() === 0;

  const generate = useCallback(async () => {
    setGenerating(true);
    setNotice(null);
    try {
      const res = await fetch("/api/weekly-report", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; title?: string; error?: string };
      if (res.ok && data.ok) {
        setNotice({ ok: true, text: `已生成《${data.title}》并存入「内容灵感」` });
        try { localStorage.setItem(KEY, new Date().toISOString().slice(0, 10)); } catch { /* 忽略 */ }
        setShouldRemind(false);
      } else {
        setNotice({ ok: false, text: data.error ?? "生成失败" });
      }
    } catch {
      setNotice({ ok: false, text: "网络异常" });
    } finally {
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    // 周日首次访问提醒;本周已生成过则不打扰
    const raf = requestAnimationFrame(() => {
      if (!isSunday()) return;
      try {
        const last = localStorage.getItem(KEY) ?? "";
        const weekAgo = Date.now() - 7 * 86400_000;
        if (!last || new Date(last).getTime() < weekAgo) setShouldRemind(true);
      } catch { setShouldRemind(true); }
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="surface p-3 mb-4 flex items-center gap-2 flex-wrap text-sm">
      <span className="font-medium">🗂️ AI 周报</span>
      <button className="accent-btn text-xs px-3 py-1.5" onClick={() => void generate()} disabled={generating}>
        {generating ? "AI 生成中…(约 30 秒)" : "生成本周周报(存入灵感笔记)"}
      </button>
      {shouldRemind && !generating && <span className="text-xs" style={{ color: "var(--warn)" }}>今天是周日,别忘了生成本周周报 📬</span>}
      {notice && <span className="text-xs" style={{ color: notice.ok ? "var(--ok)" : "var(--danger)" }}>{notice.text}</span>}
    </div>
  );
}
