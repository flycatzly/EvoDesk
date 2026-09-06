# EvoDesk M3(执行引擎 + 模型路由 + AI 对话台)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让任务真正跑起来——流程实例(run)按模板逐步执行,LLM 步骤流式产出、脚本步骤过安全门执行本地命令、人工/审核步骤等待用户;同时接入供应商档案(启动器配置导入/派生执行器)并交付 AI 对话台。

**Architecture:** 领域层新增 runner(状态推进 + 兜底链)与 script-security/script-runner(§10.2 安全模型);LLM 客户端扩展 `streamLlm` 双协议 SSE;执行推进采用"advance 改状态 + GET stream 单步执行"模式,客户端在 done 事件后刷新并自动串行推进后续 llm 步骤;对话台复用 streamLlm,按消息粒度记模型与成本。

**Tech Stack:** 既有栈(Next.js 16 / better-sqlite3 / Drizzle / vitest / Tailwind v4)新增 node:child_process(spawn)。

**Spec:** `docs/superpowers/specs/2026-09-06-evodesk-personal-workbench-design.md` §5.3/5.4/5.6、§6、§8、§10.1/10.2/10.3、§11 视图 4/6/8、§12;前置:`docs/superpowers/plans/2026-09-06-evodesk-m1-m2-foundation.md` 已全部落地(76/76 测试绿)。

**环境注意:** Windows + Git Bash;命令在 `D:\home\EvoFlow` 执行;当前 main @ `49eeeb0`。

---

## 文件结构(本计划新增/修改)

```
src/lib/db/schema.ts            [+5 表:flow_runs/step_runs/provider_profiles/chats/chat_messages]
src/lib/db/seed.ts              [+幂等补齐:reviewer 占位执行器、示例会话]
src/lib/domain/
  status.ts                     [修订:running→review 合法(Plan 2 runner 依规格 §6 驱动)]
  step-def.ts                   [StepDef 类型 + getStepDefs(stepsJson)]
  executor-resolve.ts           [角色→执行器解析(回退 executor)+ 提示词渲染 {{task.*}}/{{prev_output}}]
  stream-llm.ts                 [streamLlm:双协议 SSE 流式(放 llm/ 目录)→ src/lib/llm/stream.ts]
  runner.ts                     [startRun/currentStep/syncRunStatus/runLlmStep/executeScriptStep/reject/approve/完成聚合]
  template-stats.ts             [refreshTemplateStats:成功率/成本/时长/满意度聚合]
  script-security.ts            [渲染/破坏性模式扫描/白名单/确认门判定]
  script-runner.ts              [spawn 四 shell + 超时 + 截断]
  profiles.ts                   [启动器配置解析/目录导入/派生执行器]
src/app/api/
  tasks/[id]/start/route.ts                 POST 创建 run
  runs/[id]/route.ts                        GET run+steps+current
  runs/[id]/steps/[n]/advance/route.ts      POST 动作分发(execute/confirm/submit/approve/reject/skip/retry/manual_override)
  runs/[id]/steps/[n]/stream/route.ts       GET SSE 单步执行
  runs/[id]/feedback/route.ts               POST 评分 → 任务 done + 模板统计
  provider-profiles/route.ts                GET/POST
  provider-profiles/import/route.ts         POST 目录扫描导入
  provider-profiles/[id]/derive/route.ts    POST 派生执行器
  executors/[id]/route.ts                   PATCH(启用/编辑)
  executors/[id]/test/route.ts              POST 连通性 ping
  chats/route.ts                            GET/POST
  chats/[id]/route.ts                       GET 含消息
  chats/[id]/messages/route.ts              POST 发消息(SSE 流式回复)
src/components/
  RunView.tsx                   [执行视图客户端:时间线+当前步面板+SSE 消费]
  BoardActions.tsx              [改:卡片链接→执行视图(在 page.tsx)]
  ExecutorsView.tsx             [执行器/档案管理客户端]
  ChatView.tsx                  [对话台客户端:会话+消息+模型选择+SSE]
src/app/
  tasks/[id]/page.tsx           [执行视图页(无 run → 开始执行按钮)]
  executors/page.tsx            [执行器管理页]
  chat/page.tsx                 [对话台页]
  page.tsx / tasks/page.tsx     [改:链接指向执行视图]
docs/…/m1-m2-foundation.md      [不改;本计划自带全部上下文]
```

已知前置约定(沿用):UTC-ISO 时间、`toApiTask`、对象体守卫、IME 安全 Enter、fetch try/finally+res.ok、`ReqInit = ConstructorParameters<typeof NextRequest>[1]`、eslint `argsIgnorePattern: "^_"`。

---

### Task 1: Schema v2(5 张新表)+ 迁移

**Files:**
- Modify: `src/lib/db/schema.ts`(追加)
- Generate: `drizzle/0001_*.sql`

- [ ] **Step 1: 在 schema.ts 末尾追加**

```ts
export const flowRuns = sqliteTable("flow_runs", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  templateId: text("template_id").notNull(),
  templateVersion: integer("template_version").notNull().default(1),
  status: text("status").notNull().default("running"), // running|waiting_human|done|failed|canceled(review 是任务态)
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  totalCostUsd: real("total_cost_usd").notNull().default(0),
  totalDurationMs: integer("total_duration_ms").notNull().default(0),
  satisfaction: integer("satisfaction"),
  outcomeNote: text("outcome_note"),
});

export const stepRuns = sqliteTable("step_runs", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  stepIndex: integer("step_index").notNull(),
  stepName: text("step_name").notNull(),
  executorType: text("executor_type").notNull(), // llm|manual|checkpoint|script
  model: text("model"),
  status: text("status").notNull().default("pending"), // pending|awaiting_confirmation|running|done|skipped|failed
  input: text("input"),
  output: text("output"),
  error: text("error"),
  costUsd: real("cost_usd").notNull().default(0),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  attempt: integer("attempt").notNull().default(1),
  rejected: integer("rejected").notNull().default(0),
  feedback: text("feedback"),
  feedbackNote: text("feedback_note"),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
});

export const providerProfiles = sqliteTable("provider_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  protocol: text("protocol").notNull().default("anthropic"), // anthropic|openai
  apiBase: text("api_base").notNull(),
  apiKeyRef: text("api_key_ref").notNull(),
  candidates: text("candidates").notNull().default("[]"), // [{model, alias, tier}]
  source: text("source").notNull().default("import"), // import|manual
  importPath: text("import_path"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const chats = sqliteTable("chats", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  defaultExecutorId: text("default_executor_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  role: text("role").notNull(), // user|assistant
  content: text("content").notNull(),
  executorId: text("executor_id"),
  model: text("model"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  createdAt: text("created_at").notNull(),
});
```

- [ ] **Step 2: 生成迁移** — `npm run db:generate`(生成 `drizzle/0001_*.sql`,5 张新表)
- [ ] **Step 3: 验证** — `npm test`(76 全绿;createTestDb 走新迁移)、`npx tsc --noEmit`、`npm run build`
- [ ] **Step 4: Commit** — `git add -A && git commit -m "feat(db): flow_runs/step_runs/provider_profiles/chats schema"`

---

### Task 2: 状态机修订(running→review)

**Files:**
- Modify: `src/lib/domain/status.ts:11`、`src/lib/domain/status.test.ts`

- [ ] **Step 1: 修改测试**(Task 4 断言 `canTransition("running","review")` 为 false 的用例,改为 true 并更新注释——Plan 2 runner 在 run 完成时依规格 §6 直接驱动 running→review;经 waiting_human 的路径仍保留)

```ts
  it("review → done 合法,running → review 合法(runner 完成聚合驱动,规格 §6),archived 终态", () => {
    expect(canTransition("review", "done")).toBe(true);
    expect(canTransition("running", "review")).toBe(true);
    expect(canTransition("archived", "done")).toBe(false);
  });
```

- [ ] **Step 2: 修改实现** — `running: ["waiting_human", "review", "ready", "canceled"],`(注释:review 由 runner 完成聚合驱动,手动流转仍走 waiting_human)
- [ ] **Step 3:** `npm test` 全绿 → **Commit** `feat(domain): running→review for run-completion aggregation`

---

### Task 3: step-def + executor-resolve(角色解析与提示词渲染)

**Files:**
- Create: `src/lib/domain/step-def.ts`、`src/lib/domain/executor-resolve.ts`
- Test: `src/lib/domain/executor-resolve.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { getStepDefs, resolveStepExecutor, renderPrompt } from "./executor-resolve";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

describe("getStepDefs", () => {
  it("解析模板 steps JSON", () => {
    const defs = getStepDefs('[{"name":"a","type":"llm","executorRole":"executor","prompt":"p"}]');
    expect(defs[0]).toMatchObject({ name: "a", type: "llm" });
  });
});

describe("resolveStepExecutor", () => {
  it("角色精确匹配优先,回退 executor 角色,无则 null", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    // 种子:快速模型 role=triage(disabled)、强模型 role=planner(disabled)——默认全禁用 → null
    expect(resolveStepExecutor(db, "planner")).toBeNull();
    db.update(executors).set({ enabled: true }).where(eq(executors.name, "强模型")).run();
    expect(resolveStepExecutor(db, "planner")?.name).toBe("强模型");
    // 无 reviewer → 回退 executor 角色
    db.update(executors).set({ enabled: true }).where(eq(executors.name, "快速模型")).run();
    db.update(executors).set({ role: "executor" }).where(eq(executors.name, "快速模型")).run();
    expect(resolveStepExecutor(db, "reviewer")?.name).toBe("快速模型");
  });
});

describe("renderPrompt", () => {
  it("替换任务与上一步产出变量,未知变量原样保留", () => {
    const out = renderPrompt("任务:{{task.title}}\n描述:{{task.description}}\n上一步:\n{{prev_output}}\n{{unknown}}", {
      task: { title: "T", description: "D" },
      prevOutput: "P",
    });
    expect(out).toBe("任务:T\n描述:D\n上一步:\nP\n{{unknown}}");
  });
});
```

- [ ] **Step 2:** `npm test` → FAIL。**Step 3: 实现**

```ts
// src/lib/domain/step-def.ts
export interface StepDef {
  name: string;
  type: "llm" | "manual" | "checkpoint" | "script";
  executorRole?: string; // llm 步骤:角色绑定(seed 形态),运行时解析
  executor_id?: string;  // script 步骤:执行器 id
  prompt?: string;
  instruction?: string;
  command?: string;
  timeout_ms?: number;
  optional?: boolean;
}
export function getStepDefs(stepsJson: string): StepDef[] {
  return JSON.parse(stepsJson) as StepDef[];
}
```

```ts
// src/lib/domain/executor-resolve.ts
import type { Db } from "@/lib/db/test-util";
import { executors } from "@/lib/db/schema";

export interface ResolvedExecutor {
  id: string; name: string; type: string; role: string;
  model: string | null; apiBase: string | null; protocol: string | null;
  apiKeyRef: string | null; costPer1kInput: number; costPer1kOutput: number;
  shell: string | null; workingDir: string | null; timeoutMs: number; autoApprove: boolean;
}

export function resolveStepExecutor(db: Db, role: string): ResolvedExecutor | null {
  const all = db.select().from(executors).all() as unknown as ResolvedExecutor[];
  const enabled = all.filter((e) => e.type === "llm" && e.enabled);
  return enabled.find((e) => e.role === role) ?? enabled.find((e) => e.role === "executor") ?? null;
}

export function renderPrompt(
  prompt: string,
  vars: { task: { title: string; description: string }; prevOutput: string },
): string {
  return prompt
    .replaceAll("{{task.title}}", vars.task.title)
    .replaceAll("{{task.description}}", vars.task.description)
    .replaceAll("{{prev_output}}", vars.prevOutput);
}
```

- [ ] **Step 4:** `npm test` 全绿 → **Commit** `feat(domain): step defs, role-based executor resolution, prompt rendering`

---

### Task 4: streamLlm 双协议流式客户端

**Files:**
- Create: `src/lib/llm/stream.ts`
- Test: `src/lib/llm/stream.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, vi } from "vitest";
import { streamLlm } from "./stream";

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(c) { chunks.forEach((ch) => c.enqueue(encoder.encode(ch))); c.close(); },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("streamLlm", () => {
  it("openai SSE:逐 delta yield,usage 汇总,模型透传", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ]));
    const it = streamLlm({ model: "m", apiBase: "https://x/v1", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    const parts: string[] = [];
    let final;
    for (;;) {
      const r = await it.next();
      if (r.done) { final = r.value; break; }
      parts.push(r.value);
    }
    expect(parts.join("")).toBe("你好");
    expect(final).toMatchObject({ text: "你好", tokensIn: 9, tokensOut: 2, model: "m" });
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
  it("anthropic SSE:message_start/content_block_delta/message_delta", async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":6},"model":"m2"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Bon"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"jour"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]));
    const it = streamLlm({ model: "m2", apiBase: "https://y/api/anthropic", protocol: "anthropic", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    const parts: string[] = [];
    let final;
    for (;;) {
      const r = await it.next();
      if (r.done) { final = r.value; break; }
      parts.push(r.value);
    }
    expect(parts.join("")).toBe("Bonjour");
    expect(final).toMatchObject({ text: "Bonjour", tokensIn: 6, tokensOut: 4, model: "m2" });
  });
  it("非 2xx 抛错", async () => {
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const it = streamLlm({ model: "m", apiBase: "https://x", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    await expect(it.next()).rejects.toThrow(/500/);
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现** `src/lib/llm/stream.ts`

```ts
import type { LlmConfig, LlmResult, LlmMessage } from "./client";

function sseDataLines(buffer: string): string[] {
  return buffer.split("\n\n").filter((b) => b.startsWith("data:")).map((b) => b.slice(5).trim()).filter(Boolean);
}

export async function* streamLlm(
  cfg: LlmConfig, messages: LlmMessage[], fetchImpl: typeof fetch = fetch,
): AsyncGenerator<string, LlmResult, void> {
  const url = cfg.protocol === "anthropic" ? `${cfg.apiBase}/v1/messages` : `${cfg.apiBase}/chat/completions`;
  const body = cfg.protocol === "anthropic"
    ? { model: cfg.model, max_tokens: 4096, stream: true, system: messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined, messages: messages.filter((m) => m.role !== "system") }
    : { model: cfg.model, stream: true, stream_options: { include_usage: true }, messages };
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, ...(cfg.protocol === "anthropic" ? { "anthropic-version": "2023-06-01" } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok || !res.body) throw new Error(`${cfg.protocol} ${res.status}: ${await res.text().catch(() => "")}`);
  let text = ""; let tokensIn = 0; let tokensOut = 0; let model = cfg.model;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const data of sseDataLines(blocks.join("\n\n"))) {
      if (data === "[DONE]") continue;
      let evt: Record<string, unknown>;
      try { evt = JSON.parse(data); } catch { continue; }
      if (cfg.protocol === "anthropic") {
        const type = evt.type as string;
        if (type === "message_start") { tokensIn = (evt as { message?: { usage?: { input_tokens?: number } } }).message?.usage?.input_tokens ?? 0; model = (evt as { message?: { model?: string } }).message?.model ?? model; }
        else if (type === "content_block_delta") { const t = (evt as { delta?: { text?: string } }).delta?.text ?? ""; if (t) { text += t; yield t; } }
        else if (type === "message_delta") { tokensOut = (evt as { usage?: { output_tokens?: number } }).usage?.output_tokens ?? tokensOut; }
      } else {
        const choices = (evt as { choices?: { delta?: { content?: string } }[] }).choices;
        const usage = (evt as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
        if (usage) { tokensIn = usage.prompt_tokens ?? tokensIn; tokensOut = usage.completion_tokens ?? tokensOut; }
        const t = choices?.[0]?.delta?.content ?? "";
        if (t) { text += t; yield t; }
        if ((evt as { model?: string }).model) model = (evt as { model: string }).model;
      }
    }
  }
  return { text, tokensIn, tokensOut, model };
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(llm): dual-protocol SSE streaming generator`

---

### Task 5: runner 核心(startRun/current/syncRunStatus)

**Files:**
- Create: `src/lib/domain/runner.ts`
- Test: `src/lib/domain/runner.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { startRun, getCurrentStep, syncRunStatus, RunError } from "./runner";
import { tasks, flowRuns, stepRuns, flowTemplates } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

let db: ReturnType<typeof createTestDb>;
let readyTaskId: string;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  readyTaskId = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "ready")!.id;
});

describe("startRun", () => {
  it("就绪任务 → 创建 run+全部 pending 步骤,任务转 running", () => {
    const { runId } = startRun(db, readyTaskId);
    const run = db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0];
    expect(run.status).toBe("running");
    expect(run.templateId).toBeTruthy();
    const steps = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all();
    expect(steps.length).toBe(2); // S 轻量通道 2 步
    expect(new Set(steps.map((s) => s.status))).toEqual(new Set(["pending"]));
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0]).status).toBe("running");
  });
  it("非就绪任务抛 RunError(409)", () => {
    const inbox = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "inbox")!;
    expect(() => startRun(db, inbox.id)).toThrow(RunError);
  });
  it("未绑定模板抛 RunError", () => {
    const t = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "inbox")!;
    db.update(tasks).set({ status: "ready", flowTemplateId: null }).where(eq(tasks.id, t.id)).run();
    expect(() => startRun(db, t.id)).toThrow(/未绑定流程模板/);
  });
});

describe("getCurrentStep/syncRunStatus", () => {
  it("当前步 = 第一个非 done/skipped 步骤", () => {
    const { runId } = startRun(db, readyTaskId);
    expect(getCurrentStep(db, runId)?.stepIndex).toBe(0);
    const s0 = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all().find((s) => s.stepIndex === 0)!;
    db.update(stepRuns).set({ status: "done" }).where(eq(stepRuns.id, s0.id)).run();
    expect(getCurrentStep(db, runId)?.stepIndex).toBe(1);
  });
  it("全 done → run done + 任务 review + 模板统计刷新", () => {
    const { runId } = startRun(db, readyTaskId);
    const tplId = (db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).templateId;
    const steps = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all();
    steps.forEach((s) => db.update(stepRuns).set({ status: "done", finishedAt: new Date().toISOString() }).where(eq(stepRuns.id, s.id)).run());
    syncRunStatus(db, runId);
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).status).toBe("done");
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0]).status).toBe("review");
    const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, tplId)).all()[0];
    expect(tpl.statRuns).toBe(1);
    expect(tpl.statSuccessRate).toBe(1);
  });
  it("当前步为 manual → run/task waiting_human", () => {
    const { runId } = startRun(db, readyTaskId);
    const s0 = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all().find((s) => s.stepIndex === 0)!;
    db.update(stepRuns).set({ status: "done" }).where(eq(stepRuns.id, s0.id)).run();
    // S 通道第 2 步是 checkpoint → waiting_human
    syncRunStatus(db, runId);
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).status).toBe("waiting_human");
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0]).status).toBe("waiting_human");
  });
});
```
(说明:runner 全部接收 `db` 参数,测试直接传 `createTestDb()` 结果,不经 `__setDbForTests`。)

- [ ] **Step 2:** FAIL。**Step 3: 实现** `src/lib/domain/runner.ts`

```ts
import { eq, asc } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { flowRuns, stepRuns, tasks, flowTemplates } from "@/lib/db/schema";
import { canTransition, type TaskStatus } from "@/lib/domain/status";
import { getStepDefs, type StepDef } from "@/lib/domain/step-def";
import { refreshTemplateStats } from "@/lib/domain/template-stats";

export class RunError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export const STEP_TERMINAL = ["done", "skipped"] as const;
export const WAITING_STEP = (s: { status: string; executorType: string }) =>
  s.status === "awaiting_confirmation" || s.status === "failed" ||
  (s.status === "pending" && (s.executorType === "manual" || s.executorType === "checkpoint"));

export function getRun(db: Db, runId: string) {
  return db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0] ?? null;
}
export function getStepDefsForRun(db: Db, runId: string): StepDef[] {
  const run = getRun(db, runId);
  if (!run) throw new RunError("run 不存在", 404);
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, run.templateId)).all()[0];
  return getStepDefs(tpl?.steps ?? "[]");
}
export function getSteps(db: Db, runId: string) {
  return db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).orderBy(asc(stepRuns.stepIndex)).all() as unknown as (typeof stepRuns.$inferSelect)[];
}
export function getCurrentStep(db: Db, runId: string) {
  return getSteps(db, runId).find((s) => !(STEP_TERMINAL as readonly string[]).includes(s.status)) ?? null;
}

export function startRun(db: Db, taskId: string): { runId: string } {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0];
  if (!task) throw new RunError("任务不存在", 404);
  if (task.status !== "ready") throw new RunError(`任务状态为 ${task.status},仅就绪任务可开始执行`);
  if (!task.flowTemplateId) throw new RunError("任务未绑定流程模板,请先在收件箱完成分诊确认");
  const tpl = db.select().from(flowTemplates).where(eq(flowTemplates.id, task.flowTemplateId)).all()[0];
  if (!tpl || tpl.status !== "active") throw new RunError("绑定的流程模板不存在或未激活");
  const steps = getStepDefs(tpl.steps);
  const nowIso = new Date().toISOString();
  const runId = crypto.randomUUID();
  db.transaction((tx) => {
    tx.insert(flowRuns).values({ id: runId, taskId, templateId: tpl.id, templateVersion: tpl.version, status: "running", startedAt: nowIso }).run();
    steps.forEach((s, i) => {
      tx.insert(stepRuns).values({ id: crypto.randomUUID(), runId, stepIndex: i, stepName: s.name, executorType: s.type, status: "pending", attempt: 1, rejected: 0 }).run();
    });
    tx.update(tasks).set({ status: "running", updatedAt: nowIso }).where(eq(tasks.id, taskId)).run();
  });
  return { runId };
}

export function syncRunStatus(db: Db, runId: string): void {
  const run = getRun(db, runId);
  if (!run || ["done", "failed", "canceled"].includes(run.status)) return;
  const nowIso = new Date().toISOString();
  const cur = getCurrentStep(db, runId);
  if (!cur) {
    const steps = getSteps(db, runId);
    const totalCost = steps.reduce((a, s) => a + s.costUsd, 0);
    const totalDuration = Date.now() - new Date(run.startedAt).getTime();
    db.update(flowRuns).set({ status: "done", finishedAt: nowIso, totalCostUsd: totalCost, totalDurationMs: totalDuration }).where(eq(flowRuns.id, runId)).run();
    const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0];
    if (task && canTransition(task.status as TaskStatus, "review")) {
      db.update(tasks).set({ status: "review", updatedAt: nowIso }).where(eq(tasks.id, task.id)).run();
    }
    refreshTemplateStats(db, run.templateId);
    return;
  }
  const runStatus = WAITING_STEP(cur) ? "waiting_human" : "running";
  if (run.status !== runStatus) db.update(flowRuns).set({ status: runStatus }).where(eq(flowRuns.id, runId)).run();
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0];
  if (task && task.status !== runStatus && canTransition(task.status as TaskStatus, runStatus as TaskStatus)) {
    db.update(tasks).set({ status: runStatus, updatedAt: nowIso }).where(eq(tasks.id, task.id)).run();
  }
}
```

同时创建 `src/lib/domain/template-stats.ts`(Task 7 亦复用,此处最小实现):
```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { flowRuns, flowTemplates } from "@/lib/db/schema";

export function refreshTemplateStats(db: Db, templateId: string): void {
  const runs = db.select().from(flowRuns).where(eq(flowRuns.templateId, templateId)).all() as (typeof flowRuns.$inferSelect)[];
  const finished = runs.filter((r) => r.status === "done" || r.status === "failed");
  const done = finished.filter((r) => r.status === "done");
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const sats = runs.map((r) => r.satisfaction).filter((s): s is number => s != null);
  db.update(flowTemplates).set({
    statRuns: runs.length,
    statSuccessRate: finished.length ? done.length / finished.length : 0,
    statAvgCostUsd: avg(done.map((r) => r.totalCostUsd)),
    statAvgDurationMs: Math.round(avg(done.map((r) => r.totalDurationMs))),
    statAvgSatisfaction: avg(sats),
    statLastUsedAt: runs.map((r) => r.startedAt).sort().at(-1) ?? null,
    updatedAt: new Date().toISOString(),
  }).where(eq(flowTemplates.id, templateId)).run();
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(domain): run lifecycle core (start/current-step/sync)`

---

### Task 6: runner 执行(llm 步执行 + 兜底链)

**Files:**
- Modify: `src/lib/domain/runner.ts`(追加)
- Test: `src/lib/domain/runner.test.ts`(追加)

- [ ] **Step 1: 追加失败测试**

```ts
import { runLlmStep, markStepFailed, retryStep, manualOverrideStep, skipStep } from "./runner";
import { vi } from "vitest";

describe("runLlmStep", () => {
  it("成功:渲染提示词、持久化产出与成本,状态 done", async () => {
    db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "产出OK" } }], usage: { prompt_tokens: 10, completion_tokens: 4 }, model: "m" }), { status: 200 }));
    const step = await runLlmStep(db, runId, 0, f as typeof fetch); // S 通道第 0 步 executorRole=executor
    expect(step.status).toBe("done");
    expect(step.output).toBe("产出OK");
    expect(step.tokensIn).toBe(10);
  });
  it("无可用执行器 → 步骤 failed 且错误可读", async () => {
    const { runId } = startRun(db, readyTaskId); // 种子执行器默认禁用
    const step = await runLlmStep(db, runId, 0, undefined as unknown as typeof fetch);
    expect(step.status).toBe("failed");
    expect(step.error).toContain("无可用");
  });
  it("LLM 失败 → 步骤 failed,run 转等待人工", async () => {
    db.update(executors).set({ enabled: true }).where(eq(executors.name, "快速模型")).run();
    db.update(executors).set({ role: "executor" }).where(eq(executors.name, "快速模型")).run();
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const step = await runLlmStep(db, runId, 0, f as typeof fetch);
    expect(step.status).toBe("failed");
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).status).toBe("waiting_human");
  });
});

describe("兜底动作", () => {
  beforeEach(() => {
    db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
  });
  it("retry:attempt+1 回 pending", async () => {
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const failed = await runLlmStep(db, runId, 0, f as typeof fetch);
    const step = retryStep(db, runId, failed.stepIndex);
    expect(step.attempt).toBe(2);
    expect(step.status).toBe("pending");
  });
  it("manual_override:人工产出直接 done", async () => {
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const failed = await runLlmStep(db, runId, 0, f as typeof fetch);
    const step = manualOverrideStep(db, runId, failed.stepIndex, "人工产出");
    expect(step.status).toBe("done");
    expect(step.output).toBe("人工产出");
    expect(step.feedbackNote).toBe("manual_override");
  });
  it("skip:仅 optional 步骤可跳过", async () => {
    const { runId } = startRun(db, readyTaskId); // S 通道第 0 步非 optional
    expect(() => skipStep(db, runId, 0)).toThrow(/optional/);
  });
});
```
(说明:`runLlmStep` 内部启用执行器依赖 seed;测试里第二个用例故意不启用,验证降级。每个用例前 `db = createTestDb(); seedIfEmpty(db);` 由外层 beforeEach 提供——将现有 `beforeEach` 提为文件级共享。)

- [ ] **Step 2:** FAIL。**Step 3: 实现**(追加到 runner.ts)

```ts
import { eq } from "drizzle-orm";
import { executorLlmConfig, callLlmWithRetry } from "@/lib/llm/client";
import { resolveStepExecutor, renderPrompt, type ResolvedExecutor } from "@/lib/domain/executor-resolve";
import { getStepDefs } from "@/lib/domain/step-def";

function setStep(db: Db, stepId: string, patch: Partial<typeof stepRuns.$inferInsert>) {
  db.update(stepRuns).set(patch).where(eq(stepRuns.id, stepId)).run();
  return db.select().from(stepRuns).where(eq(stepRuns.id, stepId)).all()[0] as unknown as (typeof stepRuns.$inferSelect & Record<string, unknown>);
}
function stepCost(ex: ResolvedExecutor, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1000) * ex.costPer1kInput + (tokensOut / 1000) * ex.costPer1kOutput;
}
function prevOutput(db: Db, runId: string, stepIndex: number): string {
  const prev = getSteps(db, runId).filter((s) => s.stepIndex < stepIndex).at(-1);
  return prev?.output ?? "";
}
function requireCurrent(db: Db, runId: string, stepIndex: number) {
  const cur = getCurrentStep(db, runId);
  if (!cur || cur.stepIndex !== stepIndex) throw new RunError("该步骤不是当前步骤", 409);
  return cur;
}

export async function runLlmStep(db: Db, runId: string, stepIndex: number, fetchImpl?: typeof fetch) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "llm" || cur.status !== "pending") throw new RunError("当前步骤不可执行 LLM");
  const run = getRun(db, runId)!;
  const def = getStepDefsForRun(db, runId)[stepIndex];
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0];
  const ex = resolveStepExecutor(db, def.executorRole ?? "executor");
  const nowIso = new Date().toISOString();
  if (!ex) {
    const s = setStep(db, cur.id, { status: "failed", error: `无可用的 ${def.executorRole ?? "executor"} 执行器,可在执行器页启用或改用人工填写`, startedAt: nowIso, finishedAt: nowIso });
    syncRunStatus(db, runId);
    return s;
  }
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) {
    const s = setStep(db, cur.id, { status: "failed", error: String(e), startedAt: nowIso, finishedAt: nowIso });
    syncRunStatus(db, runId);
    return s;
  }
  const prompt = renderPrompt(def.prompt ?? "", { task: { title: task.title, description: task.description }, prevOutput: prevOutput(db, runId, stepIndex) });
  setStep(db, cur.id, { status: "running", input: prompt, model: ex.model, startedAt: nowIso });
  const started = Date.now();
  try {
    const r = await callLlmWithRetry(cfg, [{ role: "user", content: prompt }], fetchImpl);
    const finishedAt = new Date().toISOString();
    const s = setStep(db, cur.id, {
      status: "done", output: r.text, model: r.model,
      tokensIn: r.tokensIn, tokensOut: r.tokensOut,
      costUsd: stepCost(ex, r.tokensIn, r.tokensOut),
      durationMs: Date.now() - started, finishedAt,
    });
    syncRunStatus(db, runId);
    return s;
  } catch (e) {
    const s = setStep(db, cur.id, { status: "failed", error: String(e).slice(0, 500), finishedAt: new Date().toISOString(), durationMs: Date.now() - started });
    syncRunStatus(db, runId);
    return s;
  }
}

export function retryStep(db: Db, runId: string, stepIndex: number) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.status !== "failed" || !["llm", "script"].includes(cur.executorType)) throw new RunError("仅失败的 llm/script 步骤可重试");
  const s = setStep(db, cur.id, { status: "pending", attempt: cur.attempt + 1, error: null });
  syncRunStatus(db, runId);
  return s;
}
export function manualOverrideStep(db: Db, runId: string, stepIndex: number, output: string) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.status !== "failed" && !(cur.executorType === "llm" && cur.status === "pending")) throw new RunError("该步骤不可人工接管");
  const s = setStep(db, cur.id, { status: "done", output, feedbackNote: "manual_override", finishedAt: new Date().toISOString() });
  syncRunStatus(db, runId);
  return s;
}
export function skipStep(db: Db, runId: string, stepIndex: number) {
  const run = getRun(db, runId)!;
  const def = getStepDefsForRun(db, runId)[stepIndex];
  const cur = requireCurrent(db, runId, stepIndex);
  if (!def.optional || cur.status !== "pending") throw new RunError("仅当前 pending 的 optional 步骤可跳过");
  const s = setStep(db, cur.id, { status: "skipped", finishedAt: new Date().toISOString() });
  syncRunStatus(db, runId);
  return s;
}
export function markStepFailed(db: Db, runId: string, stepIndex: number, error: string) {
  const cur = getCurrentStep(db, runId);
  const s = setStep(db, cur!.id, { status: "failed", error: error.slice(0, 500), finishedAt: new Date().toISOString() });
  syncRunStatus(db, runId);
  return s;
}
```
(注意 `markStepFailed` 供 script 路径复用;`getStepDefs` 从 executor-resolve 导入或直接从 step-def 导入——统一从 `@/lib/domain/step-def` 导入 `getStepDefs`。)

- [ ] **Step 4:** 全绿 → **Commit** `feat(domain): llm step execution with fallback chain`

---

### Task 7: runner 收尾(checkpoint + 完成反馈)

**Files:**
- Modify: `src/lib/domain/runner.ts`(追加 approveCheckpoint/rejectCheckpoint)
- Test: `src/lib/domain/runner.test.ts`(追加)

- [ ] **Step 1: 追加失败测试**

```ts
import { approveCheckpoint, rejectCheckpoint } from "./runner";

describe("checkpoint", () => {
  beforeEach(() => {
    db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
  });
  it("approve:通过后到末尾 → run done/task review(需先把 llm 步跑完)", async () => {
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {}, model: "m" }), { status: 200 }));
    await runLlmStep(db, runId, 0, f as typeof fetch);
    const cur = getCurrentStep(db, runId)!; // checkpoint(第 1 步)
    expect(cur.executorType).toBe("checkpoint");
    approveCheckpoint(db, runId, cur.stepIndex);
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).status).toBe("done");
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0]).status).toBe("review");
  });
  it("reject:checkpoint 标记 rejected,目标步骤回 pending", async () => {
    const { runId } = startRun(db, readyTaskId);
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {}, model: "m" }), { status: 200 }));
    await runLlmStep(db, runId, 0, f as typeof fetch);
    const cur = getCurrentStep(db, runId)!;
    rejectCheckpoint(db, runId, cur.stepIndex, "质量不行");
    const cp = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all().find((s) => s.stepIndex === cur.stepIndex)!;
    expect(cp.rejected).toBe(1);
    expect(cp.feedbackNote).toBe("质量不行");
    const target = db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all().find((s) => s.stepIndex === 0)!;
    expect(target.status).toBe("pending");
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现**

```ts
export function approveCheckpoint(db: Db, runId: string, stepIndex: number) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "checkpoint" || cur.status !== "pending") throw new RunError("当前步骤不是待审核 checkpoint");
  setStep(db, cur.id, { status: "done", finishedAt: new Date().toISOString() });
  syncRunStatus(db, runId);
}
export function rejectCheckpoint(db: Db, runId: string, stepIndex: number, note: string, targetIndex?: number) {
  const cur = requireCurrent(db, runId, stepIndex);
  if (cur.executorType !== "checkpoint" || cur.status !== "pending") throw new RunError("当前步骤不是待审核 checkpoint");
  setStep(db, cur.id, { rejected: cur.rejected + 1, feedbackNote: note.slice(0, 500) });
  const steps = getSteps(db, runId);
  const target = targetIndex != null
    ? steps.find((s) => s.stepIndex === targetIndex)
    : [...steps].reverse().find((s) => s.stepIndex < stepIndex && ["llm", "manual", "script"].includes(s.executorType));
  if (!target) throw new RunError("没有可打回的目标步骤");
  if (!(STEP_TERMINAL as readonly string[]).includes(target.status)) throw new RunError("目标步骤未完成,不可打回");
  setStep(db, target.id, { status: "pending" });
  syncRunStatus(db, runId);
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(domain): checkpoint approve/reject with rework target`

---

### Task 8: script-security(纯函数安全模型)

**Files:**
- Create: `src/lib/domain/script-security.ts`
- Test: `src/lib/domain/script-security.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { scanRisk, isPathWithin, checkWhitelist, confirmRequired, DEFAULT_WHITELIST } from "./script-security";
import path from "node:path";

describe("scanRisk", () => {
  it("命中破坏性模式", () => {
    expect(scanRisk("Remove-Item C:\\x -Recurse -Force").length).toBeGreaterThan(0);
    expect(scanRisk("rm -rf /").length).toBeGreaterThan(0);
    expect(scanRisk("del /s C:\\x").length).toBeGreaterThan(0);
    expect(scanRisk("shutdown /s").length).toBeGreaterThan(0);
  });
  it("普通命令零命中", () => {
    expect(scanRisk("Get-ChildItem .")).toHaveLength(0);
    expect(scanRisk("echo hello")).toHaveLength(0);
  });
});

describe("isPathWithin/checkWhitelist", () => {
  const root = path.resolve("data/sandbox");
  it("子目录与自身在内,穿越拒绝", () => {
    expect(isPathWithin(path.join(root, "sub"), root)).toBe(true);
    expect(isPathWithin(root, root)).toBe(true);
    expect(isPathWithin(path.resolve(root, ".."), root)).toBe(false);
  });
  it("checkWhitelist:默认白名单含 data/sandbox", () => {
    expect(checkWhitelist(root, DEFAULT_WHITELIST)).toBe(true);
    expect(checkWhitelist(path.resolve("C:\\Windows"), DEFAULT_WHITELIST)).toBe(false);
  });
});

describe("confirmRequired", () => {
  it("静态命令 + autoApprove → 免确认;含渲染变量或未开自动批准 → 需确认", () => {
    expect(confirmRequired({ command: "echo hi" }, { autoApprove: true })).toBe(false);
    expect(confirmRequired({ command: "echo {{prev_output}}" }, { autoApprove: true })).toBe(true);
    expect(confirmRequired({ command: "echo hi" }, { autoApprove: false })).toBe(true);
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现**

```ts
// src/lib/domain/script-security.ts
import path from "node:path";

export const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdel\s+\/[sq]/i, /\brd\s+\/s/i, /\brmdir\s+\/s/i, /\brm\s+(-[rf]|--recursive)/i,
  /\bformat\b/i, /remove-item\s+.*-recurse\s+.*-force/i, /\breg\s+delete\b/i,
  /\bshutdown\b/i, /\bmkfs\b/i, /\bdiskpart\b/i, /\bbcdedit\b/i,
];
export function scanRisk(command: string): string[] {
  return DESTRUCTIVE_PATTERNS.filter((re) => re.test(command)).map((re) => re.source);
}
export const DEFAULT_WHITELIST = [path.join(process.cwd(), "data", "sandbox")];
export function isPathWithin(child: string, parent: string): boolean {
  const c = path.resolve(child).toLowerCase();
  const p = path.resolve(parent).toLowerCase();
  return c === p || c.startsWith(p + path.sep);
}
export function checkWhitelist(workingDir: string, whitelist: string[]): boolean {
  return whitelist.some((dir) => isPathWithin(workingDir, path.resolve(dir)));
}
export function confirmRequired(stepDef: { command?: string }, executor: { autoApprove: boolean }): boolean {
  const dynamic = /\{\{/.test(stepDef.command ?? "");
  return !executor.autoApprove || dynamic;
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(domain): script security model (risk scan, whitelist, confirm gate)`

---

### Task 9: script-runner(spawn 执行)

**Files:**
- Create: `src/lib/domain/script-runner.ts`
- Test: `src/lib/domain/script-runner.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { shellCommand, executeScript } from "./script-runner";
import path from "node:path";
import fs from "node:fs";

const cwd = path.join(process.cwd(), "data", "sandbox");
beforeAll(() => fs.mkdirSync(cwd, { recursive: true }));

describe("shellCommand", () => {
  it("四种 shell 映射", () => {
    expect(shellCommand("powershell", "x")).toEqual({ file: "powershell", args: ["-NoProfile", "-Command", "x"] });
    expect(shellCommand("cmd", "x")).toEqual({ file: "cmd", args: ["/c", "x"] });
    expect(shellCommand("bash", "x")).toEqual({ file: "bash", args: ["-c", "x"] });
    expect(shellCommand("python", "x")).toEqual({ file: "python", args: ["-c", "x"] });
  });
});

describe("executeScript", () => {
  it("powershell echo 成功并捕获输出", async () => {
    const r = await executeScript("powershell", "Write-Output hello-evodesk", { cwd, timeoutMs: 15000 });
    expect(r.exitCode).toBe(0);
    expect(r.output).toContain("hello-evodesk");
    expect(r.timedOut).toBe(false);
  });
  it("非零退出 → exitCode 记录", async () => {
    const r = await executeScript("powershell", "exit 3", { cwd, timeoutMs: 15000 });
    expect(r.exitCode).toBe(3);
  });
  it("超时终止并标记 timedOut", async () => {
    const r = await executeScript("powershell", "Start-Sleep -Seconds 30", { cwd, timeoutMs: 1500 });
    expect(r.timedOut).toBe(true);
  }, 20000);
  it("未知 shell 命令 → error 路径,exitCode null", async () => {
    const r = await executeScript("powershell", "definitely-not-a-real-command-xyz", { cwd, timeoutMs: 15000 });
    expect(r.exitCode).not.toBe(0);
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现**

```ts
// src/lib/domain/script-runner.ts
import { spawn } from "node:child_process";

export function shellCommand(shell: string, command: string): { file: string; args: string[] } {
  switch (shell) {
    case "cmd": return { file: "cmd", args: ["/c", command] };
    case "bash": return { file: "bash", args: ["-c", command] };
    case "python": return { file: "python", args: ["-c", command] };
    default: return { file: "powershell", args: ["-NoProfile", "-Command", command] };
  }
}

export interface ScriptResult { output: string; exitCode: number | null; durationMs: number; timedOut: boolean }

export function executeScript(shell: string, command: string, opts: { cwd: string; timeoutMs: number }): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    const { file, args } = shellCommand(shell, command);
    const child = spawn(file, args, { cwd: opts.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let timedOut = false;
    child.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { out += d.toString(); });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, opts.timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ output: (out + "\n" + e.message).slice(0, 65_536), exitCode: null, durationMs: Date.now() - started, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ output: out.slice(0, 65_536), exitCode: code, durationMs: Date.now() - started, timedOut });
    });
  });
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(domain): script runner with timeout and output capture`

---

### Task 10: 执行 API(start / GET run / advance / feedback)

**Files:**
- Create: `src/app/api/tasks/[id]/start/route.ts`、`src/app/api/runs/[id]/route.ts`、`src/app/api/runs/[id]/steps/[n]/advance/route.ts`、`src/app/api/runs/[id]/feedback/route.ts`
- Test: `src/app/api/runs/route.test.ts`(集中放集成测试)

- [ ] **Step 1: 失败测试** `src/app/api/runs/route.test.ts`

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors, tasks, stepRuns, flowRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST as START } from "@/app/api/tasks/[id]/start/route";
import { GET as GET_RUN } from "@/app/api/runs/[id]/route";
import { POST as ADVANCE } from "@/app/api/runs/[id]/steps/[n]/advance/route";
import { POST as FEEDBACK } from "@/app/api/runs/[id]/feedback/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
let readyTaskId: string;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  readyTaskId = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "ready")!.id;
});

async function startRun(): Promise<string> {
  db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
  const res = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
  return (await res.json()).runId as string;
}

describe("start/GET/advance/feedback", () => {
  it("start:创建 run(201);非就绪 409", async () => {
    const res = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
    expect(res.status).toBe(201);
    const runId = (await res.json()).runId;
    const again = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
    expect(again.status).toBe(409);
    expect(runId).toBeTruthy();
  });
  it("GET run:返回 run+steps+currentStepIndex", async () => {
    const runId = await startRun();
    const res = await GET_RUN(req(`/api/runs/${runId}`), { params: Promise.resolve({ id: runId }) });
    const data = await res.json();
    expect(data.run.id).toBe(runId);
    expect(data.steps.length).toBe(2);
    expect(data.currentStepIndex).toBe(0);
  });
  it("advance execute(llm)→ 状态仍 pending + 返回 stream 路径(stream 路由开始执行时才置 running,天然避免并发双流)", async () => {
    const runId = await startRun();
    const res = await ADVANCE(req(`/api/runs/${runId}/steps/0/advance`, { method: "POST", body: JSON.stringify({ action: "execute" }) }), { params: Promise.resolve({ id: runId, n: "0" }) });
    const data = await res.json();
    expect(data.step.status).toBe("pending");
    expect(data.stream).toContain("/stream");
  });
  it("advance 对非当前步骤 409", async () => {
    const runId = await startRun();
    const res = await ADVANCE(req(`/api/runs/${runId}/steps/1/advance`, { method: "POST", body: JSON.stringify({ action: "approve" }) }), { params: Promise.resolve({ id: runId, n: "1" }) });
    expect(res.status).toBe(409);
  });
  it("全流程:execute→(模拟产出)→approve→run done→feedback→task done", async () => {
    const runId = await startRun();
    await ADVANCE(req(`/api/runs/${runId}/steps/0/advance`, { method: "POST", body: JSON.stringify({ action: "execute" }) }), { params: Promise.resolve({ id: runId, n: "0" }) });
    // 模拟 stream 完成后的落库(stream 路由的持久化 UPDATE 与此一致);approve 内部会再次 syncRunStatus
    const s0 = (db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all() as (typeof stepRuns.$inferSelect)[]).find((s) => s.stepIndex === 0)!;
    db.update(stepRuns).set({ status: "done", output: "ok", tokensIn: 5, tokensOut: 2, costUsd: 0.01, durationMs: 100, finishedAt: new Date().toISOString() }).where(eq(stepRuns.id, s0.id)).run();
    const resA = await ADVANCE(req(`/api/runs/${runId}/steps/1/advance`, { method: "POST", body: JSON.stringify({ action: "approve" }) }), { params: Promise.resolve({ id: runId, n: "1" }) });
    expect(resA.status).toBe(200); // approve 要求 current —— 当前是第 1 步(checkpoint)
    const runRow = (db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]);
    expect(runRow.status).toBe("done");
    const taskRow = (db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0]);
    expect(taskRow.status).toBe("review");
    const fb = await FEEDBACK(req(`/api/runs/${runId}/feedback`, { method: "POST", body: JSON.stringify({ satisfaction: 5, outcome_note: "很棒" }) }), { params: Promise.resolve({ id: runId }) });
    expect(fb.status).toBe(200);
    expect((db.select().from(tasks).where(eq(tasks.id, readyTaskId)).all()[0]).status).toBe("done");
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现 4 个路由**

`src/app/api/tasks/[id]/start/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { startRun, RunError } from "@/lib/domain/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { runId } = startRun(getDb(), id);
    return NextResponse.json({ runId }, { status: 201 });
  } catch (e) {
    if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

`src/app/api/runs/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { getRun, getSteps, getCurrentStep, getStepDefsForRun, syncRunStatus, RunError } from "@/lib/domain/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    syncRunStatus(db, id);
    const run = getRun(db, id);
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    const steps = getSteps(db, id);
    const cur = getCurrentStep(db, id);
    return NextResponse.json({ run, steps, currentStepIndex: cur?.stepIndex ?? null, stepDefs: getStepDefsForRun(db, id) });
  } catch (e) {
    if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```

`src/app/api/runs/[id]/steps/[n]/advance/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import path from "node:path";
import { getDb } from "@/lib/db/client";
import { settings, stepRuns as stepRunsTable, tasks as tasksTable, executors as executorsTable } from "@/lib/db/schema";
import { getRun, getSteps, getStepDefsForRun, syncRunStatus, RunError, getCurrentStep } from "@/lib/domain/runner";
import { renderPrompt } from "@/lib/domain/executor-resolve";
import { scanRisk, checkWhitelist, DEFAULT_WHITELIST, confirmRequired } from "@/lib/domain/script-security";
import { executeScript } from "@/lib/domain/script-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function setStep(db: ReturnType<typeof getDb>, stepId: string, patch: Record<string, unknown>) {
  db.update(stepRunsTable).set(patch).where(eq(stepRunsTable.id, stepId)).run();
  return db.select().from(stepRunsTable).where(eq(stepRunsTable.id, stepId)).all()[0];
}

function readWhitelist(db: ReturnType<typeof getDb>): string[] {
  const row = db.select().from(settings).where(eq(settings.key, "whitelist_dirs")).all()[0];
  if (!row) return DEFAULT_WHITELIST;
  try { const v = JSON.parse(row.value); return Array.isArray(v) ? v : DEFAULT_WHITELIST; } catch { return DEFAULT_WHITELIST; }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  try {
    const { id: runId, n } = await params;
    const stepIndex = Number(n);
    const db = getDb();
    const run = getRun(db, runId);
    if (!run) return NextResponse.json({ error: "run 不存在" }, { status: 404 });
    const cur = getCurrentStep(db, runId);
    if (!cur || cur.stepIndex !== stepIndex) return NextResponse.json({ error: "该步骤不是当前步骤" }, { status: 409 });
    const raw = await req.json().catch(() => null);
    const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const action = body.action as string;
    const steps = getSteps(db, runId);
    const step = steps[stepIndex];
    const def = getStepDefsForRun(db, runId)[stepIndex];
    const set = (patch: Record<string, unknown>) => setStep(db, step.id, patch);
    const respond = () => {
      syncRunStatus(db, runId);
      const s = getSteps(db, runId)[stepIndex];
      return NextResponse.json({ step: s, run: getRun(db, runId) });
    };

    if (step.executorType === "llm") {
      if (action === "execute" && step.status === "pending") {
        // 不在此处置 running:stream 路由开始执行时同步置 running,天然避免并发双流
        return NextResponse.json({ step, run: getRun(db, runId), stream: `/api/runs/${runId}/steps/${stepIndex}/stream` });
      }
      if (action === "manual_override" && (step.status === "failed" || step.status === "pending")) {
        set({ status: "done", output: String(body.output ?? ""), feedbackNote: "manual_override", finishedAt: new Date().toISOString() });
        return respond();
      }
      if (action === "retry" && step.status === "failed") {
        set({ status: "pending", attempt: step.attempt + 1, error: null });
        return respond();
      }
    }
    if (step.executorType === "manual" && action === "submit" && step.status === "pending") {
      set({ status: "done", output: String(body.output ?? ""), finishedAt: new Date().toISOString() });
      return respond();
    }
    if (step.executorType === "checkpoint") {
      if (action === "approve" && step.status === "pending") {
        set({ status: "done", finishedAt: new Date().toISOString() });
        return respond();
      }
      if (action === "reject" && step.status === "pending") {
        const targetIndex = typeof body.target_index === "number" ? body.target_index : null;
        const target = targetIndex != null ? steps[targetIndex] : [...steps].reverse().find((s) => s.stepIndex < stepIndex && ["llm", "manual", "script"].includes(s.executorType));
        if (!target || !["done", "skipped"].includes(target.status)) return NextResponse.json({ error: "没有可打回的目标步骤" }, { status: 409 });
        set({ rejected: step.rejected + 1, feedbackNote: String(body.note ?? "").slice(0, 500) });
        setStep(db, target.id, { status: "pending" });
        return respond();
      }
    }
    if (step.executorType === "script") {
      const exOf = (id: string | undefined) => (id ? db.select().from(executorsTable).where(eq(executorsTable.id, id)).all()[0] ?? null : null);
      if (action === "execute" && step.status === "pending") {
        const ex = exOf(def.executor_id);
        if (!ex || ex.type !== "script" || !ex.enabled) return NextResponse.json({ error: "script 执行器不存在或未启用" }, { status: 409 });
        const task = db.select().from(tasksTable).where(eq(tasksTable.id, run.taskId)).all()[0];
        const prev = [...steps].reverse().find((s) => s.stepIndex < stepIndex);
        const command = renderPrompt(def.command ?? "", { task: { title: task.title, description: task.description }, prevOutput: prev?.output ?? "" });
        const whitelist = readWhitelist(db);
        const workingDir = ex.workingDir ? path.resolve(ex.workingDir) : path.resolve("data", "sandbox");
        if (!checkWhitelist(workingDir, whitelist)) return NextResponse.json({ error: `工作目录不在白名单:${workingDir}` }, { status: 409 });
        const risks = scanRisk(command);
        const needsConfirm = confirmRequired(def, ex);
        set({ status: needsConfirm ? "awaiting_confirmation" : "running", input: command, startedAt: new Date().toISOString() });
        syncRunStatus(db, runId);
        if (needsConfirm) {
          return NextResponse.json({ step: getSteps(db, runId)[stepIndex], command, risks, awaiting: true });
        }
        const r = await executeScript(ex.shell ?? "powershell", command, { cwd: workingDir, timeoutMs: ex.timeoutMs });
        const ok = !r.timedOut && r.exitCode === 0;
        set({ status: ok ? "done" : "failed", output: r.output, error: ok ? null : (r.timedOut ? `执行超时(${ex.timeoutMs}ms)` : `退出码 ${r.exitCode}`), durationMs: r.durationMs, finishedAt: new Date().toISOString() });
        return respond();
      }
      if (action === "confirm" && step.status === "awaiting_confirmation") {
        const ex = exOf(def.executor_id);
        if (!ex || ex.type !== "script") return NextResponse.json({ error: "script 执行器不存在" }, { status: 409 });
        const command = step.input ?? "";
        set({ status: "running" });
        const workingDir = ex.workingDir ? path.resolve(ex.workingDir) : path.resolve("data", "sandbox");
        const r = await executeScript(ex.shell ?? "powershell", command, { cwd: workingDir, timeoutMs: ex.timeoutMs });
        const ok = !r.timedOut && r.exitCode === 0;
        set({ status: ok ? "done" : "failed", output: r.output, error: ok ? null : (r.timedOut ? `执行超时(${ex.timeoutMs}ms)` : `退出码 ${r.exitCode}`), durationMs: r.durationMs, finishedAt: new Date().toISOString() });
        return respond();
      }
      if (action === "retry" && step.status === "failed") { set({ status: "pending", attempt: step.attempt + 1, error: null }); return respond(); }
      if (action === "manual_override" && step.status === "failed") { set({ status: "done", output: String(body.output ?? ""), feedbackNote: "manual_override", finishedAt: new Date().toISOString() }); return respond(); }
    }
    if (action === "skip" && step.status === "pending") {
      if (!def.optional) return NextResponse.json({ error: "仅 optional 步骤可跳过" }, { status: 409 });
      set({ status: "skipped", finishedAt: new Date().toISOString() });
      return respond();
    }
    return NextResponse.json({ error: `非法动作 ${action}` }, { status: 400 });
  } catch (e) {
    if (e instanceof RunError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
```
`src/app/api/runs/[id]/feedback/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { flowRuns, tasks } from "@/lib/db/schema";
import { refreshTemplateStats } from "@/lib/domain/template-stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const run = db.select().from(flowRuns).where(eq(flowRuns.id, id)).all()[0];
  if (!run) return NextResponse.json({ error: "run 不存在" }, { status: 404 });
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const satisfaction = Number(body.satisfaction);
  if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
    return NextResponse.json({ error: "satisfaction 需要 1-5 整数" }, { status: 400 });
  }
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0];
  if (!task || task.status !== "review") return NextResponse.json({ error: "任务不在评审状态" }, { status: 409 });
  db.update(flowRuns).set({ satisfaction, outcomeNote: typeof body.outcome_note === "string" ? body.outcome_note : null }).where(eq(flowRuns.id, id)).run();
  db.update(tasks).set({ status: "done", outcomeNote: typeof body.outcome_note === "string" ? body.outcome_note : null, updatedAt: new Date().toISOString() }).where(eq(tasks.id, task.id)).run();
  refreshTemplateStats(db, run.templateId);
  return NextResponse.json({ run: db.select().from(flowRuns).where(eq(flowRuns.id, id)).all()[0], task: db.select().from(tasks).where(eq(tasks.id, task.id)).all()[0] });
}
```
(canTransition 导入若未使用则删除——此处直接校验 review 状态。)

- [ ] **Step 4:** 全绿 → **Commit** `feat(api): run lifecycle endpoints (start/get/advance/feedback)`

---

### Task 11: SSE stream 路由(单步执行)

**Files:**
- Create: `src/app/api/runs/[id]/steps/[n]/stream/route.ts`
- Test: `src/app/api/runs/[id]/steps/stream.test.ts`

- [ ] **Step 1: 失败测试**(流式端点测试:消费 ReadableStream 断言 SSE 事件)

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors, tasks, stepRuns, flowRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GET as STREAM } from "@/app/api/runs/[id]/steps/[n]/stream/route";
import { POST as START } from "@/app/api/tasks/[id]/start/route";
import { POST as ADVANCE } from "@/app/api/runs/[id]/steps/[n]/advance/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
let readyTaskId: string;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  readyTaskId = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[]).find((t) => t.status === "ready")!.id;
  db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
});

async function startAndExecute(): Promise<{ runId: string }> {
  const res = await START(req(`/api/tasks/${readyTaskId}/start`, { method: "POST" }), { params: Promise.resolve({ id: readyTaskId }) });
  const runId = (await res.json()).runId as string;
  await ADVANCE(req(`/api/runs/${runId}/steps/0/advance`, { method: "POST", body: JSON.stringify({ action: "execute" }) }), { params: Promise.resolve({ id: runId, n: "0" }) });
  return { runId };
}

describe("GET stream", () => {
  it("SSE:delta 事件 + done 事件,步骤落库 done", async () => {
    const { runId } = await startAndExecute();
    const f = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"你"}}]}\n\n'));
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"好"}}]}\n\n'));
          c.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2}}\n\n'));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", f);
    const res = await STREAM(req(`/api/runs/${runId}/steps/0/stream`), { params: Promise.resolve({ id: runId, n: "0" }) });
    vi.unstubAllGlobals();
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"delta":"你"');
    expect(text).toContain('"done":true');
    const s0 = (db.select().from(stepRuns).where(eq(stepRuns.runId, runId)).all() as (typeof stepRuns.$inferSelect)[]).find((s) => s.stepIndex === 0)!;
    expect(s0.status).toBe("done");
    expect(s0.output).toBe("你好");
    expect((db.select().from(flowRuns).where(eq(flowRuns.id, runId)).all()[0]).totalCostUsd).toBeGreaterThan(0);
  });
  it("非当前步骤 409", async () => {
    const { runId } = await startAndExecute();
    const res = await STREAM(req(`/api/runs/${runId}/steps/1/stream`), { params: Promise.resolve({ id: runId, n: "1" }) });
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现**

```ts
// src/app/api/runs/[id]/steps/[n]/stream/route.ts
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks as tasksTable } from "@/lib/db/schema";
import { getRun, getSteps, getStepDefsForRun, getCurrentStep, syncRunStatus } from "@/lib/domain/runner";
import { resolveStepExecutor, renderPrompt } from "@/lib/domain/executor-resolve";
import { executorLlmConfig } from "@/lib/llm/client";
import { streamLlm } from "@/lib/llm/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; n: string }> }) {
  const { id: runId, n } = await params;
  const stepIndex = Number(n);
  const db = getDb();
  const run = getRun(db, runId);
  const cur = getCurrentStep(db, runId);
  const encoder = new TextEncoder();
  const fail = (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), { status, headers: { "content-type": "application/json" } });
  if (!run) return fail("run 不存在", 404);
  if (!cur || cur.stepIndex !== stepIndex) return fail("该步骤不是当前步骤", 409);
  if (cur.executorType !== "llm") return fail("仅 llm 步骤支持流式执行", 409);
  if (cur.status === "running") return fail("该步骤正在执行", 409);
  if (cur.status !== "pending") return fail(`步骤状态 ${cur.status} 不可执行`, 409);

  const step = getSteps(db, runId)[stepIndex];
  const def = getStepDefsForRun(db, runId)[stepIndex];
  const task = db.select().from(tasksTable).where(eq(tasksTable.id, run.taskId)).all()[0];
  const ex = resolveStepExecutor(db, def.executorRole ?? "executor");
  if (!ex) {
    db.update(stepRunsTable).set({ status: "failed", error: `无可用的 ${def.executorRole ?? "executor"} 执行器`, finishedAt: new Date().toISOString() }).where(eq(stepRunsTable.id, step.id)).run();
    syncRunStatus(db, runId);
    return fail(`无可用的 ${def.executorRole ?? "executor"} 执行器`, 409);
  }
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) {
    db.update(stepRunsTable).set({ status: "failed", error: String(e), finishedAt: new Date().toISOString() }).where(eq(stepRunsTable.id, step.id)).run();
    syncRunStatus(db, runId);
    return fail(String(e), 409);
  }
  const prev = getSteps(db, runId).filter((s) => s.stepIndex < stepIndex).at(-1);
  const prompt = renderPrompt(def.prompt ?? "", { task: { title: task.title, description: task.description }, prevOutput: prev?.output ?? "" });
  db.update(stepRunsTable).set({ status: "running", input: prompt, model: ex.model, startedAt: new Date().toISOString() }).where(eq(stepRunsTable.id, step.id)).run();
  syncRunStatus(db, runId);

  const started = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const it = streamLlm(cfg, [{ role: "user", content: prompt }]);
        for (;;) {
          const r = await it.next();
          if (r.done) {
            const finishedAt = new Date().toISOString();
            db.update(stepRunsTable).set({
              status: "done", output: r.value.text, model: r.value.model,
              tokensIn: r.value.tokensIn, tokensOut: r.value.tokensOut,
              costUsd: (r.value.tokensIn / 1000) * ex.costPer1kInput + (r.value.tokensOut / 1000) * ex.costPer1kOutput,
              durationMs: Date.now() - started, finishedAt,
            }).where(eq(stepRunsTable.id, step.id)).run();
            syncRunStatus(db, runId);
            const runRow = getRun(db, runId)!;
            send({ done: true, step: getSteps(db, runId)[stepIndex], run: runRow });
            break;
          }
          send({ delta: r.value });
        }
      } catch (e) {
        db.update(stepRunsTable).set({ status: "failed", error: String(e).slice(0, 500), finishedAt: new Date().toISOString(), durationMs: Date.now() - started }).where(eq(stepRunsTable.id, step.id)).run();
        syncRunStatus(db, runId);
        send({ done: true, error: String(e).slice(0, 300), step: getSteps(db, runId)[stepIndex] });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(api): SSE single-step llm execution with persistence`

---

### Task 12: 执行视图 /tasks/[id]

**Files:**
- Create: `src/app/tasks/[id]/page.tsx`、`src/components/RunView.tsx`
- Modify: `src/components/TaskCard.tsx`(ready/running/waiting_human/review 深链执行视图)

- [ ] **Step 1: TaskCard 链接改为状态感知**

```tsx
const detailHref = ["inbox", "triaging"].includes(task.status)
  ? "/inbox"
  : ["ready", "running", "waiting_human", "review"].includes(task.status)
    ? `/tasks/${task.id}`
    : `/tasks#task-${task.id}`;
// <Link href={detailHref} …>
```

- [ ] **Step 2: 服务端页** `src/app/tasks/[id]/page.tsx`

```tsx
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks, flowRuns, flowTemplates, stepRuns } from "@/lib/db/schema";
import { RunView } from "@/components/RunView";

export const dynamic = "force-dynamic";

export default async function TaskRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
  if (!task) notFound();
  const run = db.select().from(flowRuns).where(eq(flowRuns.taskId, id)).all()[0] ?? null;
  const steps = run ? (db.select().from(stepRuns).where(eq(stepRuns.runId, run.id)).orderBy(stepRuns.stepIndex).all() as (typeof stepRuns.$inferSelect)[]) : [];
  const template = run ? db.select().from(flowTemplates).where(eq(flowTemplates.id, run.templateId)).all()[0] ?? null : null;

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-1">{task.title}</h1>
      <div className="text-xs mb-4" style={{ color: "var(--muted)" }}>
        {task.status} · {task.complexity} {task.flowTemplateId ? "· 已绑定流程" : ""}
      </div>
      {task.description && <div className="surface p-3 text-sm mb-4 whitespace-pre-wrap">{task.description}</div>}
      {run ? (
        <RunView
          taskId={task.id}
          taskStatus={task.status}
          run={{ ...run }}
          steps={[...steps]}
          stepDefs={template ? (JSON.parse(template.steps) as { name: string; type: string; instruction?: string; command?: string; optional?: boolean }[]) : []}
        />
      ) : (
        <StartButton taskId={task.id} disabled={task.status !== "ready"} />
      )}
    </div>
  );
}

function StartButton({ taskId, disabled }: { taskId: string; disabled: boolean }) {
  return (
    <form action={`/api/tasks/${taskId}/start`} method="post" className="flex gap-2">
      <button
        type="submit"
        disabled={disabled}
        className="accent-btn px-4 py-2 text-sm disabled:opacity-40"
        onClick={(e) => {
          if (disabled) { e.preventDefault(); return; }
          e.preventDefault();
          fetch(`/api/tasks/${taskId}/start`, { method: "POST" }).then(() => window.location.reload());
        }}
      >
        开始执行
      </button>
      {disabled && <span className="text-xs self-center" style={{ color: "var(--muted)" }}>仅就绪任务可开始</span>}
    </form>
  );
}
```

- [ ] **Step 3: RunView 客户端组件** `src/components/RunView.tsx`(核心:时间线 + 当前步面板 + SSE 消费 + 自动串行 + 评分)

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { flowRuns, stepRuns } from "@/lib/db/schema";

type Run = typeof flowRuns.$inferSelect;
type Step = typeof stepRuns.$inferSelect;

const STEP_ICON: Record<string, string> = { llm: "🤖", manual: "✍️", checkpoint: "✅", script: "⚙️" };
const STATUS_LABEL: Record<string, string> = {
  pending: "待执行", awaiting_confirmation: "待确认", running: "执行中", done: "完成", skipped: "已跳过", failed: "失败",
};

export function RunView({ taskId, taskStatus, run, steps, stepDefs }: {
  taskId: string; taskStatus: string; run: Run; steps: Step[];
  stepDefs: { name: string; type: string; instruction?: string; command?: string; optional?: boolean }[];
}) {
  const router = useRouter();
  const current = steps.find((s) => !["done", "skipped"].includes(s.status)) ?? null;
  const streamingRef = useRef(false);
  const [streamText, setStreamText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [satisfaction, setSatisfaction] = useState(5);
  const [outcome, setOutcome] = useState("");

  const advance = useCallback(async (body: Record<string, unknown>, idx: number) => {
    const res = await fetch(`/api/runs/${run.id}/steps/${idx}/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.step) { setNote(data?.error ?? "操作失败,请重试"); return null; }
    router.refresh();
    return data;
  }, [run.id, router]);

  // llm 当前步自动执行 + SSE 消费(done 后 refresh,下一个 llm 步骤由 effect 接力)
  useEffect(() => {
    if (!current || streamingRef.current) return;
    if (current.executorType !== "llm" || current.status !== "pending") return;
    streamingRef.current = true;
    setStreamText("");
    (async () => {
      const started = await advance({ action: "execute" }, current.stepIndex);
      if (!started) { streamingRef.current = false; return; }
      const es = new EventSource(`/api/runs/${run.id}/steps/${current.stepIndex}/stream`);
      es.onmessage = (ev) => {
        const evt = JSON.parse(ev.data);
        if (evt.delta) setStreamText((t) => t + evt.delta);
        if (evt.done) {
          es.close();
          streamingRef.current = false;
          if (evt.error) setNote(`执行失败:${evt.error}`);
          router.refresh();
        }
      };
      es.onerror = () => { es.close(); streamingRef.current = false; setNote("连接中断,请重试"); };
    })();
  }, [current, advance, run.id, router]);

  const act = async (body: Record<string, unknown>) => {
    if (!current) return;
    await advance(body, current.stepIndex);
    setInput(""); setRejectNote("");
  };
  const optionalFlags = (idx: number) => stepDefs[idx]?.optional ?? false;

  if (taskStatus === "review") {
    return (
      <div className="surface p-4">
        <div className="font-semibold mb-2">执行完成,请评审</div>
        <div className="flex items-center gap-2 mb-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} onClick={() => setSatisfaction(n)} className="text-lg" style={{ filter: n <= satisfaction ? "none" : "grayscale(1)" }}>⭐</button>
          ))}
        </div>
        <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={2} placeholder="结果备注(可选)" value={outcome} onChange={(e) => setOutcome(e.target.value)} />
        <button
          className="accent-btn px-4 py-2 text-sm"
          onClick={async () => {
            const res = await fetch(`/api/runs/${run.id}/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ satisfaction, outcome_note: outcome }) });
            if (res.ok) router.refresh(); else setNote("提交失败,请重试");
          }}
        >提交评审,完成任务</button>
        {note && <div className="text-xs mt-2" style={{ color: "var(--danger)" }}>{note}</div>}
      </div>
    );
  }

  return (
    <div className="grid md:grid-cols-[240px_1fr] gap-4">
      <div className="space-y-1">
        {steps.map((s) => (
          <div key={s.id} className={`surface p-2 text-sm ${current?.id === s.id ? "ring-1" : ""}`}
            style={current?.id === s.id ? { borderColor: "var(--accent)" } : { opacity: ["done", "skipped"].includes(s.status) ? 0.6 : 1 }}>
            <div className="flex items-center gap-2">
              <span>{STEP_ICON[s.executorType]}</span>
              <span className="flex-1">{s.stepName}</span>
              <span className="text-xs" style={{ color: s.status === "failed" ? "var(--danger)" : "var(--muted)" }}>{STATUS_LABEL[s.status]}</span>
            </div>
            {s.rejected > 0 && <div className="text-xs mt-1" style={{ color: "var(--warn)" }}>被退回 {s.rejected} 次</div>}
          </div>
        ))}
        <CancelRunButton runId={run.id} />
      </div>
      <div className="surface p-4 min-h-40">
        {!current && <div className="text-sm" style={{ color: "var(--muted)" }}>所有步骤已完成。</div>}
        {current && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span>{STEP_ICON[current.executorType]}</span>
              <span className="font-medium">{current.stepName}</span>
              <span className="text-xs" style={{ color: "var(--muted)" }}>{STATUS_LABEL[current.status]}{current.attempt > 1 ? ` · 第 ${current.attempt} 次` : ""}</span>
            </div>
            {current.executorType === "llm" && (
              <pre className="text-sm whitespace-pre-wrap max-h-80 overflow-auto p-2 rounded" style={{ background: "var(--surface-2)" }}>
                {current.output || streamText || (current.status === "pending" ? "即将开始…" : "")}
              </pre>
            )}
            {current.executorType === "llm" && current.status === "failed" && (
              <div className="text-xs mb-2" style={{ color: "var(--danger)" }}>{current.error}</div>
            )}
            {current.executorType === "llm" && ["failed", "pending"].includes(current.status) && (
              <div className="flex flex-wrap gap-2">
                {current.status === "failed" && <button onClick={() => act({ action: "retry" })} className="ghost-btn px-3 py-1.5 text-sm">重试</button>}
                <ManualOverride current={current} onDone={() => act({ action: "manual_override", output: input })} input={input} setInput={setInput} />
                {optionalFlags(current.stepIndex) && <button onClick={() => act({ action: "skip" })} className="ghost-btn px-3 py-1.5 text-sm">跳过</button>}
              </div>
            )}
            {current.executorType === "manual" && current.status === "pending" && (
              <div>
                <div className="text-xs mb-2" style={{ color: "var(--muted)" }}>{stepDefs[current.stepIndex]?.instruction ?? "请完成该步骤"}</div>
                <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={4} placeholder="在此完成并粘贴产出…" value={input} onChange={(e) => setInput(e.target.value)} />
                <button onClick={() => act({ action: "submit", output: input })} disabled={!input.trim()} className="accent-btn px-4 py-2 text-sm">提交产出</button>
              </div>
            )}
            {current.executorType === "checkpoint" && current.status === "pending" && (
              <div>
                <div className="text-sm mb-2">{current.input || "请审核上方各步骤产出是否符合完成标准。"}</div>
                <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={2} placeholder="打回原因(选择打回时填写)" value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
                <div className="flex gap-2">
                  <button onClick={() => act({ action: "approve" })} className="accent-btn px-4 py-2 text-sm">通过</button>
                  <button onClick={() => act({ action: "reject", note: rejectNote })} disabled={!rejectNote.trim()} className="ghost-btn px-4 py-2 text-sm">打回上一步</button>
                </div>
              </div>
            )}
            {current.executorType === "script" && (
              <div>
                <div className="text-xs mb-1" style={{ color: "var(--muted)" }}>{current.input ? "将执行:" : ""}</div>
                {current.input && <pre className="text-sm whitespace-pre-wrap p-2 rounded mb-2" style={{ background: "var(--surface-2)" }}>{current.input}</pre>}
                {current.status === "awaiting_confirmation" && <button onClick={() => act({ action: "confirm" })} className="accent-btn px-4 py-2 text-sm">确认执行</button>}
                {current.status === "done" && <pre className="text-sm whitespace-pre-wrap max-h-60 overflow-auto p-2 rounded" style={{ background: "var(--surface-2)" }}>{current.output}</pre>}
                {current.status === "failed" && <div className="text-xs mb-2" style={{ color: "var(--danger)" }}>{current.error}</div>}
                {current.status === "failed" && (
                  <div className="flex gap-2">
                    <button onClick={() => act({ action: "retry" })} className="ghost-btn px-3 py-1.5 text-sm">重试</button>
                    <ManualOverride current={current} onDone={() => act({ action: "manual_override", output: input })} input={input} setInput={setInput} />
                  </div>
                )}
              </div>
            )}
            {note && <div className="text-xs mt-2" style={{ color: "var(--danger)" }}>{note}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function ManualOverride({ current, onDone, input, setInput }: {
  current: Step; onDone: () => void; input: string; setInput: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!open && <button onClick={() => setOpen(true)} className="ghost-btn px-3 py-1.5 text-sm">人工填写</button>}
      {open && (
        <div className="w-full">
          <textarea className="input w-full px-3 py-2 text-sm mb-2" rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder="人工完成该步骤,粘贴产出…" />
          <button onClick={() => { if (input.trim()) { onDone(); setOpen(false); } }} className="accent-btn px-3 py-1.5 text-sm">以人工产出完成</button>
        </div>
      )}
    </>
  );
}

function CancelRunButton({ runId }: { runId: string }) {
  const router = useRouter();
  const cancel = async () => {
    // 取消 run:status canceled,任务回 ready(状态机 running→ready 合法)
    await fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).catch(() => null);
    router.refresh();
  };
  return <button onClick={cancel} className="ghost-btn px-2 py-1 text-xs mt-3">取消运行</button>;
}
```
**注意(实现时必须补齐):** CancelRunButton 调用了 `POST /api/runs/[id]/cancel` —— 在本任务中一并创建** `src/app/api/runs/[id]/cancel/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { flowRuns, tasks, stepRuns } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const run = db.select().from(flowRuns).where(eq(flowRuns.id, id)).all()[0];
  if (!run) return NextResponse.json({ error: "run 不存在" }, { status: 404 });
  if (!["running", "waiting_human"].includes(run.status)) return NextResponse.json({ error: "当前状态不可取消" }, { status: 409 });
  db.update(flowRuns).set({ status: "canceled", finishedAt: new Date().toISOString() }).where(eq(flowRuns.id, id)).run();
  db.update(stepRuns).set({ status: "skipped" }).where(eq(stepRuns.runId, id)).run();
  const task = db.select().from(tasks).where(eq(tasks.id, run.taskId)).all()[0];
  if (task && ["running", "waiting_human"].includes(task.status)) {
    db.update(tasks).set({ status: "ready", updatedAt: new Date().toISOString() }).where(eq(tasks.id, task.id)).run();
  }
  return NextResponse.json({ run: db.select().from(flowRuns).where(eq(flowRuns.id, id)).all()[0] });
}
```
(manual 步骤的指令来自模板 instruction:GET run 已返回 `stepDefs`,RunView 通过 `stepDefs[current.stepIndex]?.instruction` 渲染;script 的待确认命令由 advance 持久化到 `step.input`。)

- [ ] **Step 4:** `npm test` 76 全绿、`npm run build` 绿 → **Commit** `feat(ui): task execution view with SSE streaming, fallback actions, review`

---

### Task 13: provider_profiles 领域(解析/导入/派生)

**Files:**
- Create: `src/lib/domain/profiles.ts`
- Test: `src/lib/domain/profiles.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect } from "vitest";
import { parseProfileText, importProfilesFromDir, deriveExecutors } from "./profiles";
import { createTestDb } from "@/lib/db/test-util";
import { seedIfEmpty } from "@/lib/db/seed";
import { providerProfiles, executors } from "@/lib/db/schema";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const PROFILE = JSON.stringify({
  env: {
    ANTHROPIC_AUTH_TOKEN: "sk-test-token",
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_MODEL: "glm-5.3-flash",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3",
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: "glm-5.3",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.3-flash",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.2",
  },
  hooks: { PreToolUse: [] },
});

describe("parseProfileText", () => {
  it("提取 env/候选/档位,别名不进候选,检测失效段落", () => {
    const p = parseProfileText("My-Zhipu", PROFILE);
    expect(p.protocol).toBe("anthropic");
    expect(p.apiBase).toBe("https://api.z.ai/api/anthropic");
    expect(p.apiKeyRef).toBe("plain:sk-test-token");
    expect(p.candidates.map((c) => c.tier)).toEqual(["primary", "opus", "sonnet", "haiku"]);
    expect(p.candidates.every((c) => !c.model.includes("_NAME"))).toBe(true);
    expect(p.candidates[1]).toMatchObject({ model: "glm-5.3", alias: "glm-5.3", tier: "opus" });
    expect(p.staleSections).toContain("hooks");
  });
  it("缺 env 或缺 token 抛错", () => {
    expect(() => parseProfileText("x", "{}")).toThrow();
    expect(() => parseProfileText("x", JSON.stringify({ env: {} }))).toThrow();
  });
  it("非 anthropic 端点识别为 openai", () => {
    expect(parseProfileText("x", JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "k", ANTHROPIC_BASE_URL: "https://api.openai.com/v1" } })).protocol).toBe("openai");
  });
});

describe("importProfilesFromDir / deriveExecutors", () => {
  it("导入目录:成功+坏 JSON 跳过;同名跳过;派生创建禁用执行器", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-profiles-"));
    fs.writeFileSync(path.join(dir, "A.txt"), PROFILE);
    fs.writeFileSync(path.join(dir, "B.txt"), "{ broken");
    const r1 = importProfilesFromDir(db, dir);
    expect(r1.imported).toEqual(["A"]);
    expect(r1.skipped).toEqual([{ name: "B", reason: expect.stringContaining("JSON") }]);
    const r2 = importProfilesFromDir(db, dir);
    expect(r2.imported).toHaveLength(0);
    expect(r2.skipped[0].reason).toContain("已存在");
    const prof = (db.select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[])[0];
    const created = deriveExecutors(db, prof.id, [
      { tier: "opus", role: "planner" },
      { tier: "haiku", role: "triage" },
    ]);
    expect(created.length).toBe(2);
    const rows = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    const planner = rows.find((e) => e.name.includes("opus"))!;
    expect(planner.enabled).toBe(false);
    expect(planner.model).toBe("glm-5.3");
    expect(planner.role).toBe("planner");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现** `src/lib/domain/profiles.ts`

```ts
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { providerProfiles, executors } from "@/lib/db/schema";

export interface ProfileCandidate { model: string; alias: string; tier: "primary" | "opus" | "sonnet" | "haiku" }
export interface ParsedProfile {
  name: string; protocol: "anthropic" | "openai"; apiBase: string; apiKeyRef: string;
  candidates: ProfileCandidate[]; staleSections: string[];
}
const STALE = ["hooks", "mcpServers", "statusLine", "extraKnownMarketplaces", "enabledPlugins"];

export function parseProfileText(name: string, raw: string): ParsedProfile {
  let cfg: Record<string, unknown>;
  try { cfg = JSON.parse(raw); } catch (e) { throw new Error(`JSON 解析失败:${String(e).slice(0, 80)}`); }
  const env = cfg.env as Record<string, string> | undefined;
  if (!env || typeof env !== "object") throw new Error("缺少 env 段");
  const token = env.ANTHROPIC_AUTH_TOKEN;
  if (!token) throw new Error("缺少 ANTHROPIC_AUTH_TOKEN");
  const apiBase = env.ANTHROPIC_BASE_URL;
  if (!apiBase) throw new Error("缺少 ANTHROPIC_BASE_URL");
  const candidates: ProfileCandidate[] = [];
  const push = (model: string | undefined, alias: string | undefined, tier: ProfileCandidate["tier"]) => {
    if (!model) return;
    if (candidates.some((c) => c.model === model)) return;
    candidates.push({ model, alias: alias && alias !== model ? alias : model, tier });
  };
  push(env.ANTHROPIC_MODEL, undefined, "primary");
  push(env.ANTHROPIC_DEFAULT_OPUS_MODEL, env.ANTHROPIC_DEFAULT_OPUS_MODEL_NAME, "opus");
  push(env.ANTHROPIC_DEFAULT_SONNET_MODEL, env.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME, "sonnet");
  push(env.ANTHROPIC_DEFAULT_HAIKU_MODEL, env.ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME, "haiku");
  return {
    name, protocol: /\/anthropic/i.test(apiBase) ? "anthropic" : "openai",
    apiBase, apiKeyRef: `plain:${token}`, candidates,
    staleSections: STALE.filter((k) => cfg[k] != null),
  };
}

export function importProfilesFromDir(db: Db, dir: string): { imported: string[]; skipped: { name: string; reason: string }[] } {
  const imported: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt")).sort(); } catch (e) { throw new Error(`目录不可读:${String(e).slice(0, 80)}`); }
  for (const file of files) {
    const name = path.basename(file, ".txt");
    const existing = db.select().from(providerProfiles).where(eq(providerProfiles.name, name)).all();
    if (existing.length > 0) { skipped.push({ name, reason: "已存在同名档案" }); continue; }
    try {
      const p = parseProfileText(name, fs.readFileSync(path.join(dir, file), "utf8"));
      db.insert(providerProfiles).values({
        id: crypto.randomUUID(), name: p.name, protocol: p.protocol, apiBase: p.apiBase,
        apiKeyRef: p.apiKeyRef, candidates: JSON.stringify(p.candidates), source: "import", importPath: dir, createdAt: new Date().toISOString(),
      }).run();
      imported.push(name);
    } catch (e) {
      skipped.push({ name, reason: String(e).slice(0, 120) });
    }
  }
  return { imported, skipped };
}

export function deriveExecutors(db: Db, profileId: string, selections: { tier: ProfileCandidate["tier"]; role: string }[]) {
  const prof = db.select().from(providerProfiles).where(eq(providerProfiles.id, profileId)).all()[0];
  if (!prof) throw new Error("档案不存在");
  const candidates = JSON.parse(prof.candidates) as ProfileCandidate[];
  const created: string[] = [];
  for (const sel of selections) {
    const cand = candidates.find((c) => c.tier === sel.tier);
    if (!cand) throw new Error(`档案 ${prof.name} 没有 ${sel.tier} 档位`);
    const name = `${prof.name}·${sel.tier}`;
    if ((db.select().from(executors).all() as (typeof executors.$inferSelect)[]).some((e) => e.name === name)) continue;
    const id = crypto.randomUUID();
    db.insert(executors).values({
      id, name, type: "llm", role: sel.role, model: cand.model,
      providerProfileId: prof.id, apiBase: prof.apiBase, protocol: prof.protocol,
      apiKeyRef: prof.apiKeyRef, enabled: false, createdAt: new Date().toISOString(),
    }).run();
    created.push(id);
  }
  return created;
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(domain): launcher profile parsing, dir import, tier derive`

---

### Task 14: API(provider-profiles + executors PATCH/test)

**Files:**
- Create: `src/app/api/provider-profiles/route.ts`、`src/app/api/provider-profiles/import/route.ts`、`src/app/api/provider-profiles/[id]/derive/route.ts`、`src/app/api/executors/[id]/route.ts`、`src/app/api/executors/[id]/test/route.ts`
- Test: `src/app/api/provider-profiles/route.test.ts`、`src/app/api/executors-id/route.test.ts`

- [ ] **Step 1: 失败测试** `src/app/api/provider-profiles/route.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET as LIST, POST as CREATE } from "./route";
import { POST as IMPORT } from "./import/route";
import { POST as DERIVE } from "./[id]/derive/route";
import { PATCH as PATCH_EXEC, POST as TEST_EXEC } from "@/app/api/executors/[id]/route";
import { providerProfiles } from "@/lib/db/schema";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

const PROFILE = JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "sk-t", ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic", ANTHROPIC_MODEL: "glm-5.3-flash", ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.3" } });

describe("provider-profiles", () => {
  it("POST 手工创建;GET 列表", async () => {
    const res = await CREATE(req("/api/provider-profiles", { method: "POST", body: JSON.stringify({ name: "手动档案", protocol: "openai", api_base: "https://x/v1", api_key: "sk-1", candidates: [{ model: "m1", alias: "m1", tier: "primary" }] }) }));
    expect(res.status).toBe(201);
    const list = await (await LIST(req("/api/provider-profiles"))).json();
    expect(list.profiles.length).toBe(1);
    expect(list.profiles[0].apiKeyRef).toBe("plain:sk-1");
  });
  it("import:扫描目录导入并返回报告", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-"));
    fs.writeFileSync(path.join(dir, "A.txt"), PROFILE);
    fs.writeFileSync(path.join(dir, "B.txt"), "{ broken");
    const res = await IMPORT(req("/api/provider-profiles/import", { method: "POST", body: JSON.stringify({ dir }) }));
    const data = await res.json();
    expect(data.report.imported).toEqual(["A"]);
    expect(data.report.skipped[0].name).toBe("B");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("derive:按档位派生禁用执行器;缺档位 400", async () => {
    await CREATE(req("/api/provider-profiles", { method: "POST", body: JSON.stringify({ name: "P1", protocol: "anthropic", api_base: "https://a/anthropic", api_key: "k", candidates: [{ model: "strong", alias: "strong", tier: "opus" }, { model: "fast", alias: "fast", tier: "haiku" }] }) }));
    const prof = (db.select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[])[0];
    const res = await DERIVE(req(`/api/provider-profiles/${prof.id}/derive`, { method: "POST", body: JSON.stringify({ selections: [{ tier: "opus", role: "planner" }] }) }), { params: Promise.resolve({ id: prof.id }) });
    expect(res.status).toBe(201);
    const bad = await DERIVE(req(`/api/provider-profiles/${prof.id}/derive`, { method: "POST", body: JSON.stringify({ selections: [{ tier: "sonnet", role: "executor" }] }) }), { params: Promise.resolve({ id: prof.id }) });
    expect(bad.status).toBe(409);
  });
});

describe("executors [id]", () => {
  it("PATCH 启用/禁用", async () => {
    const { executors } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const ex = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).find((e) => e.name === "快速模型")!;
    const off = await PATCH_EXEC(req(`/api/executors/${ex.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) }), { params: Promise.resolve({ id: ex.id }) });
    expect(off.status).toBe(200);
    expect(((await off.json()).executor as typeof executors.$inferSelect).enabled).toBe(false);
    const on = await PATCH_EXEC(req(`/api/executors/${ex.id}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) }), { params: Promise.resolve({ id: ex.id }) });
    expect(((await on.json()).executor as typeof executors.$inferSelect).enabled).toBe(true);
  });
  it("test:ping 模型连通性(mock fetch)", async () => {
    const { executors } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    db.update(executors).set({ enabled: true, role: "executor" }).where(eq(executors.name, "快速模型")).run();
    const ex = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).find((e) => e.name === "快速模型")!;
    const f = await import("vitest").then((v) => v.vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 1, completion_tokens: 1 }, model: "m" }), { status: 200 })));
    const v = await import("vitest");
    v.vi.stubGlobal("fetch", f);
    const res = await TEST_EXEC(req(`/api/executors/${ex.id}/test`, { method: "POST" }), { params: Promise.resolve({ id: ex.id }) });
    v.vi.unstubAllGlobals();
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.reply).toBe("pong");
  });
});
```
(实现者注意:倒数第二个用例骨架不完整——按最终意图写成:取种子"快速模型",PATCH `{enabled:false}` → 200 且 enabled=false;再 PATCH `{enabled:true}` → 200。删除骨架里多余行。)

- [ ] **Step 2:** FAIL。**Step 3: 实现 5 个路由**

`src/app/api/provider-profiles/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { providerProfiles } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ profiles: getDb().select().from(providerProfiles).all() });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.api_base !== "string" || !body.api_base.trim() || typeof body.api_key !== "string" || !body.api_key.trim()) {
    return NextResponse.json({ error: "name / api_base / api_key 必填" }, { status: 400 });
  }
  const protocol = body.protocol === "openai" ? "openai" : "anthropic";
  const profile = {
    id: crypto.randomUUID(), name: body.name.trim(), protocol, apiBase: body.api_base.trim(),
    apiKeyRef: `plain:${body.api_key}`,
    candidates: JSON.stringify(Array.isArray(body.candidates) ? body.candidates : []),
    source: "manual", createdAt: new Date().toISOString(),
  };
  getDb().insert(providerProfiles).values(profile).run();
  return NextResponse.json({ profile }, { status: 201 });
}
```

`src/app/api/provider-profiles/import/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { importProfilesFromDir } from "@/lib/domain/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!body || typeof body.dir !== "string" || !body.dir.trim()) {
    return NextResponse.json({ error: "dir 必填" }, { status: 400 });
  }
  try {
    const report = importProfilesFromDir(getDb(), body.dir.trim());
    return NextResponse.json({ report });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 400 });
  }
}
```

`src/app/api/provider-profiles/[id]/derive/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { deriveExecutors } from "@/lib/domain/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const selections = body?.selections;
  if (!Array.isArray(selections) || selections.length === 0) {
    return NextResponse.json({ error: "selections 必填(如 [{tier:'opus', role:'planner'}])" }, { status: 400 });
  }
  try {
    const created = deriveExecutors(getDb(), id, selections as { tier: "primary" | "opus" | "sonnet" | "haiku"; role: string }[]);
    return NextResponse.json({ created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e).slice(0, 200) }, { status: 409 });
  }
}
```

`src/app/api/executors/[id]/route.ts`(PATCH:enabled/名称/模型/端点等白名单字段):
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const patch: Partial<typeof executors.$inferInsert> = {};
  if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.model === "string" || body.model === null) patch.model = body.model as string | null;
  if (typeof body.api_base === "string" || body.api_base === null) patch.apiBase = body.api_base as string | null;
  if (body.protocol === "openai" || body.protocol === "anthropic") patch.protocol = body.protocol;
  if (typeof body.role === "string") patch.role = body.role;
  if (typeof body.timeout_ms === "number") patch.timeoutMs = body.timeoutMs;
  if (typeof body.working_dir === "string" || body.working_dir === null) patch.workingDir = body.working_dir as string | null;
  if (typeof body.auto_approve === "boolean") patch.autoApprove = body.auto_approve;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  getDb().update(executors).set(patch).where(eq(executors.id, id)).run();
  const row = getDb().select().from(executors).where(eq(executors.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ executor: row });
}
```
(上一节 PATCH 路由的占位噪声已并入正文中,无需额外处理。)

`src/app/api/executors/[id]/test/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { executors } from "@/lib/db/schema";
import { executorLlmConfig, callLlm } from "@/lib/llm/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ex = getDb().select().from(executors).where(eq(executors.id, id)).all()[0];
  if (!ex) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ex.type !== "llm") return NextResponse.json({ error: "仅 llm 执行器支持连通性测试" }, { status: 400 });
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) { return NextResponse.json({ ok: false, error: String(e) }, { status: 200 }); }
  if (!cfg.apiKey) return NextResponse.json({ ok: false, error: "API key 未配置(apiKeyRef 指向的环境变量不存在)" }, { status: 200 });
  try {
    const r = await callLlm(cfg, [{ role: "user", content: "回复 pong 两个字母以内" }]);
    return NextResponse.json({ ok: true, reply: r.text.slice(0, 50), model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 300) }, { status: 200 });
  }
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(api): provider profiles (manual/import/derive) + executor patch/test`

---

### Task 15: /executors 管理页

**Files:**
- Create: `src/app/executors/page.tsx`、`src/components/ExecutorsView.tsx`
- Modify: `src/components/Sidebar.tsx`(executors 项 ready: true)

- [ ] **Step 1: 服务端页** `src/app/executors/page.tsx`

```tsx
import { getDb } from "@/lib/db/client";
import { executors, providerProfiles } from "@/lib/db/schema";
import { ExecutorsView } from "@/components/ExecutorsView";

export const dynamic = "force-dynamic";

export default function ExecutorsPage() {
  const ex = getDb().select().from(executors).all() as (typeof executors.$inferSelect)[];
  const profiles = getDb().select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[];
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">执行器与模型路由</h1>
      <ExecutorsView executors={[...ex]} profiles={[...profiles]} />
    </div>
  );
}
```

- [ ] **Step 2: ExecutorsView 客户端组件** `src/components/ExecutorsView.tsx`(完整实现;一致性栏:IME/try-finally/res.ok/失败提示)

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { executors, providerProfiles } from "@/lib/db/schema";

type Executor = typeof executors.$inferSelect;
type Profile = typeof providerProfiles.$inferSelect;

const ROLE_LABEL: Record<string, string> = { triage: "分诊", planner: "规划", executor: "执行", reviewer: "审查", evolution: "复盘" };

export function ExecutorsView({ executors: initialExecutors, profiles }: { executors: Executor[]; profiles: Profile[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [importDir, setImportDir] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: "", role: "executor", model: "", api_base: "", protocol: "openai", api_key_ref: "env:EVODESK_FAST_KEY" });

  const patch = async (id: string, body: Record<string, unknown>, tag: string) => {
    setBusy(tag);
    try {
      const res = await fetch(`/api/executors/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { setMsg("操作失败,请重试"); return; }
      router.refresh();
    } finally { setBusy(null); }
  };
  const test = async (id: string) => {
    setBusy(`test-${id}`);
    try {
      const res = await fetch(`/api/executors/${id}/test`, { method: "POST" });
      const data = await res.json().catch(() => null);
      setMsg(data?.ok ? `✓ ${data.reply ?? "pong"}` : `✗ ${data?.error ?? "测试失败"}`);
    } finally { setBusy(null); }
  };
  const doImport = async () => {
    if (!importDir.trim()) return;
    setBusy("import");
    try {
      const res = await fetch("/api/provider-profiles/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dir: importDir }) });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.report) { setMsg(data?.error ?? "导入失败"); return; }
      const s = data.report.skipped as { name: string; reason: string }[];
      setMsg(`导入 ${data.report.imported.length} 个${s.length ? `;跳过:${s.map((x) => `${x.name}(${x.reason})`).join("、")}` : ""}`);
      setImportDir("");
      router.refresh();
    } finally { setBusy(null); }
  };
  const derive = async (profileId: string, tier: string, role: string) => {
    setBusy(`derive-${profileId}-${tier}`);
    try {
      const res = await fetch(`/api/provider-profiles/${profileId}/derive`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ selections: [{ tier, role }] }) });
      const data = await res.json().catch(() => null);
      if (!res.ok) { setMsg(data?.error ?? "派生失败"); return; }
      setMsg("已创建(默认禁用,请启用后使用)");
      router.refresh();
    } finally { setBusy(null); }
  };
  const addExecutor = async () => {
    if (!form.name.trim() || busy) return;
    setBusy("add");
    try {
      const res = await fetch("/api/executors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) { setMsg("创建失败"); return; }
      setShowAdd(false);
      setForm({ name: "", role: "executor", model: "", api_base: "", protocol: "openai", api_key_ref: "env:EVODESK_FAST_KEY" });
      router.refresh();
    } finally { setBusy(null); }
  };

  return (
    <div>
      {msg && <div className="surface p-2 mb-3 text-sm">{msg}</div>}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <h2 className="font-semibold">执行器</h2>
          <button onClick={() => setShowAdd(!showAdd)} className="ghost-btn px-2 py-1 text-xs">{showAdd ? "收起" : "+ 新增"}</button>
        </div>
        {showAdd && (
          <div className="surface p-3 mb-3 grid md:grid-cols-3 gap-2">
            <input className="input px-2 py-1.5 text-sm" placeholder="名称" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select className="input px-2 py-1.5 text-sm" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input px-2 py-1.5 text-sm" value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value })}>
              <option value="openai">OpenAI 协议</option><option value="anthropic">Anthropic 协议</option>
            </select>
            <input className="input px-2 py-1.5 text-sm" placeholder="模型名" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            <input className="input px-2 py-1.5 text-sm" placeholder="API Base URL" value={form.api_base} onChange={(e) => setForm({ ...form, api_base: e.target.value })} />
            <input className="input px-2 py-1.5 text-sm" placeholder="密钥引用 env:NAME" value={form.api_key_ref} onChange={(e) => setForm({ ...form, api_key_ref: e.target.value })} />
            <button onClick={addExecutor} disabled={busy === "add"} className="accent-btn px-3 py-1.5 text-sm md:col-span-3">{busy === "add" ? "创建中…" : "创建执行器"}</button>
          </div>
        )}
        <div className="space-y-2">
          {initialExecutors.map((e) => (
            <div key={e.id} className="surface p-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{e.name}</span>
              <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{e.type}</span>
              <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{ROLE_LABEL[e.role] ?? e.role}</span>
              {e.model && <span className="text-xs" style={{ color: "var(--muted)" }}>{e.model}</span>}
              {!e.enabled && <span className="text-xs" style={{ color: "var(--warn)" }}>已禁用</span>}
              <div className="ml-auto flex gap-2">
                {e.type === "llm" && <button onClick={() => test(e.id)} disabled={busy === `test-${e.id}`} className="ghost-btn px-2 py-1 text-xs">{busy === `test-${e.id}` ? "测试中…" : "测试"}</button>}
                <button onClick={() => patch(e.id, { enabled: !e.enabled }, `toggle-${e.id}`)} disabled={busy === `toggle-${e.id}`} className="ghost-btn px-2 py-1 text-xs">{e.enabled ? "禁用" : "启用"}</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-semibold mb-2">供应商档案</h2>
        <div className="surface p-3 mb-3 flex flex-wrap gap-2 items-center">
          <input className="input px-2 py-1.5 text-sm flex-1 min-w-60" placeholder="启动器配置目录(含 *.txt,如 D:\\AI\\setting\\发布包)" value={importDir} onChange={(e) => setImportDir(e.target.value)} />
          <button onClick={doImport} disabled={busy === "import" || !importDir.trim()} className="accent-btn px-3 py-1.5 text-sm">{busy === "import" ? "导入中…" : "扫描导入"}</button>
        </div>
        {profiles.length === 0 && <div className="surface p-3 text-sm" style={{ color: "var(--muted)" }}>暂无档案。指向你的启动器发布包目录即可一键导入(密钥仅存本地)。</div>}
        <div className="space-y-2">
          {profiles.map((p) => {
            const cands = JSON.parse(p.candidates) as { model: string; tier: string }[];
            return (
              <div key={p.id} className="surface p-3 text-sm">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{p.protocol}</span>
                  <span className="text-xs" style={{ color: "var(--muted)" }}>{p.apiBase}</span>
                </div>
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>档位:{cands.map((c) => `${c.tier}=${c.model}`).join(" · ") || "无候选"}</div>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {(["opus", "sonnet", "haiku", "primary"] as const).map((tier) => {
                    const role = tier === "opus" ? "planner" : tier === "haiku" ? "triage" : tier === "sonnet" ? "executor" : "executor";
                    return cands.some((c) => c.tier === tier) ? (
                      <button key={tier} onClick={() => derive(p.id, tier, role)} disabled={busy === `derive-${p.id}-${tier}`} className="ghost-btn px-2 py-1 text-xs">
                        派生{tier}→{ROLE_LABEL[role]}
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
```
**前置依赖(本任务内实现):** `POST /api/executors`(创建执行器)——Task 13 只建了 GET。在 `src/app/api/executors/route.ts` 补 POST:校验 name/api_base(api_key 可空)+ 类型默认 llm + role 白名单,插入返回 201;并补 2 个测试用例(创建成功/缺 name 400)。

- [ ] **Step 3:** Sidebar.tsx:executors 项 `ready: true`。**Step 4:** `npm test` 全绿、`npm run build` 绿 → **Commit** `feat(ui): executors page with profiles import/derive/test`

---

### Task 16: chats API(SSE)

**Files:**
- Create: `src/app/api/chats/route.ts`、`src/app/api/chats/[id]/route.ts`、`src/app/api/chats/[id]/messages/route.ts`
- Test: `src/app/api/chats/route.test.ts`

- [ ] **Step 1: 失败测试**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { chats, executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GET as LIST, POST as CREATE } from "./route";
import { GET as ONE } from "./[id]/route";
import { POST as SEND } from "./[id]/messages/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

describe("chats", () => {
  it("POST 创建会话;GET 列表;GET 单个含消息", async () => {
    const res = await CREATE(req("/api/chats", { method: "POST", body: JSON.stringify({ title: "新对话" }) }));
    const { chat } = await res.json();
    const list = await (await LIST(req("/api/chats"))).json();
    expect(list.chats.length).toBeGreaterThanOrEqual(1);
    const one = await (await ONE(req(`/api/chats/${chat.id}`), { params: Promise.resolve({ id: chat.id }) })).json();
    expect(one.chat.id).toBe(chat.id);
    expect(one.messages).toEqual([]);
  });
  it("发消息:启用执行器 → SSE 回复 + 双消息落库 + 成本记录", async () => {
    const { chat } = await (await CREATE(req("/api/chats", { method: "POST", body: JSON.stringify({}) }))).json();
    db.update(executors).set({ enabled: true, role: "executor", costPer1kInput: 1, costPer1kOutput: 2 }).where(eq(executors.name, "快速模型")).run();
    const f = vi.fn().mockResolvedValue(new Response(
      new ReadableStream({
        start(c) {
          const enc = new TextEncoder();
          c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"回答"}}]}\n\n'));
          c.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":6,"completion_tokens":2}}\n\n'));
          c.enqueue(enc.encode("data: [DONE]\n\n"));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    ));
    vi.stubGlobal("fetch", f);
    const res = await SEND(req(`/api/chats/${chat.id}/messages`, { method: "POST", body: JSON.stringify({ content: "你好" }) }), { params: Promise.resolve({ id: chat.id }) });
    vi.unstubAllGlobals();
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text();
    expect(text).toContain('"delta":"回答"');
    expect(text).toContain('"done":true');
    const one = await (await ONE(req(`/api/chats/${chat.id}`), { params: Promise.resolve({ id: chat.id }) })).json();
    expect(one.messages.length).toBe(2);
    expect(one.messages[1].role).toBe("assistant");
    expect(one.messages[1].tokensOut).toBe(2);
    expect(one.messages[1].costUsd).toBeGreaterThan(0);
  });
  it("无可用模型 → 400 明确错误", async () => {
    const { chat } = await (await CREATE(req("/api/chats", { method: "POST", body: JSON.stringify({}) }))).json();
    const res = await SEND(req(`/api/chats/${chat.id}/messages`, { method: "POST", body: JSON.stringify({ content: "hi" }) }), { params: Promise.resolve({ id: chat.id }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("未配置可用模型");
  });
});
```

- [ ] **Step 2:** FAIL。**Step 3: 实现**

`src/app/api/chats/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ chats: getDb().select().from(chats).orderBy(desc(chats.updatedAt)).all() });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const nowIso = new Date().toISOString();
  const chat = {
    id: crypto.randomUUID(),
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "新对话",
    defaultExecutorId: typeof body.default_executor_id === "string" ? body.default_executor_id : null,
    createdAt: nowIso, updatedAt: nowIso,
  };
  getDb().insert(chats).values(chat).run();
  return NextResponse.json({ chat }, { status: 201 });
}
```

`src/app/api/chats/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats, chatMessages } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const chat = db.select().from(chats).where(eq(chats.id, id)).all()[0];
  if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = db.select().from(chatMessages).where(eq(chatMessages.chatId, id)).orderBy(asc(chatMessages.createdAt)).all();
  return NextResponse.json({ chat, messages });
}
```

`src/app/api/chats/[id]/messages/route.ts`:
```ts
import { NextRequest } from "next/server";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats, chatMessages, executors } from "@/lib/db/schema";
import { executorLlmConfig } from "@/lib/llm/client";
import { streamLlm } from "@/lib/llm/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = "你是 EvoDesk 本地个人工作台内置的 AI 助手,回答简洁、可直接执行。";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const chat = db.select().from(chats).where(eq(chats.id, id)).all()[0];
  if (!chat) return new Response(JSON.stringify({ error: "会话不存在" }), { status: 404, headers: { "content-type": "application/json" } });
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return new Response(JSON.stringify({ error: "content 必填" }), { status: 400, headers: { "content-type": "application/json" } });

  const allEx = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
  const enabledLlm = allEx.filter((e) => e.type === "llm" && e.enabled);
  const requested = typeof body.executor_id === "string" ? enabledLlm.find((e) => e.id === body.executor_id) : undefined;
  const ex = requested
    ?? (chat.defaultExecutorId ? enabledLlm.find((e) => e.id === chat.defaultExecutorId) : undefined)
    ?? enabledLlm.find((e) => e.role === "executor") ?? enabledLlm[0];
  if (!ex) return new Response(JSON.stringify({ error: "未配置可用模型:请在执行器页启用一个 LLM 执行器,或导入供应商档案后派生" }), { status: 400, headers: { "content-type": "application/json" } });

  const nowIso = new Date().toISOString();
  const userMsg = { id: crypto.randomUUID(), chatId: id, role: "user", content, executorId: null, model: null, tokensIn: 0, tokensOut: 0, costUsd: 0, createdAt: nowIso };
  db.insert(chatMessages).values(userMsg).run();
  const history = db.select().from(chatMessages).where(eq(chatMessages.chatId, id)).orderBy(asc(chatMessages.createdAt)).all() as (typeof chatMessages.$inferSelect)[];
  const llmMessages = [{ role: "system" as const, content: SYSTEM }, ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))];

  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) {
    return new Response(JSON.stringify({ error: `执行器配置错误:${String(e)}` }), { status: 400, headers: { "content-type": "application/json" } });
  }

  const encoder = new TextEncoder();
  const started = Date.now();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const it = streamLlm(cfg, llmMessages);
        for (;;) {
          const r = await it.next();
          if (r.done) {
            const finishedAt = new Date().toISOString();
            const assistantMsg = {
              id: crypto.randomUUID(), chatId: id, role: "assistant", content: r.value.text,
              executorId: ex.id, model: r.value.model, tokensIn: r.value.tokensIn, tokensOut: r.value.tokensOut,
              costUsd: (r.value.tokensIn / 1000) * ex.costPer1kInput + (r.value.tokensOut / 1000) * ex.costPer1kOutput,
              createdAt: finishedAt,
            };
            db.insert(chatMessages).values(assistantMsg).run();
            db.update(chats).set({ updatedAt: finishedAt }).where(eq(chats.id, id)).run();
            void started;
            send({ done: true, message: assistantMsg });
            break;
          }
          send({ delta: r.value });
        }
      } catch (e) {
        send({ done: true, error: String(e).slice(0, 300) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
```

- [ ] **Step 4:** 全绿 → **Commit** `feat(api): chats with per-message executor and SSE streaming`

---

### Task 17: /chat 对话台页

**Files:**
- Create: `src/app/chat/page.tsx`、`src/components/ChatView.tsx`
- Modify: `src/components/Sidebar.tsx`(chat 项 ready: true)、`src/lib/db/seed.ts`(示例会话,见 Task 18 一并处理则合并到 Task 18)

**说明:** 为减少跨任务耦合,本任务只做页面;示例会话种子放 Task 18。

- [ ] **Step 1: 服务端页** `src/app/chat/page.tsx`

```tsx
import { desc, eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats, chatMessages, executors, providerProfiles } from "@/lib/db/schema";
import { ChatView } from "@/components/ChatView";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const db = getDb();
  const chatRows = db.select().from(chats).orderBy(desc(chats.updatedAt)).all() as (typeof chats.$inferSelect)[];
  const active = chatRows.find((x) => x.id === c) ?? chatRows[0] ?? null;
  const messages = active
    ? (db.select().from(chatMessages).where(eq(chatMessages.chatId, active.id)).orderBy(asc(chatMessages.createdAt)).all() as (typeof chatMessages.$inferSelect)[])
    : [];
  const exRows = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.type === "llm" && e.enabled);
  const profRows = db.select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[];
  const groups = exRows.map((e) => {
    const prof = profRows.find((p) => p.id === e.providerProfileId);
    return { executorId: e.id, label: `${e.name} · ${e.model ?? ""}`, group: prof?.name ?? "独立执行器" };
  });

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">AI 对话台</h1>
      <ChatView
        chats={chatRows.map((x) => ({ id: x.id, title: x.title }))}
        activeId={active?.id ?? null}
        initialMessages={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, model: m.model, costUsd: m.costUsd }))}
        modelGroups={groups}
        hasAnyModel={groups.length > 0}
      />
    </div>
  );
}
```

- [ ] **Step 2: ChatView** `src/components/ChatView.tsx`

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface Msg { id: string; role: string; content: string; model: string | null; costUsd: number }

export function ChatView({ chats, activeId, initialMessages, modelGroups, hasAnyModel }: {
  chats: { id: string; title: string }[];
  activeId: string | null;
  initialMessages: Msg[];
  modelGroups: { executorId: string; label: string; group: string }[];
  hasAnyModel: boolean;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<Msg[]>(initialMessages);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [executorId, setExecutorId] = useState<string>(modelGroups[0]?.executorId ?? "");
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const groups = [...new Set(modelGroups.map((g) => g.group))];

  const send = async () => {
    if (!input.trim() || streaming || !activeId) return;
    setError(null);
    const userMsg: Msg = { id: `tmp-${Date.now()}`, role: "user", content: input, model: null, costUsd: 0 };
    const assistantId = `tmp-a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: assistantId, role: "assistant", content: "", model: null, costUsd: 0 }]);
    const text = input;
    setInput("");
    setStreaming(true);
    try {
      const res = await fetch(`/api/chats/${activeId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: text, executor_id: executorId || undefined }) });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "发送失败,请重试");
        setMessages((m) => m.filter((x) => x.id !== userMsg.id && x.id !== assistantId));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          if (!block.startsWith("data:")) continue;
          const evt = JSON.parse(block.slice(5).trim());
          if (evt.delta) setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, content: x.content + evt.delta } : x)));
          if (evt.done) {
            if (evt.error) { setError(evt.error); setMessages((m) => m.filter((x) => x.id !== assistantId)); }
            else if (evt.message) setMessages((m) => m.map((x) => (x.id === assistantId ? { id: evt.message.id, role: "assistant", content: evt.message.content, model: evt.message.model, costUsd: evt.message.costUsd } : x)));
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }
        }
      }
    } catch {
      setError("网络中断,请重试");
    } finally {
      setStreaming(false);
      router.refresh();
    }
  };

  const toTask = (content: string) => {
    fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: content.slice(0, 40), description: content }) })
      .then(() => router.push("/inbox"));
  };

  return (
    <div>
      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <select className="input px-2 py-1.5 text-sm" value={activeId ?? ""} onChange={(e) => router.push(`/chat?c=${e.target.value}`)}>
          {chats.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
        <button onClick={() => router.push("/chat")} className="ghost-btn px-2 py-1.5 text-sm">+ 新对话</button>
        <select className="input px-2 py-1.5 text-sm ml-auto" value={executorId} onChange={(e) => setExecutorId(e.target.value)} disabled={!hasAnyModel}>
          {!hasAnyModel && <option value="">未配置模型</option>}
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {modelGroups.filter((m) => m.group === g).map((m) => <option key={m.executorId} value={m.executorId}>{m.label}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="surface p-4 mb-3 space-y-3 min-h-60 max-h-[60vh] overflow-auto">
        {!hasAnyModel && (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            尚未配置可用模型。到「执行器」页导入供应商档案并启用,或在设置环境变量后启用种子执行器。
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block text-sm whitespace-pre-wrap px-3 py-2 rounded-xl max-w-[85%] text-left ${m.role === "user" ? "accent-btn" : "surface"}`}
              style={m.role === "user" ? {} : { background: "var(--surface-2)" }}>
              {m.content}
            </div>
            {m.role === "assistant" && (m.model || m.costUsd > 0) && (
              <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>{m.model} · ${m.costUsd.toFixed(6)}
                <button onClick={() => toTask(m.content)} className="ml-2 underline" style={{ color: "var(--accent)" }}>转为任务</button>
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      {error && <div className="text-xs mb-2" style={{ color: "var(--danger)" }}>{error}</div>}
      <div className="flex gap-2">
        <input
          className="input flex-1 px-3 py-2 text-sm"
          placeholder={hasAnyModel ? "输入消息,Enter 发送…" : "请先配置模型"}
          value={input}
          disabled={!activeId || !hasAnyModel}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) send(); }}
        />
        <button onClick={send} disabled={streaming || !input.trim()} className="accent-btn px-4 py-2 text-sm">{streaming ? "…" : "发送"}</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3:** Sidebar chat 项 ready:true;**Step 4:** `npm test` 全绿、`npm run build` 绿 → **Commit** `feat(ui): chat page with model switching and SSE`

---

### Task 18: 种子补齐 + 链接更新 + README

**Files:**
- Modify: `src/lib/db/seed.ts`(幂等补齐)、`src/app/page.tsx`? (无需)、`README.md`

- [ ] **Step 1: seed.ts 末尾(seedIfEmpty 内、事务外)追加幂等补齐块**(旧库也能获得;名称/计数判重)

```ts
  // —— 幂等补齐(独立于首播种子,老库升级也能拿到)——
  const exRows = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
  if (!exRows.some((e) => e.name === "审查占位模型")) {
    db.insert(executors).values({
      id: id(), name: "审查占位模型", type: "llm", role: "reviewer", model: "YOUR_STRONG_MODEL",
      apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_STRONG_KEY",
      enabled: false, createdAt: now(),
    }).run();
  }
  const chatCount = (db.select().from(chats).all() as unknown[]).length;
  if (chatCount === 0) {
    const nowIso = now();
    db.insert(chats).values({ id: id(), title: "欢迎使用 EvoDesk 对话", createdAt: nowIso, updatedAt: nowIso }).run();
  }
```
(需在 seed.ts 顶部导入 `chats`;测试:在既有部分冲突测试后再加一个用例 —— 建一个只跑过旧种子的库模拟:直接手动插一条旧种子的最小状态太繁琐,改为断言"两次 seedIfEmpty 后 reviewer 占位执行器恰 1 个、会话恰 1 个",并单测"已有同名执行器不重复插入"。)

新增测试(seed.test.ts):
```ts
  it("幂等补齐:reviewer 占位执行器与示例会话(旧库升级路径)", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    seedIfEmpty(db);
    const ex = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    expect(ex.filter((e) => e.name === "审查占位模型").length).toBe(1);
    expect(ex.filter((e) => e.role === "reviewer").length).toBe(1);
  });
```

- [ ] **Step 2: 链接更新** — `src/app/tasks/page.tsx` 看板卡片:标题行包 Link 到 `/tasks/${t.id}`(ready/running/waiting_human/review 状态);`src/components/TaskCard.tsx` 已在 M1+M2 处理;核对即可。

- [ ] **Step 3: README 更新** — 能力清单加入:任务执行(LLM 流式/脚本安全门/人工兜底/评审打分)、AI 对话台(会话内切换模型/成本记录)、供应商档案导入与派生;「接入 AI」章节改写为推荐路径:执行器页 → 扫描导入启动器配置目录(如 `D:\AI\setting\发布包`)→ 按档位派生执行器 → 启用 → 「测试」验证。

- [ ] **Step 4:** `npm test` 全绿、`npm run build` 绿 → **Commit** `feat(seed): reviewer placeholder + welcome chat; links; README M3`

---

## 后续(不在本计划)

- M4(Plan 3):流程库 UI、进化引擎、快捷指令、笔记速记、Obsidian 知识库
- 遗留观察项(执行时注意,勿扩大范围):tasks/[id] PATCH 数组体静默 no-op 与 projects 的 400 语义不一致(zod 化时统一);settings PUT 任意键 by-design;status.ts 与 triage 白名单的双源(triageable 集合)可在下次触碰 status.ts 时导出常量
