"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { tasks } from "@/lib/db/schema";

type Task = typeof tasks.$inferSelect;

// 简化自 TaskCard:日历条目只需状态徽章文案 + 跳转
const STATUS_LABEL: Record<string, string> = {
  inbox: "收件箱", triaging: "分诊中", ready: "就绪", running: "执行中",
  waiting_human: "待人工", review: "评审", done: "完成", archived: "归档", canceled: "已取消",
};
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

// 同 TaskCard 的链接映射,差别仅 done 也可点进执行视图回看(与看板 LINKABLE_STATUSES 一致);归档类回看板锚点
function taskHref(t: Task): string {
  if (["inbox", "triaging"].includes(t.status)) return "/inbox";
  if (["ready", "running", "waiting_human", "review", "done"].includes(t.status)) return `/tasks/${t.id}`;
  return `/tasks#task-${t.id}`;
}

// 与仪表盘 active 口径一致(日历数据已排除 canceled,这里兜底防御)
const isActive = (t: Task) => !["done", "archived", "canceled"].includes(t.status);

export function CalendarView({ tasks, month, todayStr }: { tasks: Task[]; month: string; todayStr: string }) {
  const router = useRouter();
  const [selectedKey, setSelectedKey] = useState(todayStr);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // 6 行 × 7 列月网格(周一起,周一在第一列):前后月补位 inMonth=false 灰显。
  // 日期运算全程 UTC(Date.UTC + setUTCDate),避免本地时区导致的跨月漂移。
  const cells = useMemo(() => {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const start = new Date(first);
    start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7)); // 回退到当月 1 日所在周的周一
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const dateKey = d.toISOString().slice(0, 10);
      return { dateKey, dayNum: d.getUTCDate(), inMonth: dateKey.slice(0, 7) === month };
    });
  }, [month]);

  // dueDate → 当日任务(全量在服务端已过滤:dueDate 非空且未取消)
  const byDue = useMemo(() => {
    const map: Record<string, Task[]> = {};
    for (const t of tasks) {
      if (!t.dueDate) continue;
      (map[t.dueDate] ??= []).push(t);
    }
    return map;
  }, [tasks]);

  const [year, monthNum] = month.split("-").map(Number);
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(year, monthNum - 1 + delta, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };

  const dayTasks = byDue[selectedKey] ?? [];
  const [sy, sm, sd] = selectedKey.split("-").map(Number);

  const select = (key: string) => {
    setSelectedKey(key);
    setTitle(""); // 换日不残留上一日的半截输入
    setNote(null);
  };

  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmed, due_date: selectedKey }),
      });
      if (!res.ok) { setNote("保存失败,请重试"); return; } // 失败保留输入,不丢用户敲的字
      setTitle("");
      router.refresh(); // 服务端重渲,格子计数与当日列表即时反映新任务
    } catch {
      setNote("网络异常,请重试");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* 顶栏:翻页 + 当月标题 */}
      <div className="flex items-center justify-between mb-3">
        <button className="ghost-btn px-3 py-1.5 text-sm" onClick={() => router.push(`/calendar?m=${shiftMonth(-1)}`)}>{"< 上月"}</button>
        <h2 className="font-semibold">{year}年{monthNum}月</h2>
        <button className="ghost-btn px-3 py-1.5 text-sm" onClick={() => router.push(`/calendar?m=${shiftMonth(1)}`)}>{"下月 >"}</button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 mb-1.5">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-xs text-center" style={{ color: "var(--muted)" }}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {cells.map((c) => {
          const dayList = byDue[c.dateKey] ?? [];
          const hasActive = dayList.some(isActive); // 全为完成/归档的日子用更淡的计数点
          const isToday = c.dateKey === todayStr;
          const isSelected = c.dateKey === selectedKey;
          return (
            <button
              key={c.dateKey}
              onClick={() => select(c.dateKey)}
              className={`relative surface p-1.5 text-left ${c.inMonth ? "" : "opacity-40"}`}
              style={{
                minHeight: 64,
                borderRadius: 10,
                borderWidth: isToday ? 2 : 1,
                borderColor: isToday ? "var(--accent)" : "var(--border)",
                background: isSelected ? "var(--surface-2)" : "var(--surface)",
              }}
              title={`${c.dateKey}${dayList.length ? ` · ${dayList.length} 项` : ""}`}
            >
              <span className="text-sm" style={isToday ? { color: "var(--accent)", fontWeight: 600 } : undefined}>{c.dayNum}</span>
              {isToday && (
                <span className="absolute top-1 right-1 text-[10px] leading-4 px-1 rounded-full text-white" style={{ background: "var(--accent)" }}>今</span>
              )}
              {dayList.length > 0 && (
                <span
                  className="absolute bottom-1 right-1 text-[10px] leading-4 min-w-4 text-center px-1 rounded-full"
                  style={hasActive ? { background: "var(--accent)", color: "#fff" } : { background: "var(--surface-2)", color: "var(--muted)" }}
                >
                  {dayList.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 选中日的任务面板:无任务仅显示快速新增 */}
      <div className="surface p-4 mt-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">{sy}年{sm}月{sd}日</h3>
          <span className="text-xs" style={{ color: "var(--muted)" }}>{dayTasks.length} 项</span>
        </div>
        {note && <div className="text-sm mb-2" style={{ color: "var(--danger)" }}>{note}</div>}
        {dayTasks.length === 0 && (
          <div className="text-sm mb-2" style={{ color: "var(--muted)" }}>这一天还没有任务,用下方快速新增安排一件小事。</div>
        )}
        {dayTasks.map((t) => (
          <Link key={t.id} href={taskHref(t)} className="flex items-center gap-2 py-1.5 hover:opacity-90">
            <span className="text-xs px-1.5 py-0.5 rounded shrink-0" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>
              {STATUS_LABEL[t.status] ?? t.status}
            </span>
            <span className={`text-sm ${isActive(t) ? "" : "opacity-70"}`}>{t.title}</span>
          </Link>
        ))}
        {/* 快速新增:Enter 提交,IME 组合中(isComposing)不提交 */}
        <div className="flex gap-2 mt-3">
          <input
            className="input flex-1 px-3 py-1.5 text-sm"
            placeholder={`新增截止 ${selectedKey} 的任务…`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }}
            disabled={busy}
          />
          <button onClick={add} className="accent-btn px-4 py-1.5 text-sm" disabled={busy}>{busy ? "添加中…" : "添加"}</button>
        </div>
      </div>
    </div>
  );
}
