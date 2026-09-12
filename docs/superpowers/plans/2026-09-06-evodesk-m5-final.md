# EvoDesk M5(风险雷达 + 日历 + 统计 + 移动端适配 + 打磨)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 M5 收官——风险雷达、日历视图、统计页(recharts)、移动端适配(抽屉+底部导航)、时区感知的"今天"边界,以及累积审查打磨项(聊天历史窗口/RunView 双栏与产出回看/重复代码归并)。

**Architecture:** 风险雷达为仪表盘 RSC 内计算(阈值读 settings);日历为月网格 RSC+客户端翻页;统计走 /api/stats 聚合端点 + recharts 客户端图表;移动端把 Sidebar 重构为桌面侧栏 + 移动抽屉/底部导航;时区用 settings.timezone(IANA 名,空=系统本地)影响"今天"分桶与日历,不改变 DB 的 UTC-ISO 存储。

**Tech Stack:** 既有栈 + recharts(已装)。

**Spec:** `docs/superpowers/specs/2026-09-06-evodesk-personal-workbench-design.md` §11 视图 1/7/统计、§2 移动端抽屉;前置:M1-M4 已全部合入 main(280/280 绿)。

**环境注意:** `D:\home\EvoFlow`;分支 `feature/m5-final`(已建,recharts 已提交);基线 280 tests / 36 files。

**累积打磨项(本计划消化):** chats 历史窗口(每消息全量发送→token 线性增长)、ChatView JSON.parse 无守卫、toTask 无 .catch、parseLaunchPayload 双份、readVaultPath 与 getVaultRoot 双份、runLlmStep 无意图注释、previewQuickAction/LaunchSpec 死代码、RunView 堆叠布局(规格要求左时间线右操作区)、done 步骤产出不可回看。

---

### Task 1: 时区助手 + 设置字段

**Files:**
- Create: `src/lib/domain/tz.ts` + `src/lib/domain/tz.test.ts`
- Modify: `src/components/SettingsForm.tsx`(加时区字段)、`src/app/page.tsx`(today 改 tzToday)
- Modify: `src/lib/domain/recurring.ts` 不改(生成仍 UTC-midnight,文档注释说明)

**tz.ts:**
```ts
/** 按 IANA 时区名(空=系统本地)返回 yyyy-mm-dd 的"今天"。DB 存储恒为 UTC-ISO,此函数只影响展示/分桶边界。 */
export function tzToday(timeZone?: string | null): string {
  try {
    return new Date().toLocaleDateString("en-CA", timeZone ? { timeZone } : undefined);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
```
**测试**:tzToday("Asia/Shanghai") 返回合法 yyyy-mm-dd;tzToday("Not/AZone") 回退 UTC 不抛;tzToday(null) 不抛。跨 UTC 日的断言不做(时点敏感),仅验格式与鲁棒性。

**SettingsForm**:加 `timezone` 字段(默认空=系统本地,占位提示 `IANA 名,如 Asia/Shanghai,留空跟随系统`);保存到 settings.timezone。**page.tsx**:读 settings.timezone → `const todayStr = tzToday(tz)` 替换 `today()`(仪表盘 overdue/dueToday 分桶)。

- [ ] TDD → 实现 → `npm test` 280+ 全绿 → Commit `feat(domain): timezone-aware today boundary`

---

### Task 2: 风险雷达

**Files:**
- Create: `src/components/RadarCard.tsx`
- Modify: `src/app/page.tsx`(两栏下方加「风险雷达」区块)

**计算(RSC 内,数据齐备)**四类风险项(阈值读 settings:waiting_human_timeout_hours 默认 24、cost_budget_usd 默认 10):
1. **已延期任务**:dueDate < today 的 active 任务(列出 ≤5 条,链接执行视图/看板)
2. **待人工超时**:status waiting_human 且 updatedAt 距今 > 阈值小时(列出 ≤5,链接执行视图)
3. **成本预算**:本周(近 7 天)flow_runs totalCostUsd 合计 > cost_budget_usd → 显示 `本周已花费 $x / 预算 $y`
4. **低绩效模板**:flowTemplates statRuns ≥ 5 且 statSuccessRate < 0.5(列出名称+成功率,链接 /flows)

**RadarCard**:props `items: { kind: string; label: string; href?: string; detail?: string }[]`;无风险 → 绿色「一切正常」;有 → 每项一行(⚠ + 类别标签 + 描述 + 可选链接),按严重度排(延期>超时>预算>绩效)。page.tsx 组装 items。

- [ ] 实现 → gates → Commit `feat(ui): risk radar with overdue/timeout/budget/performance`

---

### Task 3: 日历视图 /calendar

**Files:**
- Create: `src/app/calendar/page.tsx`、`src/components/CalendarView.tsx`
- Modify: `src/components/Sidebar.tsx`(calendar ready:true)

**服务端页**:force-dynamic;searchParams {m?: "YYYY-MM"};读全量 active+done 任务(dueDate 非空);传给 CalendarView(含 todayStr = tzToday)。

**CalendarView(客户端)**:
- 月网格(7 列,周一起):由 `m` 或当月算 42 格(前后月补位灰显);今天(tzToday)高亮 accent 边框;`< 上月` / `下月 >` 按钮 router.push(`/calendar?m=YYYY-MM`)
- 每格:日期数字 + 该日 dueDate 任务计数徽章;点击选中格 → 下方列出该日任务(标题+状态,链接 /tasks/[id] 或 /inbox)+ 快速新增(input + POST /api/tasks {title, due_date: 选中日})
- 顶栏当月标题 `YYYY年M月`
- 一致性栏(fetch 守卫/IME—快速新增 input Enter 需 isComposing 守卫/busy/note)

- [ ] 实现 → gates → Commit `feat(ui): calendar month view with per-day tasks and quick add`

---

### Task 4: 统计页 /stats

**Files:**
- Create: `src/app/api/stats/route.ts`、`src/app/stats/page.tsx`、`src/components/StatsView.tsx`
- Modify: `src/components/Sidebar.tsx`(stats 项加入,ready:true——新导航项,置于核心组末尾)

**/api/stats**(聚合,一次返回):
```ts
{
  completions: [{ date: "YYYY-MM-DD", count }],   // 近 14 天,按 tasks.updatedAt(done 状态)UTC 日聚合
  costs: [{ date, cost }],                         // 近 14 天 flow_runs totalCostUsd 聚合
  templates: [{ name, runs, successRate, avgCost, avgSatisfaction }], // statRuns>0 的模板
}
```
**StatsView(客户端,recharts)**:三图——完成趋势 LineChart、成本趋势 BarChart(或 AreaChart)、模板绩效 BarChart(成功率%)。recharts 组件须 "use client" + 响应式容器(R ResponsiveContainer width="100%" height={260})。数值格式化(成本 4 位小数)。空态:无数据时显示引导文案。

- [ ] 实现 → gates(`npm test` 280+ 全绿、build 含 /stats)→ Commit `feat(ui): stats page with completion/cost trends and template comparison`

---

### Task 5: 移动端适配

**Files:**
- Modify: `src/components/Sidebar.tsx`、`src/app/layout.tsx`
- Create: `src/components/MobileNav.tsx`

**方案**(保持桌面不动,补移动端):
- **抽屉**:md 以下默认隐藏侧栏;TopBar 左侧加汉堡按钮(仅 md:hidden)→ 打开抽屉(固定定位覆盖层 + Sidebar 内容复用:把 Sidebar 导航组提取为 `NavLinks` 内部组件,桌面 aside 与移动抽屉共用);遮罩点击关闭;打开时路由变化自动关闭(usePathname effect)。
- **底部导航**:移动端固定底部条(md:hidden),放 4 个最高频入口:仪表盘/收件箱/看板/对话台(图标+文字,当前页高亮),避开抽屉低频项。
- **主区边距**:移动端 main 底部留 pb-16(避让底部导航);TopBar QuickAdd 输入框在窄屏收窄(w-32)。
- 桌面(≥md)完全不变。

- [ ] 实现 → gates → Commit `feat(ui): mobile drawer nav and bottom navigation`

---

### Task 6: RunView 规格对齐打磨

**Files:**
- Modify: `src/components/RunView.tsx`

1. **双栏布局(规格 §11 左时间线右操作区)**:外层改 `grid md:grid-cols-[240px_1fr] gap-4`(时间线左列,操作面板右列;窄屏保持上下堆叠)。
2. **done 步骤产出回看**:时间线 done 步骤行加「查看产出」切换(details/summary 或 useState set),展开显示 output pre(≤2000 字符截断)与 tokens/cost/duration 明细。
3. (可选小项)409 响应带 code:advance/stream 的 409 "该步骤正在执行" 加 `code: "step_running"` 字段,RunView 判断改 `data.code === "step_running"` 保留 includes 兜底。

- [ ] 实现 → gates → Commit `feat(ui): run view two-column layout and done-step output review`

---

### Task 7: 累积打磨批

**Files/改动(全部小项,逐条)**:
1. **chats 历史窗口**:`src/app/api/chats/[id]/messages/route.ts` 构建 llmMessages 前截断 `history.slice(-40)`(注释:窗口防 token 线性增长;system 始终保留)。测试:插入 45 条历史 → 发消息 → 断言上游收到的 messages 长度 = 41(system + 40)。
2. **ChatView 加固**:reader 循环 JSON.parse 加 try/catch continue;toTask 加 .catch(() => note/fallback)。
3. **去重**:quick-actions preview/confirm 的 `parseLaunchPayload` 提取到 `src/lib/domain/launch.ts` 导出(两路由改导入);to-vault 路由私有 readVaultPath 改用 vault.ts `getVaultRoot`。
4. **死代码清理**:quick-actions.ts 删 `previewQuickAction` 与 `LaunchSpec`(仅测试引用,一并删);runner.ts `runLlmStep` 上加注释 `// 测试与潜在非流式路径复用;生产 llm 步骤走 stream 路由`(不删,测试依赖)。
5. **FlowsView reorder 标注**:diff 全 `=` 但 ops 含 reorder 时,变体卡 rationale 旁加 `↕ 顺序调整` 小徽章(数据源:variant detail.changes——需 page.tsx 把 events detail 传入或简化为卡片 description 已含 rationale,若数据不可达则改为 diffSteps 返回 {rows, reordered} 由调用方标注;实现者按可达性选最小方案)。

- [ ] 每项改后跑全量测试 → Commit `chore: accumulated polish (chat window, guards, dedup, dead code)`

---

### Task 8: README 终版 + 全量回归

- [ ] README:能力清单加风险雷达/日历/统计/移动端;后续里程碑行改为「设计范围内功能已全部交付;后续按使用反馈迭代」。检查能力声明与实现一致。
- [ ] `npm test` 全绿、`npm run build`、`npm run lint` 0/0;E2E smoke(temp DB):/calendar /stats 200、移动端 HTML 含底部导航标记、/api/stats 返回三键。
- [ ] Commit `docs: README final for M1-M5`

---

## 后续(设计范围外,按使用反馈迭代)

⌘K 命令面板、资讯 RSS 自动抓取、外部日历 ICS、Obsidian 双链图谱、多 vault、任务→Obsidian 导出、流程模板编辑器。
