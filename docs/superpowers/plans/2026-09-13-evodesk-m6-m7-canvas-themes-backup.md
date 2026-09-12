# EvoDesk M6+M7(拖拽画布工作台 + 7 套主题 + 导入导出备份)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页改造为可拖拽、可锁定、可分享的组件画布工作台(9 类组件、2/3 栏、分组容器、模板套用),新增常用链接与目标进度模块、新手帮助页、本周复盘指标;主题升级为 7 套预设色板;数据层支持一键导出/导入与 SQLite 快照备份。

**Architecture:** 画布布局以单 JSON 文档存 `canvases` 表(布局与数据解耦,组件数据来自既有表);dnd-kit 承担编辑态拖拽(锁定态纯浏览);RSC 收集组件数据一次性传入客户端 CanvasBoard;主题 = CSS 变量预设表 + localStorage;备份 = JSON 全量导出(剥离密钥)+ better-sqlite3 backup API 快照,导入前强制快照。

**Tech Stack:** 既有栈(Next 16 App Router / better-sqlite3 / Drizzle / Tailwind 4 / zod 4 / vitest);新增 `@dnd-kit/core`、`@dnd-kit/sortable`、`@dnd-kit/utilities`。

**Spec:** `docs/superpowers/specs/2026-09-13-workbench-increment-m6-m9-design.md` §3、§4、§9。

**环境注意:** Windows + Git Bash;`D:\home\EvoFlow`;Next 16.3.4 动态路由参数为 `Promise`(`const { id } = await params`);路由 handler 均带 `export const dynamic = "force-dynamic"`;测试 colocated `*.test.ts`,跑法 `npx vitest run <file>`。

---

## 文件结构

```
src/lib/db/schema.ts            [+3 表:links/goals/canvases]
src/lib/db/seed.ts              [+默认画布+3 套模板画布+示例链接/目标(收敛式补齐)]
src/lib/domain/
  canvas.ts                     [layoutSchema(zod)/parseLayout/normalizeWidgetId/deepCopyLayout/WIDGET_TYPES]
  canvas-data.ts                [collectWidgetData(db):counters/todo/calendar/notes/links/goals/vault/radar/quickactions 数据源]
  week.ts                       [weekStartIso/weekDates(timezone 感知,周一为一周始)]
  backup.ts                     [EXPORT_TABLES/exportData(剥密钥)/parseBackup/importData(事务全量替换)/snapshot/restore/listSnapshots/cleanSnapshots]
  theme.ts                      [THEMES 7 套预设(变量表)/resolveTheme/applyThemeScript 源码串]
src/app/api/
  links/route.ts                GET/POST;links/[id]/route.ts PATCH/DELETE
  goals/route.ts                GET/POST;goals/[id]/route.ts PATCH/DELETE
  canvases/route.ts             GET/POST(含 from_template)
  canvases/[id]/route.ts        GET/PUT(layout|name|columns|locked)/DELETE
  canvases/[id]/share/route.ts  POST 生成/吊销 token
  canvases/by-token/[token]/route.ts GET 分享只读
  backup/export/route.ts        GET JSON 下载(?include_secrets=1 显式带密钥)
  backup/import/route.ts        POST multipart 文件 → 校验 → 自动快照 → 事务导入
  backup/snapshot/route.ts      POST 创建快照;GET 列表
  backup/restore/route.ts       POST {name} 恢复(先自动快照)
src/components/
  canvas/CanvasBoard.tsx        [client:画布渲染+编辑态 dnd-kit 拖拽/增删/锁定/栏数/画布切换/分享菜单]
  canvas/GroupShell.tsx         [分组容器(标题、编辑控件、widget 插槽)]
  canvas/widgets/*.tsx          [CountersWidget/TodoWidget/CalendarWidget/NotesWidget/LinksWidget/GoalsWidget/VaultWidget/RadarWidget/QuickActionsWidget + WidgetEmpty]
  ThemePicker.tsx               [7 色板下拉(双色预览圆点)]
  BackupForm.tsx                [设置页:导出/导入/快照列表/恢复]
  WeekReview.tsx                [本周复盘卡(完成率/每日完成柱状/新增统计)]
  LinksView.tsx GoalsView.tsx   [链接/目标管理页]
src/app/
  page.tsx                      [改:画布工作台(RSC 收集数据→CanvasBoard);旧仪表盘逻辑并入 widgets]
  links/page.tsx goals/page.tsx help/page.tsx
  share/[token]/page.tsx        [只读分享画布]
  stats/page.tsx                [改:顶部加 WeekReview]
  settings/page.tsx             [改:主题区+备份区]
  layout.tsx                    [改:启动脚本按 7 主题注入 CSS 变量]
  globals.css                   [改::root 变量改由 theme.ts 注入,保留组件 utility]
src/components/Sidebar.tsx      [改:导航组调整(链接/目标/新手帮助/标签改名)]
README.md                       [M6+M7 能力]
```

沿用约定:UTC-ISO 存储、对象体守卫、`ReqInit`、try/catch + res.ok 检查、zod 校验、迁移用 `npm run db:generate`(产出 0003)。

---

### Task 1: 依赖安装 + Schema v4(3 表)+ 迁移

**Files:** Modify `package.json`、`src/lib/db/schema.ts`;Generate `drizzle/0003_*.sql`

- [ ] **Step 1: 安装 dnd-kit**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: schema.ts 末尾追加(列序/命名与既有表一致)**

```ts
export const links = sqliteTable("links", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  category: text("category").notNull().default("常用"),
  sort: integer("sort").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category").notNull().default("custom"), // reading|fitness|project|custom
  target: integer("target").notNull(),
  current: integer("current").notNull().default(0),
  unit: text("unit").notNull().default(""),
  deadline: text("deadline"),
  color: text("color"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const canvases = sqliteTable("canvases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  columns: text("columns").notNull().default("2"), // "2"|"3"
  locked: integer("locked", { mode: "boolean" }).notNull().default(false),
  layout: text("layout").notNull().default("[]"),
  isTemplate: integer("is_template", { mode: "boolean" }).notNull().default(false),
  shareToken: text("share_token"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
```

- [ ] **Step 3: 生成迁移并验证**

```bash
npm run db:generate   # 预期产出 drizzle/0003_*.sql,含 3 张 CREATE TABLE
npx vitest run src/lib/db   # 既有 client/seed 测试仍绿(迁移链自动执行)
```

- [ ] **Step 4: Commit** `feat(schema): links/goals/canvases tables + migration 0003`

### Task 2: 画布布局领域层(canvas.ts)

**Files:** Create `src/lib/domain/canvas.ts`;Test `src/lib/domain/canvas.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, expect, it } from "vitest";
import { WIDGET_TYPES, layoutSchema, parseLayout, newWidgetId } from "./canvas";

describe("layoutSchema", () => {
  it("接受合法布局", () => {
    const layout = [{ groupTitle: "今日焦点", widgets: [{ id: "w1", type: "todo", config: { scope: "today" } }] }];
    expect(layoutSchema.safeParse(layout).success).toBe(true);
  });
  it("拒绝未知 widget type 与空分组标题", () => {
    expect(layoutSchema.safeParse([{ groupTitle: "g", widgets: [{ id: "w1", type: "nope", config: {} }] }]).success).toBe(false);
    expect(layoutSchema.safeParse([{ groupTitle: "", widgets: [] }]).success).toBe(false);
  });
  it("config 缺省补 {}", () => {
    const parsed = layoutSchema.parse([{ groupTitle: "g", widgets: [{ id: "w1", type: "goals" }] }]);
    expect(parsed[0].widgets[0].config).toEqual({});
  });
});
describe("parseLayout", () => {
  it("坏 JSON / 非法结构返回 []", () => {
    expect(parseLayout("not json")).toEqual([]);
    expect(parseLayout("42")).toEqual([]);
  });
  it("合法 JSON 返回分组数组", () => {
    expect(parseLayout('[{"groupTitle":"g","widgets":[]}]')).toHaveLength(1);
  });
});
it("WIDGET_TYPES 含 9 类;newWidgetId 唯一", () => {
  expect(WIDGET_TYPES).toHaveLength(9);
  expect(newWidgetId()).not.toBe(newWidgetId());
});
```

- [ ] **Step 2: 跑测试确认失败** `npx vitest run src/lib/domain/canvas.test.ts` → FAIL(模块不存在)

- [ ] **Step 3: 实现**

```ts
import { z } from "zod";
import { randomBytes } from "node:crypto";

export const WIDGET_TYPES = ["counters", "todo", "calendar", "notes", "links", "goals", "vault", "radar", "quickactions"] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const widgetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(WIDGET_TYPES),
  config: z.record(z.string(), z.unknown()).default({}),
});
export const groupSchema = z.object({
  groupTitle: z.string().trim().min(1).max(50),
  widgets: z.array(widgetSchema).max(12),
});
export const layoutSchema = z.array(groupSchema).max(20);
export type CanvasWidget = z.infer<typeof widgetSchema>;
export type CanvasGroup = z.infer<typeof groupSchema>;
export type CanvasLayout = CanvasGroup[];

export function parseLayout(raw: string): CanvasLayout {
  try {
    const parsed = layoutSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}
export function newWidgetId(): string {
  return `w_${randomBytes(4).toString("hex")}`;
}
export function deepCopyLayout(layout: CanvasLayout): CanvasLayout {
  return JSON.parse(JSON.stringify(layout)).map((g: CanvasGroup) => ({ ...g, widgets: g.widgets.map((w) => ({ ...w, id: newWidgetId() })) }));
}
```

- [ ] **Step 4: 测试通过;Commit** `feat(domain): canvas layout zod schema and helpers`

### Task 3: 周口径领域层(week.ts)+ stats 扩展

**Files:** Create `src/lib/domain/week.ts` + test;Modify `src/lib/domain/stats.ts`(StatsPayload 增加 `week` 段)+ test

- [ ] **Step 1: week.ts 失败测试**

```ts
import { describe, expect, it } from "vitest";
import { weekStart, weekDates, inWeek } from "./week";

describe("week", () => {
  // 2026-09-13 是周日;周一为 2026-09-07
  it("weekStart 返回本周周一 00:00(ISO)", () => {
    expect(weekStart("2026-09-13T10:00:00Z", "Asia/Shanghai").startsWith("2026-09-07")).toBe(true);
  });
  it("weekDates 返回 7 个 yyyy-mm-dd(本地日)", () => {
    expect(weekDates("2026-09-13T10:00:00Z", "Asia/Shanghai")[0]).toBe("2026-09-07");
    expect(weekDates("2026-09-13T10:00:00Z", "Asia/Shanghai")).toHaveLength(7);
  });
  it("inWeek 判断 ISO 时间是否落在本周", () => {
    expect(inWeek("2026-09-08T02:00:00Z", "2026-09-13T10:00:00Z", "Asia/Shanghai")).toBe(true);
    expect(inWeek("2026-09-01T02:00:00Z", "2026-09-13T10:00:00Z", "Asia/Shanghai")).toBe(false);
  });
});
```

- [ ] **Step 2: 实现(用 `Intl.DateTimeFormat` timeZone 换算本地日,复用 tz.ts 思路;不引依赖)**

```ts
export function localDateIso(iso: string, timezone: string | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone || undefined, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}
export function weekStart(nowIso: string, timezone?: string): string {
  const d = new Date(`${localDateIso(nowIso, timezone)}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 周一=0
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString();
}
export function weekDates(nowIso: string, timezone?: string): string[] {
  const start = new Date(weekStart(nowIso, timezone));
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); });
}
export function inWeek(iso: string, nowIso: string, timezone?: string): boolean {
  const start = new Date(weekStart(nowIso, timezone));
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t < end.getTime();
}
```

- [ ] **Step 3: stats.ts 增加 week 段(读全表后在 JS 分桶,与既有风格一致)**

```ts
// StatsPayload 增加:
week: {
  completionRate: number | null; // 本周完成 / (本周完成 + 本周截止未完成);分母 0 → null
  dailyDone: { date: string; count: number }[]; // 7 天
  newTasks: number;
  newNotes: number;
}
```

实现要点:`done` 任务按 `updatedAt ∈ 本周` 计完成;未完成 = `dueDate ∈ 本周日期集` 且 status ∉ {done,canceled,archived};newTasks 按 createdAt、newNotes 按 notes.createdAt。同 fmt 补 stats.test.ts 三断言(完成率、dailyDone 7 天、newNotes 计数)。API /api/stats 无需改(透传 payload)。

- [ ] **Step 4: 测试通过;Commit** `feat(domain): week boundary helpers and stats.week review segment`

### Task 4: links / goals API

**Files:** Create `src/app/api/links/route.ts`、`src/app/api/links/[id]/route.ts`、`src/app/api/goals/route.ts`、`src/app/api/goals/[id]/route.ts` + 4 个 colocated test

- [ ] **Step 1: 失败测试(links 为例,goals 同构)**

```ts
// src/app/api/links/route.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { GET, POST } from "./route";
import { PATCH, DELETE } from "../[id]/route";

const db = createTestDb();
beforeEach(() => { __setDbForTests(db); });
const req = (body: unknown, method = "POST"): ReqInit => ({ method, body: JSON.stringify(body), headers: { "content-type": "application/json" } } as ReqInit);

describe("links api", () => {
  it("POST 创建 → GET 列表", async () => {
    const res = await POST(req({ title: "GitHub", url: "https://github.com", category: "开发" }));
    expect(res.status).toBe(200);
    expect((await GET()).status).toBe(200);
    const list = (await (await GET()).json()) as { links: { title: string }[] };
    expect(list.links[0].title).toBe("GitHub");
  });
  it("POST 拒绝非 http(s) url", async () => {
    const res = await POST(req({ title: "x", url: "javascript:alert(1)" }));
    expect(res.status).toBe(400);
  });
  it("PATCH 改分类/排序;DELETE 删除", async () => {
    await POST(req({ title: "A", url: "https://a.com" }));
    const id = ((await (await GET()).json()) as { links: { id: string }[] }).links[0].id;
    expect((await PATCH(req({ category: "学习", sort: 2 }, "PATCH"), id)).status).toBe(200);
    expect((await DELETE(req({}, "DELETE"), id)).status).toBe(200);
    expect((((await (await GET()).json()) as { links: unknown[] }).links)).toHaveLength(0);
  });
});
```

(`ReqInit` 类型沿用既有 route.test.ts 的导入方式;goals 测试覆盖:POST target≤0 拒绝、PATCH current 步进与归档、archived=true 后默认列表过滤。)

- [ ] **Step 2: 实现四个 route(体例抄 `src/app/api/notes/route.ts`:zod body 校验、uuid id、createdAt ISO、GET 全量按 sort/category 排;goals GET 支持 `?archived=1`;url 校验 `z.url().startsWith("http")` — 用 `z.string().refine(u => /^https?:\/\//.test(u))`)**

- [ ] **Step 3: 测试通过;Commit** `feat(api): links and goals CRUD`

### Task 5: canvases API + 分享

**Files:** Create `src/app/api/canvases/route.ts`、`canvases/[id]/route.ts`、`canvases/[id]/share/route.ts`、`canvases/by-token/[token]/route.ts` + tests

- [ ] **Step 1: 失败测试(核心用例)**

```ts
// src/app/api/canvases/route.test.ts(体例同 Task 4)
it("POST 新建画布(layout zod 校验非法返回 400)");
it("POST from_template=模板id → 深拷贝模板 layout 为新画布(is_template=0)");
it("GET 列表区分画布与模板(is_template 过滤参数)");
it("PUT 整存 layout/locked/columns/name;非法 layout 400");
it("DELETE 删除画布;模板删除同样允许");
it("POST share 生成 16hex token;再次 POST ?revoke=1 置空");
it("by-token 命中返回 {name,columns,layout};未命中 404;模板不参与 token 查找");
```

- [ ] **Step 2: 实现** — POST body `{name?, from_template?, layout?}`;PUT 接收 `{layout?, name?, columns?, locked?}`,layout 走 `layoutSchema.safeParse`;share token `randomBytes(8).toString("hex")`;by-token route 查 `shareToken = token AND isTemplate = 0`,返回仅 `{id,name,columns,layout}`。

- [ ] **Step 3: 测试通过;Commit** `feat(api): canvases CRUD, template copy, share token`

### Task 6: 种子(默认画布 + 3 模板 + 示例链接/目标)

**Files:** Modify `src/lib/db/seed.ts`;Test `src/lib/db/seed.test.ts`(追加用例)

- [ ] **Step 1: 失败测试**

```ts
it("seed 后存在默认画布(含 9 类组件中至少 7 类)且 3 套 is_template=1 模板(学生/职场开发者/生活)");
it("部分初始化库(已有 canvases 表但无默认画布)收敛补齐,不重复插入");
it("seed 后 links ≥3(含 category=开发)、goals ≥2(reading+fitness)");
```

- [ ] **Step 2: 实现** — 沿用"per-table convergent seeding"模式:按 name 查缺补。默认画布 layout(3 分组):
  - "今日焦点":counters、todo(scope=today)、calendar
  - "灵感与笔记":notes、vault
  - "链接与目标":links、goals、radar、quickactions
  - 模板画布(仅 layout 不同):学生(今日待办/课程笔记 notes/网课链接 links/学习进度 goals)、职场开发者(工作待办 todo/日程 calendar/项目笔记 notes/开发工具链接 links/备忘 quickactions)、生活(每日计划 todo/阅读影视清单 goals/灵感笔记 notes/常用网站 links)。
  - 示例链接:Z.ai 控制台/GitHub/掘金(开发);示例目标:读 12 本书(3/12,reading)、健身 48 次(18/48,fitness)。

- [ ] **Step 3: 测试通过;Commit** `feat(seed): default canvas, 3 template canvases, sample links/goals`

### Task 7: 组件数据源(canvas-data.ts)

**Files:** Create `src/lib/domain/canvas-data.ts` + test

- [ ] **Step 1: 接口契约(实现于 RSC 侧调用,返回可序列化 props)**

```ts
export type WidgetData = {
  counters: { today: number; overdue: number; notes: number; projects: { name: string; total: number; done: number; color: string }[] };
  todo: { tasks: TaskLite[] };            // TaskLite={id,title,priority,dueDate,status,overdue};scope=today → 逾期+今日,逾期置顶
  calendar: { today: string; dates: { date: string; count: number }[]; monthLabel: string }; // 当月
  notes: { notes: { id: string; title: string; updatedAt: string }[] }; // 最近 5
  links: { groups: { category: string; links: { id: string; title: string; url: string }[] }[] };
  goals: { goals: { id: string; title: string; current: number; target: number; unit: string; color: string | null; deadline: string | null }[] };
  vault: { rootName: string; noteCount: number; dirCount: number };   // vault 概览(容错:vault 路径无效 → counts 0)
  radar: { items: RadarItem[] };          // 复用现 page.tsx 雷达逻辑,抽取为 buildRadarItems(db, settings, now)
  quickactions: { actions: { id: string; name: string; type: string; icon: string | null }[] };
};
export async function collectWidgetData(db: Db, types: WidgetType[], timezone?: string): Promise<{ [K in WidgetType]?: ... }>
```

- [ ] **Step 2: 测试(空库/有数据两态)** — 空库各段为空数组不抛错;插入任务/笔记/链接/目标后计数正确;`buildRadarItems` 从现 page.tsx 原样搬移( overdue/waiting_human 超时/预算/低绩效模板 4 类),page.tsx 改为调用它。

- [ ] **Step 3: 测试通过;Commit** `feat(domain): widget data collector and radar extraction`

### Task 8: 9 个 Widget 组件

**Files:** Create `src/components/canvas/widgets/*.tsx`(9 个)+ `WidgetEmpty.tsx`

- [ ] **Step 1: 实现约定(全 server 可渲染;Todo/Notes/QuickActions 内嵌小 client 子件)**

- `CountersWidget`:4 格计数(今日待办/逾期/灵感数量/项目进度 n/m),逾期>0 用 `var(--warn)`。
- `TodoWidget`(client `TodoChecklist`):复选框勾选 → `PATCH /api/tasks/[id] {status:"done"}`(再点恢复 ready)→ `router.refresh()`;优先级 2/3 左侧红/橙竖条;逾期标签。
- `CalendarWidget`:当月迷你月历(7 列格),有任务日期圆点标记,今天高亮,底部"周计划":本周每日完成数一行。
- `NotesWidget`(client `NoteQuickAdd`):顶部一行灵感速记输入(标题即内容,POST /api/notes)+ 最近 5 条(链到 /notes)。
- `LinksWidget`:按 category 分组渲染按钮,a 标签 `target="_blank" rel="noreferrer"`。
- `GoalsWidget`:每行 标题 + 进度条(百分比 = current/target 上限 100,超额显示 ✓)+ `current/target unit`。
- `VaultWidget`:vault 根目录名 + 笔记/目录计数 + "打开知识库"链接(/vault)。
- `RadarWidget`:复用 `RadarCard`(改为接受 items prop,已满足)。
- `QuickActionsWidget`:复用 `QuickActionsCard`。
- 所有组件空数据 → `<WidgetEmpty label="…指引文案" />`(如 goals 空 → "还没有目标,去 /goals 创建")。

- [ ] **Step 2: Commit** `feat(ui): nine canvas widgets`

### Task 9: CanvasBoard(拖拽 + 锁定 + 多画布 + 分享)

**Files:** Create `src/components/canvas/CanvasBoard.tsx`、`canvas/GroupShell.tsx`;Modify `src/app/page.tsx`、`src/components/Sidebar.tsx`

- [ ] **Step 1: page.tsx 重写(RSC)**

```tsx
// 查询参数 ?c=<canvasId>;默认取第一个非模板画布
// 并行:collectWidgetData(db, 画布用到的全部类型, timezone) + 画布列表 meta
// 渲染 <CanvasBoard canvas={meta} layout={parsed} data={widgetData} canvases={[...]} readOnly={false} />
```

- [ ] **Step 2: CanvasBoard 交互规格(全 client)**

- props:`{ canvas: {id,name,columns,locked}, layout: CanvasLayout, data: Record<WidgetType, unknown>, canvases: {id,name}[], readOnly?: boolean }`
- 状态:`groups`(layout 深拷贝)、`editing = !locked && !readOnly`;锁定/解锁按钮 → `PUT /api/canvases/[id] {locked}` → `router.refresh()`。
- 编辑态:`<DndContext sensors={[PointerSensor(activationConstraint distance 5), KeyboardSensor]} collisionDetection={closestCenter} onDragEnd>`:
  - widget 排序/跨组移动:每组一个 `SortableContext(items=widgetIds, strategy=verticalListSortingStrategy)`;`onDragOver` 跨组搬运(数组 splice),`onDragEnd` 落定 → `persist(newGroups)`。
  - 分组排序:外层 `SortableContext(items=groupKeys, strategy=rectSortingStrategy)`,handle = 分组标题栏(仅编辑态显示 grip 图标)。
  - `persist`:乐观 setState → `PUT /api/canvases/[id] {layout}` → 失败回滚 + 提示。
- 编辑态控件:分组标题点击可改(inline input)、删分组(空组才可删)、组底"+ 组件"菜单(9 类)、删组件;顶栏:2/3 栏切换(PUT columns)、画布下拉切换(`router.push('/?c='+id)`)、"新建画布"、"从模板新建"(列 is_template 画布 → POST from_template)、"分享链接"(POST share → 弹层显示 `/share/<token>` + 复制 + 吊销)。
- 布局:容器 `style={{ gridTemplateColumns: editing||desktop ? \`repeat(${columns}, minmax(0,1fr))\` : undefined }}`,移动端(<768px,`matchMedia`)单列;拖拽仅编辑态挂载 DndContext。
- 只读(share 页):隐藏全部编辑控件,其余渲染一致。

- [ ] **Step 3: 手动验证** `npm run dev` → 首页渲染默认画布;拖动组件跨组、锁定后不可拖、2/3 栏生效、刷新保持。

- [ ] **Step 4: Commit** `feat(ui): draggable canvas workbench homepage with lock/share/templates`

### Task 10: 分享只读页 + links/goals 管理页 + 帮助页 + 本周复盘卡

**Files:** Create `src/app/share/[token]/page.tsx`、`src/app/links/page.tsx` + `LinksView.tsx`、`src/app/goals/page.tsx` + `GoalsView.tsx`、`src/app/help/page.tsx`、`src/components/WeekReview.tsx`;Modify `src/app/stats/page.tsx`、`Sidebar.tsx`

- [ ] **Step 1: share 页** — `const { token } = await params;` 查 by-token(直接 db 查 canvases where shareToken),404 兜底;复用 CanvasBoard `readOnly`,独立布局(无 Sidebar,顶部脚注"由 EvoDesk 分享")。
- [ ] **Step 2: LinksView**(client):分类折叠组 + 行内编辑(标题/URL/分类/排序)、顶部分类筛选、新增表单;删除带 confirm。GoalsView 同构:进度条 + current +/- 步进与直接输入、归档开关、类别筛选(全部/reading/fitness/project/custom 中文标签)。
- [ ] **Step 3: help 页(静态 RSC,中文)** — 五步上手(录任务→分诊→执行→看板复盘→装点画布)、模块一览表、三套人群模板说明、最佳实践与避坑(需求文档 §6 全部条目)、数据安全指引(导出/导入/快照,链到 /settings)、FAQ 3 条。内容从需求文档整理,不引用外部链接。
- [ ] **Step 4: WeekReview(client,recharts BarChart)** — props 来自 /api/stats 新 week 段:完成率大数字(分母 0 显示 "—")、每日完成柱状(7 天)、本周新增 任务 n · 笔记 m;stats 页置于首卡。
- [ ] **Step 5: Sidebar 调整** — 核心:+(/links 链接、/goals 目标);资产:notes 标签 → "内容灵感";系统:+(/help 新手帮助);stats 标签 → "本周复盘"。
- [ ] **Step 6: Commit** `feat(ui): share page, links/goals pages, help page, week review`

### Task 7'(M7 起点): 7 套主题(theme.ts + ThemePicker + layout 集成)

**Files:** Create `src/lib/domain/theme.ts`、`src/components/ThemePicker.tsx`;Modify `src/app/layout.tsx`、`src/app/globals.css`、`src/components/ThemeToggle.tsx`(改用 ThemePicker)、`settings/page.tsx`;Test `theme.test.ts`

- [ ] **Step 1: 失败测试**

```ts
it("THEMES 含 7 套且 id 唯一,均含 8 个变量键", () => {
  expect(THEMES).toHaveLength(7);
  for (const t of THEMES) { expect(Object.keys(t.vars).sort()).toEqual(["accent","accent-2","bg","border","muted","surface","surface-2","text"]); }
});
it("resolveTheme: 旧值 dark → dark-tech;未知 → dark-tech;空 → dark-tech", () => {
  expect(resolveTheme("dark").id).toBe("dark-tech");
  expect(resolveTheme("nope").id).toBe("dark-tech");
});
it("每个预设 8 变量均为合法 hex 颜色", () => {
  for (const t of THEMES) for (const v of Object.values(t.vars)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
});
```

- [ ] **Step 2: theme.ts** — `THEMES`(id/label/vars,7 套按规格 §4.1 配色,全部低饱和;dark-tech 沿用现 .dark 值);`resolveTheme(id)`;`THEME_BOOT_SCRIPT` = `(function(){try{var t=JSON.parse(document.documentElement.dataset.themePreload||"{}")[localStorage.getItem("evodesk-theme")||"dark-tech"]||fallback;for(var k in t.vars){document.documentElement.style.setProperty("--"+k,t.vars[k])}document.documentElement.classList.toggle("dark", t.id==="dark-tech")}catch(e){}})` — 由 layout.tsx 内联注入 `<script dangerouslySetInnerHTML>` 与 `<html data-theme-preload={JSON.stringify(map)}>`,首屏无闪变。
- [ ] **Step 3: ThemePicker(client)** — 下拉列出 7 套(名称 + accent/bg 双色圆点),选择 → localStorage `evodesk-theme` + 即时 `applyThemeVars(document, theme)` → 关闭;TopBar 旧 ThemeToggle 替换为 ThemePicker(图标调色板);设置页加"主题风格"区(7 卡片点选)。
- [ ] **Step 4: globals.css** — `:root` 与 `.dark` 的 6 色变量声明改为**兜底默认值**(dark-tech),注释说明运行时被 theme.ts 覆盖;`.surface/.accent-btn/...` 不动。
- [ ] **Step 5: 测试过 + 手动验证** 切换 7 套即时生效、刷新保持、无首屏闪变;Commit `feat(ui): seven theme presets with boot-time injection`

### Task 8'(M7): 备份领域层 + API + 设置页

**Files:** Create `src/lib/domain/backup.ts` + test、`src/app/api/backup/{export,import,snapshot,restore}/route.ts` + tests、`src/components/BackupForm.tsx`;Modify `settings/page.tsx`、`src/lib/db/client.ts`(导出 `getSqlite()` 裸 better-sqlite3 实例)

- [ ] **Step 1: 失败测试(backup.test.ts)**

```ts
it("exportData 默认剥离密钥:provider_profiles/executors 的 api_key_ref → 空串;include_secrets 保留");
it("exportData 覆盖 18 张表且行数与库一致");
it("parseBackup 拒绝:非 JSON/version≠1/缺 tables 键/表名未知 → 抛错(消息含原因)");
it("importData:目标库清空后行数等于备份;单事务(中途坏行整体回滚)");
it("snapshot/restore:创建 .db 文件;restore 后数据回到快照点;列表按时间倒序;cleanSnapshots 只留最近 20");
```

- [ ] **Step 2: backup.ts 关键实现**

```ts
export const EXPORT_TABLES = ["tasks","projects","notes","chats","chat_messages","links","goals","canvases","recurring_rules","quick_actions","quick_action_runs","flow_templates","flow_runs","step_runs","evolution_events","executors","provider_profiles","settings"] as const;
const SECRET_COLS: Record<string, string[]> = { provider_profiles: ["api_key_ref"], executors: ["api_key_ref"] };
export function exportData(db: Db, opts: { includeSecrets?: boolean }): BackupFile // 逐表 select.* → rows;!includeSecrets 时置 ""(注意 api_key_ref 语义:空串=未配置,导入后需重新填写)
export function parseBackup(raw: string): BackupFile // zod:version literal 1, exported_at string, tables record(仅白名单键)
export function importData(db: Db, file: BackupFile): { perTable: Record<string, number> } // db.transaction:逐表 delete 全量 → 分批 insert(列取交集,忽略备份多出的列)
export async function createSnapshot(dir = "data/backups"): Promise<string>  // sqlite backup API → evodesk-<yyyymmdd-hhmmss>.db
export async function restoreSnapshot(name: string, dir?): Promise<void>     // 先 createSnapshot("pre-restore-") 再 copyFile 覆盖 data/evodesk.db
export async function listSnapshots(dir?): Promise<{ name: string; sizeBytes: number; ts: string }[]>
export async function cleanSnapshots(keep = 20, dir?): Promise<void>
```

注意:restore 覆盖库文件后必须提示用户重启 `npm start`(better-sqlite3 持有句柄)——页面文案明确"恢复后需重启应用生效"。
- [ ] **Step 3: 四个 route** — export:GET → `new Response(JSON.stringify(file), { headers: { "Content-Type": "application/json", "Content-Disposition": \`attachment; filename="evodesk-backup-${ts}.json"\` } })`;import:POST `await request.formData()` 取 file → text → parseBackup → `createSnapshot()` → importData → 返回 perTable 统计;snapshot:POST 创建 / GET 列表;restore:POST `{name}`。
- [ ] **Step 4: BackupForm(client)** — 三个区块:导出(按钮 = `window.location = /api/backup/export`,旁注"默认不含 API 密钥"+ 勾选包含)、导入(file input → POST → 显示每表行数统计,失败红字)、快照(列表:名称/大小/时间 + 恢复按钮 confirm + 立即备份按钮);恢复成功提示"请重启应用"。
- [ ] **Step 5: 测试过;Commit** `feat(backup): json export/import with secret stripping and sqlite snapshots`

### Task 9'(M7 收尾): 设置页整合 + README + 全量验证

- [ ] **Step 1: settings/page.tsx** — 主题风格区(ThemePicker 卡片)、数据与备份区(BackupForm);原区块保留。
- [ ] **Step 2: README.md** — 特性清单加:画布工作台/链接/目标/帮助/本周复盘/7 主题/导入导出备份;快速开始不变。
- [ ] **Step 3: 全量验证**

```bash
npx vitest run            # 预期:全部通过(含既有 38 文件)
npm run lint              # 0 error
npm run build             # 成功
```

- [ ] **Step 4: Commit** `docs: README for M6+M7 (canvas workbench, themes, backup)`

---

## Self-Review 结论

- **Spec 覆盖**:§3.1–3.6(Task 1-10)、§4.1(Task 7')、§4.2(Task 8')、§9 验收 1/2/3/4/5(Task 9/10/7'/8')一一对应;§3.4 导航改名在 Task 10 Step 5。无缺口。
- **占位符扫描**:无 TBD;Task 8 widgets 与 Task 10 页面按结构规格实现(组件 JSX 逐行写入属实现细节,契约/交互/空态均已锁定)。
- **类型一致性**:CanvasLayout/WidgetData/StatsPayload.week/BackupFile 在 Task 2/7/3/8 定义,后续任务引用同名;`getSqlite()` 在 Task 8' 引入并被 snapshot/restore 使用。
