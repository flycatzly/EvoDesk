"use client";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { StatsPayload } from "@/lib/domain/stats";

const axisTick = { fontSize: 11, fill: "var(--muted)" } as const;
const gridStroke = "var(--border)";
// recharts Tooltip 走内联样式,用主题变量保持亮/暗色一致
const tooltipStyle = {
  contentStyle: { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12 },
  labelStyle: { color: "var(--muted)" },
  itemStyle: { color: "var(--text)" },
} as const;
const mmdd = (d: string) => d.slice(5); // "2026-09-12" → "09-12"

function ChartCard({ title, empty, emptyHint, children }: {
  title: string; empty: boolean; emptyHint: string; children: React.ReactNode;
}) {
  return (
    <section className="surface p-4 mb-4">
      <h3 className="font-semibold text-sm mb-3">{title}</h3>
      {empty ? (
        <div className="text-sm flex items-center justify-center" style={{ color: "var(--muted)", height: 260 }}>{emptyHint}</div>
      ) : (
        children
      )}
    </section>
  );
}

export function StatsView({ data }: { data: StatsPayload }) {
  const totalDone = data.completions.reduce((a, d) => a + d.count, 0);
  const totalCost = data.costs.reduce((a, d) => a + d.cost, 0);
  const tplData = data.templates.map((t) => ({ name: t.name, pct: Math.round(t.successRate * 1000) / 10 }));
  const week = data.week;

  return (
    <div>
      {/* 本周复盘(本地时区,周一始):完成率 + 每日完成柱状 + 本周新增 */}
      <section className="surface p-4 mb-4">
        <h3 className="font-semibold text-sm mb-3">本周复盘</h3>
        <div className="grid md:grid-cols-3 gap-4 items-center">
          <div>
            <div className="text-xs" style={{ color: "var(--muted)" }}>本周完成率</div>
            <div className="text-3xl font-bold mt-1">
              {week.completionRate === null ? "—" : `${Math.round(week.completionRate * 100)}%`}
            </div>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>完成 /(完成 + 本周截止未完成)</div>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>每日完成(本地日)</div>
            {week.dailyDone.every((d) => d.count === 0) ? (
              <div className="text-sm py-6 text-center" style={{ color: "var(--muted)" }}>本周还没有完成记录</div>
            ) : (
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={week.dailyDone.map((d) => ({ date: mmdd(d.date), count: d.count }))} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
                  <XAxis dataKey="date" tick={axisTick} axisLine={{ stroke: gridStroke }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={axisTick} axisLine={{ stroke: gridStroke }} tickLine={false} />
                  <Tooltip {...tooltipStyle} />
                  <Bar dataKey="count" name="完成数" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
        <div className="text-xs mt-3" style={{ color: "var(--muted)" }}>
          本周新增:任务 {week.newTasks} 条 · 灵感笔记 {week.newNotes} 条
        </div>
      </section>

      {/* 顶部三数字卡 */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="surface p-4">
          <div className="text-xs" style={{ color: "var(--muted)" }}>近 14 天完成</div>
          <div className="text-2xl font-bold mt-1">{totalDone}</div>
        </div>
        <div className="surface p-4">
          <div className="text-xs" style={{ color: "var(--muted)" }}>近 14 天成本</div>
          <div className="text-2xl font-bold mt-1">${totalCost.toFixed(4)}</div>
        </div>
        <div className="surface p-4">
          <div className="text-xs" style={{ color: "var(--muted)" }}>活跃模板</div>
          <div className="text-2xl font-bold mt-1">{data.templates.length}</div>
        </div>
      </div>
      <div className="text-xs mb-3" style={{ color: "var(--muted)" }}>统计口径:按 UTC 日聚合(与数据库存储时区一致)</div>

      {/* 完成趋势 */}
      <ChartCard
        title="完成趋势"
        empty={totalDone === 0}
        emptyHint="近 14 天还没有完成的任务——从看板推进一件任务,完成后这里会出现趋势线。"
      >
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data.completions} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey="date" tick={axisTick} tickFormatter={mmdd} tickLine={false} />
            <YAxis allowDecimals={false} tick={axisTick} tickLine={false} />
            <Tooltip {...tooltipStyle} formatter={(v) => [`${v} 项`, "完成"]} />
            <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 成本趋势 */}
      <ChartCard title="成本趋势" empty={false} emptyHint="">
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={data.costs} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey="date" tick={axisTick} tickFormatter={mmdd} tickLine={false} />
            <YAxis tick={axisTick} tickLine={false} />
            <Tooltip {...tooltipStyle} formatter={(v) => [`$${Number(v).toFixed(4)}`, "成本"]} />
            <Area type="monotone" dataKey="cost" stroke="var(--accent-2)" fill="var(--accent-2)" fillOpacity={0.15} strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      {/* 模板绩效:成功率 %(成功率为 0-1 小数,×100 后保留 1 位) */}
      <ChartCard
        title="模板绩效"
        empty={tplData.length === 0}
        emptyHint="还没有模板运行记录——去流程库挑一个模板跑起来,这里会对比各模板成功率。"
      >
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={tplData} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} vertical={false} />
            <XAxis dataKey="name" tick={axisTick} tickLine={false} />
            <YAxis domain={[0, 100]} unit="%" tick={axisTick} tickLine={false} />
            <Tooltip {...tooltipStyle} formatter={(v) => [`${v}%`, "成功率"]} cursor={{ fill: "var(--surface-2)" }} />
            <Bar dataKey="pct" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={48} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
