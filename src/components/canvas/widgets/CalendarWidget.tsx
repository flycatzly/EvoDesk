import type { WidgetData } from "@/lib/domain/canvas-data";

// 迷你月历:当月网格(周一开头),今天高亮,有任务日期带圆点;底部本月任务数
export function CalendarWidget({ data }: { data: WidgetData["calendar"] }) {
  const [y, m] = data.today.split("-").map(Number);
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // 周一=0
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthTaskTotal = Object.values(data.dayCounts).reduce((a, b) => a + b, 0);
  const todayDay = Number(data.today.slice(8, 10));
  return (
    <div>
      <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{data.monthLabel} · 本月 {monthTaskTotal} 项任务</div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
        {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
          <div key={d} style={{ color: "var(--muted)" }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const date = `${data.today.slice(0, 8)}${String(day).padStart(2, "0")}`;
          const isToday = day === todayDay;
          const count = data.dayCounts[date] ?? 0;
          return (
            <div key={date} className="relative py-0.5">
              <span
                className="inline-flex items-center justify-center w-6 h-6 rounded-full"
                style={isToday ? { background: "var(--accent)", color: "#fff" } : undefined}
              >
                {day}
              </span>
              {count > 0 && !isToday && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style={{ background: "var(--accent-2)" }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
