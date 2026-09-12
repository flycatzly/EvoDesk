# EvoDesk M4(流程库 + 进化引擎 + 快捷指令 + 笔记 + Obsidian 知识库)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付 M4 资产层——流程库(统计/谱系/克隆/退役)与进化引擎(复盘→变体→实验→晋升/淘汰)、快捷指令(command/url/launch 三型,复用 §10.2 安全门与 §10.3 启动器)、笔记速记(转任务/存入 Obsidian)、知识库(vault 白名单浏览/搜索/编辑)。

**Architecture:** 领域层新增 evolution(统计热点聚合 + 变体 ops 纯函数 + 晋升/退役)、quick-actions(渲染/预览/确认门复用 script-security;launch 型生成临时 settings 并 spawn claude.cmd)、vault(路径白名单复用 isPathWithin + 目录树/md 读写/搜索);schema 补齐 4 张表(quick_actions/quick_action_runs/notes/evolution_events,总数达设计稿 15);UI 四页(/flows、/notes、/vault、仪表盘快捷卡片)沿用一致性栏。

**Tech Stack:** 既有栈;新增无——spawn 复用 node:child_process,vault 文件 IO 用 node:fs/promises。

**Spec:** `docs/superpowers/specs/2026-09-06-evodesk-personal-workbench-design.md` §5.6/5.12/5.15、§9、§10.3、§11 视图 5/9/10、§12;前置:`docs/superpowers/plans/2026-09-06-evodesk-m3-execution-chat.md` 已全部落地(178/178 绿)。

**环境注意:** Windows + Git Bash;`D:\home\EvoFlow`;main @ d41b32c。

---

## 文件结构

```
src/lib/db/schema.ts            [+4 表:quick_actions/quick_action_runs/notes/evolution_events]
src/lib/db/seed.ts              [+幂等补齐:2 条示例快捷指令(url + command)]
src/lib/domain/
  evolution.ts                  [热点聚合 collectHotspots/buildAnalysisPrompt/parseAnalysis/applyVariant(纯函数)/promoteTemplate/retireTemplate/canAnalyze]
  quick-actions.ts              [renderQuickPayload/previewQuickAction(风险+掩码)/runQuickAction(command/url/launch 分型)]
  launch.ts                     [buildLaunchSettings(模型覆盖/非法字符替换,复刻 launcher.ps1)/spawnClaude(DryRun 支持)]
  vault.ts                      [resolveVaultPath(白名单)/listTree/readNote/writeNote/searchNotes]
  notes.ts                      [toTaskPayload/buildVaultPath/writeNoteToVault]
src/app/api/
  evolution/analyze/route.ts    POST 复盘分析 → variants 落库(experimental)+ 事件
  evolution/events/route.ts     GET 事件时间线
  templates/[id]/clone/route.ts POST 克隆
  templates/[id]/retire/route.ts POST 退役
  templates/[id]/promote/route.ts POST 晋升(同 lineage+complexity 仅一 active)
  quick-actions/route.ts        GET/POST/PATCH
  quick-actions/preview/route.ts POST 预览(渲染+风险,不执行)
  quick-actions/[id]/confirm/route.ts POST 确认执行 → quick_action_runs
  quick-actions/runs/route.ts   GET 历史
  notes/route.ts                GET/POST/PATCH
  notes/[id]/to-task/route.ts   POST 转任务
  notes/[id]/to-vault/route.ts  POST 存入 Obsidian
  vault/tree/route.ts           GET 目录树(白名单校验)
  vault/file/route.ts           GET/PUT md 读写(仅 vault 内)
  vault/search/route.ts         GET 搜索
src/components/
  FlowsView.tsx                 [流程库:卡片(统计徽章/谱系/状态)+克隆/退役/晋升+变体 diff+事件时间线]
  QuickActionsCard.tsx          [仪表盘快捷卡片]
  NotesView.tsx                 [笔记卡片流+转任务+存 vault]
  VaultView.tsx                 [目录树+搜索+编辑器]
src/app/
  flows/page.tsx  notes/page.tsx  vault/page.tsx
  page.tsx                      [改:仪表盘加快捷操作卡片]
  layout.tsx 无改;Sidebar.tsx   [改:flows/notes/vault ready:true]
README.md                       [M4 能力]
```

沿用约定:UTC-ISO、对象体守卫、ReqInit、一致性栏(IME/try-finally/res.ok/失败提示)、eslint argsIgnorePattern。

---

### Task 1: Schema v3(4 表)+ 迁移

**Files:**
- Modify: `src/lib/db/schema.ts`(追加)、Test: 无新(迁移由既有套件覆盖)
- Generate: `drizzle/0002_*.sql`

- [ ] **Step 1: schema.ts 末尾追加**

```ts
export const quickActions = sqliteTable("quick_actions", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("command"), // command|url|launch
  payload: text("payload").notNull(), // command 模板 / url / JSON {profile_id, model?, workdir?}
  shell: text("shell"),
  icon: text("icon"),
  sort: integer("sort").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const quickActionRuns = sqliteTable("quick_action_runs", {
  id: text("id").primaryKey(),
  actionId: text("action_id").notNull(),
  renderedPayload: text("rendered_payload").notNull(),
  output: text("output"),
  exitCode: integer("exit_code"),
  status: text("status").notNull(), // ok|failed|timeout|canceled
  durationMs: integer("duration_ms").notNull().default(0),
  ts: text("ts").notNull(),
});

export const notes = sqliteTable("notes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull().default("manual"), // manual|chat|task|news_digest
  taskId: text("task_id"),
  vaultPath: text("vault_path"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const evolutionEvents = sqliteTable("evolution_events", {
  id: text("id").primaryKey(),
  ts: text("ts").notNull(),
  kind: text("kind").notNull(), // variant_created|promoted|retired|analysis_run
  templateId: text("template_id"),
  relatedTemplateId: text("related_template_id"),
  reason: text("reason").notNull().default(""),
  detail: text("detail").notNull().default("{}"),
});
```

- [ ] **Step 2:** `npm run db:generate` → `drizzle/0002_*.sql`(4 CREATE TABLE)
- [ ] **Step 3:** `npm test`(178/27 全绿)、`npx tsc --noEmit`、`npm run build`
- [ ] **Step 4:** Commit `feat(db): quick_actions/quick_action_runs/notes/evolution_events schema`

---

### Task 2: evolution 领域(热点/复盘/变体 ops/晋升退役)

**Files:**
- Create: `src/lib/domain/evolution.ts`
- Test: `src/lib/domain/evolution.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { collectHotspots, applyVariant, promoteTemplate, retireTemplate, canAnalyze, EvolutionError } from "./evolution";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { tasks, flowRuns, stepRuns, flowTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let db: ReturnType<typeof createTestDb>;
let tpl: typeof flowTemplates.$inferSelect;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  tpl = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.name === "S 轻量通道")!;
});

function seedRun(opts: { step0Rejected?: boolean; satisfaction?: number; status?: string }) {
  const runId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.insert(flowRuns).values({ id: runId, taskId: crypto.randomUUID(), templateId: tpl.id, templateVersion: 1, status: opts.status ?? "done", startedAt: nowIso, finishedAt: nowIso, satisfaction: opts.satisfaction, totalCostUsd: 0.01, totalDurationMs: 1000 }).run();
  db.insert(stepRuns).values({ id: crypto.randomUUID(), runId, stepIndex: 0, stepName: "快速执行", executorType: "llm", status: "done", output: "x", rejected: opts.step0Rejected ? 1 : 0, attempt: 1 }).run();
  return runId;
}

describe("collectHotspots", () => {
  it("步骤级热点:打回/接管/成本聚合", () => {
    seedRun({ step0Rejected: true });
    seedRun({});
    const spots = collectHotspots(db, tpl.id);
    expect(spots[0]).toMatchObject({ stepIndex: 0, stepName: "快速执行", rejected: 1, runs: 2 });
  });
  it("无 run → 空数组", () => {
    expect(collectHotspots(db, tpl.id)).toEqual([]);
  });
});

describe("canAnalyze", () => {
  it("自上次分析后新完成 run ≥ 阈值(默认 5)", () => {
    expect(canAnalyze(db, tpl.id)).toBe(false);
    for (let i = 0; i < 5; i++) seedRun({});
    expect(canAnalyze(db, tpl.id)).toBe(true);
  });
});

describe("applyVariant", () => {
  it("remove_step/add_step/replace_executor_role/edit_prompt/reorder 合法 ops 应用", () => {
    const steps = [
      { name: "a", type: "llm", executorRole: "executor", prompt: "p1" },
      { name: "b", type: "manual", instruction: "do" },
    ];
    const out = applyVariant(steps as never, [
      { op: "edit_prompt", index: 0, prompt: "p2" },
      { op: "add_step", after_index: 1, step: { name: "c", type: "llm", executorRole: "reviewer", prompt: "p3" } },
      { op: "reorder", from: 2, to: 0 },
    ]);
    expect(out[0].name).toBe("c");
    expect(out[1].name).toBe("a");
    expect((out[1] as { prompt: string }).prompt).toBe("p2");
    expect(out).toHaveLength(3);
  });
  it("越界/非法 op 抛 EvolutionError,整单放弃", () => {
    expect(() => applyVariant([], [{ op: "remove_step", index: 5 } as never])).toThrow(EvolutionError);
    expect(() => applyVariant([{ name: "a", type: "llm" } as never], [{ op: "unknown_op" } as never])).toThrow(EvolutionError);
  });
});

describe("promoteTemplate/retireTemplate", () => {
  it("晋升:experimental→active,同 lineage+complexity 旧 active 自动 retired,写事件", () => {
    const v = crypto.randomUUID();
    db.insert(flowTemplates).values({ id: v, name: "S 变体", description: "", tags: "[]", complexity: "S", version: 2, lineageId: tpl.lineageId, parentId: tpl.id, origin: "evolution", status: "experimental", steps: tpl.steps, createdAt: now(), updatedAt: now() });
    promoteTemplate(db, v);
    expect((db.select().from(flowTemplates).where(eq(flowTemplates.id, v)).all()[0]).status).toBe("active");
    expect((db.select().from(flowTemplates).where(eq(flowTemplates.id, tpl.id)).all()[0]).status).toBe("retired");
  });
  it("晋升非 experimental 抛错", () => {
    expect(() => promoteTemplate(db, tpl.id)).toThrow(EvolutionError);
  });
  it("退役:active→retired,写事件", () => {
    retireTemplate(db, tpl.id, "成功率过低");
    expect((db.select().from(flowTemplates).where(eq(flowTemplates.id, tpl.id)).all()[0]).status).toBe("retired");
  });
});

const now = () => new Date().toISOString();
```
(测试文件顶部需补 `const now` 在使用前声明——置于 imports 之后。)

- [ ] **Step 2:** FAIL。**Step 3: 实现** `src/lib/domain/evolution.ts`

```ts
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { flowRuns, stepRuns, flowTemplates, evolutionEvents } from "@/lib/db/schema";
import { getStepDefs, type StepDef } from "@/lib/domain/step-def";

export class EvolutionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
const now = () => new Date().toISOString();

export interface StepHotspot { stepIndex: number; stepName: string; runs: number; rejected: number; manualOverrides: number; avgCostUsd: number }

export function collectHotspots(db: Db, templateId: string): StepHotspot[] {
  const runs = db.select().from(flowRuns).where(eq(flowRuns.templateId, templateId)).all() as (typeof flowRuns.$inferSelect)[];
  if (runs.length === 0) return [];
  const byRun = new Map(runs.map((r) => [r.id, r]));
  const steps = db.select().from(stepRuns).all() as (typeof stepRuns.$inferSelect)[];
  const acc = new Map<number, StepHotspot & { costSum: number }>();
  for (const s of steps) {
    if (!byRun.has(s.runId)) continue;
    const h = acc.get(s.stepIndex) ?? { stepIndex: s.stepIndex, stepName: s.stepName, runs: 0, rejected: 0, manualOverrides: 0, avgCostUsd: 0, costSum: 0 };
    h.runs++;
    if (s.rejected > 0) h.rejected++;
    if (s.feedbackNote === "manual_override") h.manualOverrides++;
    h.costSum += s.costUsd;
    acc.set(s.stepIndex, h);
  }
  return [...acc.values()].map(({ costSum, ...h }) => ({ ...h, avgCostUsd: h.runs ? costSum / h.runs : 0 }))
    .sort((a, b) => a.stepIndex - b.stepIndex);
}

export function canAnalyze(db: Db, templateId: string, threshold = 5): boolean {
  const last = db.select().from(evolutionEvents).where(eq(evolutionEvents.templateId, templateId)).orderBy(desc(evolutionEvents.ts)).all()[0];
  const runs = db.select().from(flowRuns).where(eq(flowRuns.templateId, templateId)).all() as (typeof flowRuns.$inferSelect)[];
  const done = runs.filter((r) => r.status === "done");
  if (!last) return done.length >= threshold;
  return done.filter((r) => r.startedAt > last.ts).length >= threshold;
}

// ── 变体 ops(纯函数)──
export type VariantOp =
  | { op: "remove_step"; index: number }
  | { op: "add_step"; after_index: number; step: StepDef }
  | { op: "replace_executor_role"; index: number; executor_role: string }
  | { op: "edit_prompt"; index: number; prompt: string }
  | { op: "reorder"; from: number; to: number };

export function applyVariant(steps: StepDef[], ops: VariantOp[]): StepDef[] {
  let out = steps.map((s) => ({ ...s }));
  for (const op of ops) {
    switch (op.op) {
      case "remove_step": {
        if (op.index < 0 || op.index >= out.length) throw new EvolutionError(`remove_step 越界:${op.index}`);
        out.splice(op.index, 1);
        break;
      }
      case "add_step": {
        if (op.after_index < -1 || op.after_index > out.length) throw new EvolutionError(`add_step 越界:${op.after_index}`);
        out.splice(op.after_index + 1, 0, { ...op.step });
        break;
      }
      case "replace_executor_role": {
        const s = out[op.index];
        if (!s) throw new EvolutionError(`replace_executor_role 越界:${op.index}`);
        s.executorRole = op.executor_role;
        break;
      }
      case "edit_prompt": {
        const s = out[op.index];
        if (!s) throw new EvolutionError(`edit_prompt 越界:${op.index}`);
        s.prompt = op.prompt;
        break;
      }
      case "reorder": {
        if (op.from < 0 || op.from >= out.length || op.to < 0 || op.to >= out.length) throw new EvolutionError(`reorder 越界`);
        const [m] = out.splice(op.from, 1);
        out.splice(op.to, 0, m);
        break;
      }
      default:
        throw new EvolutionError(`未知 op:${(op as { op: string }).op}`);
    }
  }
  return out;
}

function logEvent(db: Db, kind: string, templateId: string | null, relatedTemplateId: string | null, reason: string, detail: unknown) {
  db.insert(evolutionEvents).values({
    id: crypto.randomUUID(), ts: now(), kind, templateId, relatedTemplateId,
    reason: reason.slice(0, 500), detail: JSON.stringify(detail ?? {}),
  }).run();
}

export function promoteTemplate(db: Db, variantId: string): void {
  const variant = db.select().from(flowTemplates).where(eq(flowTemplates.id, variantId)).all()[0];
  if (!variant) throw new EvolutionError("模板不存在", 404);
  if (variant.status !== "experimental") throw new EvolutionError("仅实验模板可晋升");
  const siblings = db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[];
  for (const s of siblings) {
    if (s.id !== variant.id && s.lineageId === variant.lineageId && s.complexity === variant.complexity && s.status === "active") {
      db.update(flowTemplates).set({ status: "retired", updatedAt: now() }).where(eq(flowTemplates.id, s.id)).run();
      logEvent(db, "retired", s.id, variant.id, `被 ${variant.name} 晋升取代`, { auto: true });
    }
  }
  db.update(flowTemplates).set({ status: "active", updatedAt: now() }).where(eq(flowTemplates.id, variant.id)).run();
  logEvent(db, "promoted", variant.id, variant.parentId, "实验模板晋升为活跃", {});
}

export function retireTemplate(db: Db, templateId: string, reason: string): void {
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, templateId)).all()[0];
  if (!tpl) throw new EvolutionError("模板不存在", 404);
  if (tpl.status !== "active" && tpl.status !== "experimental") throw new EvolutionError("模板已退役");
  db.update(flowTemplates).set({ status: "retired", updatedAt: now() }).where(eq(flowTemplates.id, templateId)).run();
  logEvent(db, "retired", templateId, null, reason, {});
}
```
(`getStepDefs` 导入若未直接使用则省略——applyVariant 接收已解析的 StepDef[]。)

- [ ] **Step 4:** 全绿 → **Commit** `feat(domain): evolution hotspots, variant ops, promote/retire`

---

### Task 3: 进化 API(analyze/events + templates clone/retire/promote)

**Files:**
- Create: `src/app/api/evolution/analyze/route.ts`、`src/app/api/evolution/events/route.ts`、`src/app/api/templates/[id]/clone/route.ts`、`src/app/api/templates/[id]/retire/route.ts`、`src/app/api/templates/[id]/promote/route.ts`
- Test: `src/app/api/evolution/route.test.ts`

- [ ] **Step 1: 失败测试**(节选关键断言;ReqInit 模式)

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { flowRuns, stepRuns, flowTemplates, evolutionEvents, executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST as ANALYZE } from "@/app/api/evolution/analyze/route";
import { GET as EVENTS } from "@/app/api/evolution/events/route";
import { POST as CLONE } from "@/app/api/templates/[id]/clone/route";
import { POST as RETIRE } from "@/app/api/templates/[id]/retire/route";
import { POST as PROMOTE } from "@/app/api/templates/[id]/promote/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
let tpl: typeof flowTemplates.$inferSelect;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  tpl = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.name === "S 轻量通道")!;
});
function seedDoneRun() {
  const runId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  db.insert(flowRuns).values({ id: runId, taskId: crypto.randomUUID(), templateId: tpl.id, templateVersion: 1, status: "done", startedAt: nowIso, finishedAt: nowIso, totalCostUsd: 0.01, totalDurationMs: 1000 }).run();
  db.insert(stepRuns).values({ id: crypto.randomUUID(), runId, stepIndex: 0, stepName: "快速执行", executorType: "llm", status: "done", output: "x" }).run();
}

describe("evolution analyze/events", () => {
  it("mock LLM 复盘:变体以 experimental 落库(parent 指向原版)+ analysis_run 事件", async () => {
    for (let i = 0; i < 5; i++) seedDoneRun();
    db.update(executors).set({ enabled: true, role: "evolution", model: "m", apiBase: "https://x", protocol: "openai", apiKeyRef: "plain:k" }).where(eq(executors.name, "强模型")).run();
    const variants = [{ name: "S 精简版", changes: [{ op: "remove_step", index: 1 }], rationale: "checkpoint 打回率高" }];
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ diagnosis: "d", variants, retire_suggestions: [] }) } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: "m" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await ANALYZE(req("/api/evolution/analyze", { method: "POST", body: JSON.stringify({ template_id: tpl.id }) }));
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.variants.length).toBe(1);
    const v = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).find((t) => t.name === "S 精简版")!;
    expect(v.status).toBe("experimental");
    expect(v.parentId).toBe(tpl.id);
    expect(v.lineageId).toBe(tpl.lineageId);
    expect(JSON.parse(v.steps)).toHaveLength(1);
  });
  it("LLM 输出非法 → 502 degraded", async () => {
    for (let i = 0; i < 5; i++) seedDoneRun();
    db.update(executors).set({ enabled: true, role: "evolution", model: "m", apiBase: "https://x" }).where(eq(executors.name, "强模型")).run();
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }], usage: {}, model: "m" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await ANALYZE(req("/api/evolution/analyze", { method: "POST", body: JSON.stringify({ template_id: tpl.id }) }));
    vi.unstubAllGlobals();
    expect(res.status).toBe(502);
  });
  it("GET events 返回时间线", async () => {
    const res = await EVENTS(req("/api/evolution/events"));
    expect(res.status).toBe(200);
  });
});

describe("templates clone/retire/promote", () => {
  it("克隆:副本 manual/active/新 id,名称含 副本", async () => {
    const res = await CLONE(req(`/api/templates/${tpl.id}/clone`, { method: "POST" }), { params: Promise.resolve({ id: tpl.id }) });
    const data = await res.json();
    expect(data.template.status).toBe("active");
    expect(data.template.origin).toBe("manual");
    expect(data.template.name).toContain("副本");
    expect(data.template.id).not.toBe(tpl.id);
  });
  it("退役 → retired;晋升非实验 409", async () => {
    const r = await RETIRE(req(`/api/templates/${tpl.id}/retire`, { method: "POST", body: JSON.stringify({ reason: "x" }) }), { params: Promise.resolve({ id: tpl.id }) });
    expect((await r.json()).template.status).toBe("retired");
    const p = await PROMOTE(req(`/api/templates/${tpl.id}/promote`, { method: "POST" }), { params: Promise.resolve({ id: tpl.id }) });
    expect(p.status).toBe(409);
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现**

`src/app/api/evolution/analyze/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db/client";
import { flowRuns, stepRuns, flowTemplates, executors, evolutionEvents } from "@/lib/db/schema";
import { collectHotspots, applyVariant, canAnalyze, EvolutionError } from "@/lib/domain/evolution";
import { executorLlmConfig, callLlmWithRetry } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AnalysisSchema = z.object({
  diagnosis: z.string(),
  variants: z.array(z.object({
    name: z.string().min(1),
    changes: z.array(z.record(z.string(), z.unknown())),
    rationale: z.string(),
  })).max(3),
  retire_suggestions: z.array(z.object({ template_id: z.string(), reason: z.string() })),
});

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const templateId = typeof body?.template_id === "string" ? body.template_id : null;
  if (!templateId) return NextResponse.json({ error: "template_id 必填" }, { status: 400 });
  const db = getDb();
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, templateId)).all()[0];
  if (!tpl) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
  const force = body?.force === true;
  if (!force && !canAnalyze(db, templateId)) {
    return NextResponse.json({ error: "自上次复盘后完成次数未达阈值(可在 body 传 force:true 跳过)" }, { status: 409 });
  }
  const ex = (db.select().from(executors).all() as (typeof executors.$inferSelect)[])
    .find((e) => e.type === "llm" && e.enabled && (e.role === "evolution" || e.role === "planner"));
  if (!ex) return NextResponse.json({ error: "无可用的复盘执行器(启用 evolution/planner 角色模型)" }, { status: 409 });
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) { return NextResponse.json({ error: String(e) }, { status: 409 }); }

  const runs = db.select().from(flowRuns).where(eq(flowRuns.templateId, templateId)).all() as (typeof flowRuns.$inferSelect)[];
  const recentBad = runs.filter((r) => (r.satisfaction ?? 5) <= 2).slice(0, 3)
    .map((r) => ({ title: r.id, satisfaction: r.satisfaction, note: r.outcomeNote }));
  const prompt = [
    `你是流程进化引擎。基于以下数据为流程「${tpl.name}」提出改进变体(最多 3 个)。`,
    `当前步骤定义:${tpl.steps}`,
    `聚合统计:run=${runs.length}, done=${runs.filter((r) => r.status === "done").length}, avgCost=${tpl.statAvgCostUsd}, avgDuration=${tpl.statAvgDurationMs}, avgSatisfaction=${tpl.statAvgSatisfaction}`,
    `步骤热点:${JSON.stringify(collectHotspots(db, templateId))}`,
    `最近不满意的运行:${JSON.stringify(recentBad)}`,
    `只输出 JSON:{"diagnosis":"…","variants":[{"name":"…","changes":[…ops…],"rationale":"…"}],"retire_suggestions":[]}`,
    `可用 ops:remove_step{index}/add_step{after_index,step}/replace_executor_role{index,executor_role}/edit_prompt{index,prompt}/reorder{from,to}`,
  ].join("\n");

  const started = Date.now();
  try {
    const out = await callLlmWithRetry(cfg, [{ role: "user", content: prompt }]);
    const parsed = AnalysisSchema.safeParse(safeJson(out.text));
    db.insert(evolutionEvents).values({ id: crypto.randomUUID(), ts: new Date().toISOString(), kind: "analysis_run", templateId, relatedTemplateId: null, reason: parsed.success ? parsed.data.diagnosis.slice(0, 500) : "输出解析失败", detail: { degraded: !parsed.success, durationMs: Date.now() - started } }).run();
    if (!parsed.success) return NextResponse.json({ error: "复盘输出无法解析,已记录事件", degraded: true }, { status: 502 });
    const baseSteps = JSON.parse(tpl.steps) as unknown[];
    const created: string[] = [];
    for (const v of parsed.data.variants) {
      try {
        const steps = applyVariant(baseSteps as never, v.changes as never);
        const id = crypto.randomUUID();
        db.insert(flowTemplates).values({
          id, name: v.name.slice(0, 50), description: v.rationale.slice(0, 200), tags: tpl.tags, complexity: tpl.complexity,
          version: tpl.version + 1, lineageId: tpl.lineageId, parentId: tpl.id, origin: "evolution", status: "experimental",
          steps: JSON.stringify(steps), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        }).run();
        db.insert(evolutionEvents).values({ id: crypto.randomUUID(), ts: new Date().toISOString(), kind: "variant_created", templateId: tpl.id, relatedTemplateId: id, reason: v.rationale.slice(0, 500), detail: { changes: v.changes } }).run();
        created.push(id);
      } catch { /* 单个变体 ops 非法 → 放弃该变体,继续 */ }
    }
    for (const r of parsed.data.retire_suggestions) {
      db.insert(evolutionEvents).values({ id: crypto.randomUUID(), ts: new Date().toISOString(), kind: "analysis_run", templateId: r.template_id, relatedTemplateId: null, reason: `退役建议:${r.reason.slice(0, 200)}`, detail: {} }).run();
    }
    return NextResponse.json({ diagnosis: parsed.data.diagnosis, created, retire_suggestions: parsed.data.retire_suggestions });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 300) }, { status: 502 });
  }
}

function safeJson(text: string): unknown {
  const s = text.indexOf("{"); const e = text.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}
```
(未使用的 EvolutionError 导入删去;flowRuns/stepRuns 使用处核对。)

`src/app/api/evolution/events/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { evolutionEvents } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  return NextResponse.json({ events: getDb().select().from(evolutionEvents).orderBy(desc(evolutionEvents.ts)).all().slice(0, 100) });
}
```

`src/app/api/templates/[id]/clone/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { flowTemplates } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, id)).all()[0];
  if (!tpl) return NextResponse.json({ error: "not found" }, { status: 404 });
  const copy = {
    id: crypto.randomUUID(), name: `${tpl.name} 副本`.slice(0, 60), description: tpl.description, tags: tpl.tags,
    complexity: tpl.complexity, version: 1, lineageId: crypto.randomUUID(), parentId: null, origin: "manual",
    status: "active", steps: tpl.steps, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  db.insert(flowTemplates).values(copy).run();
  return NextResponse.json({ template: db.select().from(flowTemplates).where(eq(flowTemplates.id, copy.id)).all()[0] }, { status: 201 });
}
```

`retire`/`promote` routes: thin wrappers calling `retireTemplate(db, id, body.reason)/promoteTemplate(db, id)`, RunError→status mapping (EvolutionError has status), returning updated template row.

- [ ] **Step 4:** 全绿 → **Commit** `feat(api): evolution analyze/events + template clone/retire/promote`

---

### Task 4: /flows 流程库 UI

**Files:**
- Create: `src/app/flows/page.tsx`、`src/components/FlowsView.tsx`
- Modify: `src/components/Sidebar.tsx`(flows ready:true)

要点(一致性栏全程;服务端页加载 templates + evolutionEvents;客户端组件):
- 卡片:name/origin 徽章(seed/manual/evolution)、status 徽章(active 强调/experimental 警示/retired 灰)、复杂度、统计徽章(`statRuns 次 · 成功率 {pct}% · 均 ${cost} · 均 {s}s · 满意 {n}`)、步骤数
- 操作:克隆(POST clone)、退役(active/experimental → retire,confirm 文案)、晋升(仅 experimental → promote);每个动作 busy guard + 失败提示 + router.refresh()
- 变体查看:experimental 卡片展示 parent 名称 + rationale(description 字段)+ steps 与 parent 的 diff(简单列表:以 name 对齐,增/删/改提示用 +/- 前缀;不做复杂 diff 算法,逐 step 对比 type/prompt 变化)
- 事件时间线:底部 surface 卡片列出 events(kind 中文映射 variant_created→变体诞生/promoted→已晋升/retired→已退役/analysis_run→复盘分析,ts,reason)
- 无模板操作创建(编辑器 v2); retirees 可被克隆重启

**Gates:** 178 全绿、tsc、lint 0/0、build 绿(`/flows` 动态)。**Commit** `feat(ui): flows library with lineage, stats, evolution events`

---

### Task 5: quick-actions + launch 领域

**Files:**
- Create: `src/lib/domain/quick-actions.ts`、`src/lib/domain/launch.ts`
- Test: `src/lib/domain/quick-actions.test.ts`、`src/lib/domain/launch.test.ts`

**quick-actions.ts**(渲染/预览/执行分型):
```ts
import path from "node:path";
import { renderPrompt } from "@/lib/domain/executor-resolve";
import { scanRisk, checkWhitelist, DEFAULT_WHITELIST } from "@/lib/domain/script-security";
import { executeScript } from "@/lib/domain/script-runner";

export interface QuickActionRow { id: string; name: string; type: string; payload: string; shell: string | null; enabled: boolean }

export function renderQuickPayload(action: { type: string; payload: string }, task?: { title: string }): string {
  if (action.type === "command") return renderPrompt(action.payload, { task: { title: task?.title ?? "", description: "" }, prevOutput: "" });
  return action.payload;
}

export function previewQuickAction(action: { type: string; payload: string }, workingDirs: string[]): { rendered: string; risks: string[]; needsWhitelist: boolean } {
  const rendered = renderQuickPayload(action);
  return { rendered, risks: action.type === "command" ? scanRisk(rendered) : [], needsWhitelist: action.type === "command" };
}

export async function runCommandAction(command: string, shell: string, workingDir: string): Promise<{ output: string; exitCode: number | null; durationMs: number; status: "ok" | "failed" | "timeout" }> {
  const r = await executeScript(shell, command, { cwd: workingDir, timeoutMs: 60_000 });
  return { output: r.output, exitCode: r.exitCode, durationMs: r.durationMs, status: r.timedOut ? "timeout" : r.exitCode === 0 ? "ok" : "failed" };
}

export function resolveWorkingDir(candidate: string | null | undefined): string {
  const dir = candidate ? path.resolve(candidate) : path.resolve("data", "sandbox");
  if (!checkWhitelist(dir, DEFAULT_WHITELIST)) throw new Error(`工作目录不在白名单:${dir}`);
  return dir;
}
```
(launch 分型在 launch.ts;url 型由路由直接记 run。)

**launch.ts**(复刻 launcher.ps1 核心逻辑):
```ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface LaunchSpec { profileName: string; apiBase: string; apiKeyRef: string; model: string | null; workdir: string }

export function sanitizeModelName(model: string): string {
  return model.replace(/[[\]*?"<>|/:\\]/g, "_");
}

export function buildLaunchSettings(raw: string, model: string | null): string {
  const cfg = JSON.parse(raw) as Record<string, unknown>;
  const env = (cfg.env ?? {}) as Record<string, unknown>;
  if (model) {
    env.ANTHROPIC_MODEL = model;
    cfg.model = model;
  }
  cfg.env = env;
  const outDir = path.join(process.cwd(), "data", "generated");
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `launch-${sanitizeModelName(model ?? "default")}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf8");
  return file;
}

export function spawnClaude(settingsPath: string, model: string | null, workdir: string, dryRun: boolean): Promise<{ status: "ok" | "failed"; detail: string }> {
  const args = ["--settings", settingsPath, ...(model ? ["--model", model] : [])];
  if (dryRun) return Promise.resolve({ status: "ok", detail: `claude.cmd ${args.join(" ")} (工作目录:${workdir})` });
  return new Promise((resolve) => {
    const child = spawn("claude.cmd", args, { cwd: workdir, windowsHide: true, stdio: "ignore", shell: true });
    child.on("error", (e) => resolve({ status: "failed", detail: String(e).slice(0, 200) }));
    child.on("spawn", () => { child.unref(); resolve({ status: "ok", detail: "已启动新终端窗口" }); });
  });
}
```
安全要点(注释写明):settings 临时文件含密钥 → 落 `data/generated/`(已 gitignore 的 /data/ 下)+ 路由在成功后延迟删除;`shell: true` 使 claude.cmd 经 PATH 解析。

**launch 测试**(DryRun 路径,不开窗):sanitizeModelName 替换非法字符;buildLaunchSettings 覆盖 ANTHROPIC_MODEL+model 并落文件(临时 EVODESK 生成的目录,断言文件存在且 JSON 正确后删除);spawnClaude dryRun 返回命令预览。

**quick-actions 测试**:renderQuickPayload 命令含 {{task.title}} 渲染/url 原样;previewQuickAction 风险扫描(command 命中 /url 空);resolveWorkingDir 白名单外抛错。

- [ ] 各自 TDD 红→绿;**Commit** `feat(domain): quick actions render/preview + launcher settings/spawn`

---

### Task 6: quick-actions API

**Files:**
- Create: `src/app/api/quick-actions/route.ts`(GET/POST/PATCH)、`.../[id]/confirm/route.ts`(POST:执行)、`.../preview/route.ts`(POST:渲染+风险,不执行)、`runs/route.ts`(GET 历史)
- Test: `src/app/api/quick-actions/route.test.ts`

路由要点:
- GET:actions(enabled 排前,sort)+ 最近 20 条 runs
- POST:name/type(command|url|launch)/payload/shell?(command)必填校验;launch 的 payload 须为 JSON 且能 parse 出 profile_id(400)
- PATCH:name/payload/shell/icon/sort/enabled 白名单
- preview:按型渲染;command → scanRisk + 白名单校验(工作目录默认 sandbox);launch → 解析 payload 找 profile,生成 settings(DryRun)+ 返回 {command: "claude.cmd --settings …", risks: []};url → 原样
- confirm:command → 确认门已在前端(预览)完成,此处直接执行 runCommandAction → 记 quick_action_runs(ok/failed/timeout + output 截断 64KB);url → 记 run(status ok, output=url)并返回 {url}(前端 window.open);launch → buildLaunchSettings(从 profile 读 raw settings——**注意:provider_profiles 不存原始 txt!** 存的是解析后的字段。修正:launch payload 存 `{profile_id, model, workdir}`,执行时从 profile 的 apiKeyRef/apiBase/protocol/model 重建一个最小 settings JSON `{ env: { ANTHROPIC_AUTH_TOKEN: <plain 解析>, ANTHROPIC_BASE_URL, ANTHROPIC_MODEL: model }, model }`——密钥解析复用 resolveApiKey,不落明文日志;写临时文件→spawn→成功后 1s 删除文件)→ 记 run
- 全部动作后返回最新 runs

**测试**:CRUD;preview command 风险;confirm url 型记 run;confirm command 型白名单外 409;confirm launch DryRun(preview 路径)与真实执行跳过(不开窗,标注说明仅测 url/command;launch 真实 spawn 的测试用 dryRun 标志经 preview 覆盖)。

- [ ] TDD;**Commit** `feat(api): quick-actions CRUD/preview/confirm/runs`

---

### Task 7: 仪表盘快捷卡片 + Sidebar

**Files:**
- Modify: `src/app/page.tsx`(快捷操作卡片区块)、`src/components/Sidebar.tsx`(flows ready:true)
- Create: `src/components/QuickActionsCard.tsx`

卡片:列出 enabled 快捷指令(按 sort);url 型点击 → POST confirm → window.open(url);command 型点击 → POST preview → 弹出渲染命令+风险(确认按钮)→ POST confirm;launch 型点击 → preview 显示将启动的命令/模型/工作目录 → confirm。每动作 busy + 失败提示。区块标题「快捷操作」,空态「在 API 或后续设置页添加快捷指令」。

**Gates 同前。Commit** `feat(ui): dashboard quick actions card`

---

### Task 8: notes 领域 + API

**Files:**
- Create: `src/lib/domain/notes.ts`、`src/app/api/notes/route.ts`(GET/POST/PATCH)、`src/app/api/notes/[id]/to-task/route.ts`、`src/app/api/notes/[id]/to-vault/route.ts`
- Test: `src/app/api/notes/route.test.ts` + `src/lib/domain/notes.test.ts`(toVaultPath:标题非法字符替换 + 落指定子目录)

**领域**:
```ts
export function toVaultFileName(title: string): string {
  return title.replace(/[[\]*?"<>|/:\\]/g, "_").slice(0, 60) || "未命名";
}
export function buildVaultPath(vaultRoot: string, subDir: string, title: string): string {
  return path.join(vaultRoot, subDir, `${toVaultFileName(title)}.md`);
}
export function noteToMarkdown(note: { title: string; body: string; tags: string; createdAt: string }): string {
  const tags = JSON.parse(note.tags) as string[];
  return `# ${note.title}\n\n${note.body}\n\n${tags.map((t) => `#${t}`).join(" ")}\n`.trimEnd() + "\n";
}
```
**API**:GET 列表(pinned 前,updatedAt desc);POST title 必填;PATCH title/body/tags/pinned 白名单;to-task:由笔记创建任务(title=笔记标题,description=body,tags 继承)→ 回写 notes.taskId,201;to-vault:读 settings.vault_path(空 → 400 请先在设置页配置)→ resolveVaultPath 白名单校验(子目录默认 `02_笔记`,不存在则创建——仅限 vault 根内)→ 写 md(vaultPath 已存在则覆盖前 400 提示?规格:写入生成 md;选择:已存在 → 加时间戳后缀)→ 回写 notes.vaultPath。

**vault.ts(同任务或独立小模块,Task 9 复用)**:`resolveVaultPath(root, rel)`(isPathWithin(root, joined) 校验,拒绝 `..`);`listTree(root, depth≤2)`;`readNote/readNoteRaw`;`writeNoteRaw`;`searchNotes(root, q)`(递归 .md 前 50 命中,返回 {path, snippet})。

- [ ] TDD;**Commit** `feat(domain+api): notes CRUD, to-task, to-vault`

---

### Task 9: vault API

**Files:**
- Create: `src/app/api/vault/tree/route.ts`、`src/app/api/vault/file/route.ts`(GET/PUT)、`src/app/api/vault/search/route.ts`
- Test: `src/app/api/vault/route.test.ts`

统一入口:读 settings.vault_path → 空 400 `请先在设置页配置 Obsidian vault 路径` → 目录不存在 400。所有路径参数经 `resolveVaultPath` 白名单(`..`/绝对路径/vault 外 → 403)。
- tree:GET ?path=(相对,空=根)→ 目录/文件列表(md 优先标注)
- file:GET ?path= → {content};PUT {path, content} → 写回(仅 .md/.txt;≤1MB)
- search:GET ?q= → 命中列表
**测试**:临时目录建 vault(settings 写 vault_path)→ tree 根列表;file 读写往返;`path=../escape` → 403;未配置 vault → 400;search 命中与空结果。

- [ ] TDD;**Commit** `feat(api): vault tree/file/search with whitelist`

---

### Task 10: /notes + /vault UI + Sidebar + README

**Files:**
- Create: `src/app/notes/page.tsx`、`src/components/NotesView.tsx`、`src/app/vault/page.tsx`、`src/components/VaultView.tsx`
- Modify: `src/components/Sidebar.tsx`(notes/vault ready:true)、`README.md`
- seed.ts:[+示例快捷指令 2 条:打开 Z.ai 控制台(url,https://chat.z.ai)、清理沙盒目录(command,`Get-ChildItem data/sandbox`)] + 示例笔记 1 条(幂等补齐块,同 T18 模式)

**NotesView**:卡片流(pinned 置顶/标签/来源徽章/更新时间);新建(标题+正文);编辑(展开 textarea 保存);转任务(按钮 → to-task → 提示+refresh);存入 Obsidian(按钮 → to-vault → 成功显示 vaultPath);删除(可选,DELETE 端点若不加则不做——YAGNI:不做删除,v1 笔记不可删,标记后续)。
**VaultView**:左侧目录树(listTree 渲染,目录折叠用 details/summary,点击 md 文件加载);右侧编辑器(textarea + 保存 PUT + 新建文件 prompt 文件名);顶部搜索框(回车 → search → 命中列表点击加载)。
**README**:能力清单加流程库/进化引擎/快捷指令/笔记/知识库行;后续里程碑改 M5。
**Sidebar**:flows/notes/vault ready:true。

**Gates + 可选 smoke。Commit** `feat(ui): notes and vault pages; sidebar; README M4`

---

## 后续(不在本计划)

M5:风险雷达、日历视图、统计页(recharts)、移动端导航、UTC 时区设置、聊天历史窗口、done 步骤产出回看、双栏执行视图。
