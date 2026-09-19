"use client";
import { useEffect, useState } from "react";

const KEY = "evodesk-checkins";

type DayMap = Record<string, true>; // yyyy-mm-dd → 打卡

function load(): DayMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as DayMap;
  } catch {
    return {};
  }
}

function save(m: DayMap) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* 忽略 */ }
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 习惯打卡热力图:任意页面点「今日打卡」记一笔;展示最近 12 周 GitHub 风格热力格 + 连击天数。 */
export function CheckinHeatmap() {
  const [days, setDays] = useState<DayMap>({});
  const [just, setJust] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setDays(load()));
    return () => cancelAnimationFrame(raf);
  }, []);

  const today = todayStr();
  const toggle = () => {
    const next = { ...days };
    if (next[today]) delete next[today];
    else next[today] = true;
    setDays(next);
    save(next);
    setJust(!next[today] === false);
    setTimeout(() => setJust(false), 1200);
  };

  // 连击:从今天(或昨天)往回数连续打卡天数
  let streak = 0;
  const cursor = new Date();
  if (!days[todayStr()]) cursor.setDate(cursor.getDate() - 1); // 今天还没打,从昨天起算
  for (;;) {
    const k = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
    if (!days[k]) break;
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  // 最近 12 周(84 天)格子,列=周,行=星期一~日
  const cells: { key: string; on: boolean }[] = [];
  const start = new Date();
  start.setDate(start.getDate() - 83);
  // 对齐到周一
  while (start.getDay() !== 1) start.setDate(start.getDate() - 1);
  const iter = new Date(start);
  const end = new Date();
  while (iter <= end) {
    const k = `${iter.getFullYear()}-${String(iter.getMonth() + 1).padStart(2, "0")}-${String(iter.getDate()).padStart(2, "0")}`;
    cells.push({ key: k, on: !!days[k] });
    iter.setDate(iter.getDate() + 1);
  }

  const total = Object.keys(days).length;

  return (
    <div className="surface p-3 mb-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-sm font-medium">🔥 习惯打卡</span>
        <span className="text-xs" style={{ color: "var(--muted)" }}>累计 {total} 天 · 连击 {streak} 天</span>
        <button className="accent-btn text-xs px-2.5 py-1 ml-auto" onClick={toggle} style={days[today] ? { opacity: 0.6 } : undefined}>
          {days[today] ? "✅ 今日已打卡" : just ? "🎉 打卡成功!" : "今日打卡"}
        </button>
      </div>
      <div className="flex gap-[3px] flex-wrap">
        {cells.map((c) => (
          <span
            key={c.key}
            title={c.key}
            className="inline-block rounded-[2px]"
            style={{ width: 11, height: 11, background: c.on ? "var(--accent)" : "var(--surface-2)" }}
          />
        ))}
      </div>
      <div className="text-xs mt-1.5" style={{ color: "var(--muted)" }}>最近 12 周 · 数据存本机浏览器,配合目标打卡使用</div>
    </div>
  );
}
