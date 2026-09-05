# EvoDesk M1+M2(基础与任务流)实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 EvoDesk 本地工作台骨架与数据层,交付可用的任务流:收件箱录入 → LLM 分诊路由 → 就绪 → 看板,含项目维度、周期任务投放、今日清单与深色主题外壳。

**Architecture:** Next.js 15 App Router 单进程全栈;Server Components 直读 SQLite(better-sqlite3 + Drizzle),变更走 Route Handlers;领域逻辑(路由打分/分诊/状态机/周期投放)为纯函数模块并有单测;LLM 客户端双协议(openai/anthropic)原生 fetch 实现便于 mock。

**Tech Stack:** Next.js 15 · TypeScript · better-sqlite3 · Drizzle ORM · zod · Tailwind CSS v4 · vitest

**Spec:** `docs/superpowers/specs/2026-09-06-evodesk-personal-workbench-design.md`(本计划覆盖其 M1+M2;M3 执行引擎、M4 流程库/进化/知识库、M5 仪表盘完整版各自后续成计划)

**环境注意(Windows):** shell 为 Git Bash;所有命令在 `D:\home\EvoFlow` 下执行;Node 24 / npm 11 已装。

---

## 文件结构

```
src/
  lib/
    db/
      client.ts          getDb 单例(建目录/WAL/迁移)、__setDbForTests
      schema.ts          6 张表:tasks/projects/flow_templates/executors/recurring_rules/settings
      seed.ts            幂等种子(4 模板/4 执行器/2 项目/2 周期规则/示例任务/默认设置)
      test-util.ts       createTestDb(:memory: + 迁移)
    llm/
      client.ts          callLlm(双协议)/callLlmWithRetry/resolveApiKey/executorLlmConfig
    domain/
      status.ts          任务状态机与 canTransition
      router.ts          模板打分 scoreTemplate/routeTemplate(niching + 成本决胜)
      triage.ts          LLM 分诊:构建提示/解析/降级 fallback
      recurring.ts       nextRunAfter/tickRecurring(错过补齐,单规则上限 31 次)
    quotes.ts            每日激励语句库(10 条,本地)
  app/
    layout.tsx           主题初始化脚本 + 侧边栏 + 顶栏(时钟/语句/快速新增)
    globals.css          CSS 变量主题(深色默认 + 蓝紫强调,浅色切换)
    page.tsx             仪表盘(核心数据/今日清单/项目进度)
    inbox/page.tsx       收件箱:快速录入 + 分诊队列(一键分诊/确认就绪)
    tasks/page.tsx       看板:状态分列 + 项目过滤
    settings/page.tsx    设置:主题/预算/vault 路径占位
    api/tasks/route.ts           GET 列表(含 tick)· POST 新建
    api/tasks/[id]/route.ts      GET 详情 · PATCH 更新(状态机校验)
    api/tasks/[id]/triage/route.ts  POST LLM 分诊
    api/projects/route.ts        GET/POST
    api/projects/[id]/route.ts   PATCH
    api/recurring-rules/route.ts GET/POST
    api/recurring-rules/tick/route.ts POST
    api/settings/route.ts        GET/PUT
  components/
    Sidebar.tsx  TopBar.tsx  Clock.tsx  QuoteOfDay.tsx  QuickAdd.tsx
    TaskCard.tsx  TriageCard.tsx  ThemeToggle.tsx
tests 布局:单测与被测文件同目录 `*.test.ts`;API 集成测试直接调用 route handler 函数
```

后续计划预留(本计划不建):flow_runs/step_runs/executors 的 script 字段使用/provider_profiles/quick_actions/notes/chats/evolution_events 表,以及执行引擎、对话台、知识库等页面。

---

### Task 1: 脚手架与依赖

**Files:**
- Create: Next.js 脚手架(约 equals `package.json`/`next.config.ts`/`tsconfig.json`/`src/app/`…)
- Modify: `package.json`(scripts)、`next.config.ts`、`vitest.config.ts`(新建)、`drizzle.config.ts`(新建)

- [ ] **Step 1: 脚手架(在现有目录,保留 docs 与 .git)**

```bash
cd /d/home/EvoFlow
npx --yes create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```
Expected: 生成 `package.json`、`src/app/` 等;提示 "Git repo detected" 跳过 git init。

- [ ] **Step 2: 安装运行时与开发依赖**

```bash
npm i better-sqlite3 drizzle-orm zod && npm i -D drizzle-kit vitest @types/better-sqlite3
```
Expected: 安装成功,无 peer 冲突报错。

- [ ] **Step 3: 配置 next.config.ts(better-sqlite3 不打包)**

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
```

- [ ] **Step 4: 新建 drizzle.config.ts 与 vitest.config.ts**

`drizzle.config.ts`:
```ts
import type { Config } from "drizzle-kit";

export default {
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
} satisfies Config;
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
```

- [ ] **Step 5: package.json scripts 增加**

在 `scripts` 中加入:
```json
"test": "vitest run",
"test:watch": "vitest",
"db:generate": "drizzle-kit generate"
```

- [ ] **Step 6: 验证构建与测试空跑**

```bash
npm run build && npm test
```
Expected: build 成功;vitest 提示 "No test files found"(退出码可为 0 或 1,记录即可)。

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: scaffold Next.js 15 + sqlite/drizzle/vitest toolchain"
```

---

### Task 2: DB 客户端与测试工具

**Files:**
- Create: `src/lib/db/client.ts`、`src/lib/db/test-util.ts`
- Test: `src/lib/db/client.test.ts`

- [ ] **Step 1: 写失败测试(迁移可跑、单例可复用)**

`src/lib/db/client.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-util";
import { getDb, __setDbForTests } from "./client";

describe("db client", () => {
  it("createTestDb 迁移成功且可执行 SQL", () => {
    const db = createTestDb();
    const rows = db.all("select 1 as x") as { x: number }[];
    expect(rows[0].x).toBe(1);
  });
  it("getDb 返回被注入的测试库", () => {
    const db = createTestDb();
    __setDbForTests(db);
    expect(getDb()).toBe(db);
    __setDbForTests(null);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 test-util.ts**

```ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";

export type Db = BetterSQLite3Database<Record<string, never>>;

export function createTestDb(): Db {
  const sqlite = new Database(":memory:");
  sqlite.pragma("journal_mode = MEMORY");
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return db;
}
```

- [ ] **Step 4: 实现 client.ts**

```ts
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "./test-util";

let instance: Db | null = null;

export function getDb(): Db {
  if (instance) return instance;
  const file = process.env.EVODESK_DB ?? path.join(process.cwd(), "data", "evodesk.db");
  return openDb(file);
}

export function openDb(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  instance = drizzle(sqlite);
  migrate(instance, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  return instance;
}

export function __setDbForTests(db: Db | null) {
  instance = db;
}
```

- [ ] **Step 5: 运行测试(尚无迁移目录,迁移为空操作通过)**

Run: `npm test`
Expected: PASS(migrator 对空目录不报错)。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(db): sqlite client with WAL, lazy migrate, test injection"
```

---

### Task 3: Schema(6 张表)+ 迁移

**Files:**
- Create: `src/lib/db/schema.ts`
- Generate: `drizzle/*.sql`

- [ ] **Step 1: 实现 schema.ts**

```ts
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"), // JSON 数组
  complexity: text("complexity").notNull().default("M"), // S|M|L
  priority: integer("priority").notNull().default(1), // 0低 3紧急
  dueDate: text("due_date"), // ISO 日期 yyyy-mm-dd
  projectId: text("project_id"),
  recurringRuleId: text("recurring_rule_id"),
  status: text("status").notNull().default("inbox"),
  flowTemplateId: text("flow_template_id"),
  outcomeNote: text("outcome_note"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const flowTemplates = sqliteTable("flow_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"), // 适用标签 niche
  complexity: text("complexity").notNull().default("M"),
  version: integer("version").notNull().default(1),
  lineageId: text("lineage_id").notNull(),
  parentId: text("parent_id"),
  origin: text("origin").notNull().default("seed"), // seed|manual|evolution
  status: text("status").notNull().default("active"), // active|experimental|retired
  steps: text("steps").notNull().default("[]"), // JSON,见规格 §5.2
  statRuns: integer("stat_runs").notNull().default(0),
  statSuccessRate: real("stat_success_rate").notNull().default(0),
  statAvgCostUsd: real("stat_avg_cost_usd").notNull().default(0),
  statAvgDurationMs: integer("stat_avg_duration_ms").notNull().default(0),
  statAvgSatisfaction: real("stat_avg_satisfaction").notNull().default(0),
  statLastUsedAt: text("stat_last_used_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const executors = sqliteTable("executors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull().default("llm"), // llm|manual|script
  role: text("role").notNull().default("executor"), // triage|planner|executor|reviewer|evolution
  model: text("model"),
  providerProfileId: text("provider_profile_id"),
  apiBase: text("api_base"),
  protocol: text("protocol").notNull().default("openai"), // openai|anthropic
  apiKeyRef: text("api_key_ref"), // env:NAME | plain:xxx
  costPer1kInput: real("cost_per_1k_input").notNull().default(0),
  costPer1kOutput: real("cost_per_1k_output").notNull().default(0),
  shell: text("shell"), // powershell|cmd|bash|python(script 用)
  commandTemplate: text("command_template"),
  workingDir: text("working_dir"),
  timeoutMs: integer("timeout_ms").notNull().default(60000),
  autoApprove: integer("auto_approve", { mode: "boolean" }).notNull().default(false),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
});

export const recurringRules = sqliteTable("recurring_rules", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  tags: text("tags").notNull().default("[]"),
  complexity: text("complexity").notNull().default("S"),
  priority: integer("priority").notNull().default(1),
  projectId: text("project_id"),
  freq: text("freq").notNull(), // daily|weekdays|weekly
  weekday: integer("weekday"), // weekly 用 0-6(周日=0)
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  nextRunAt: text("next_run_at").notNull(), // ISO
  lastTaskId: text("last_task_id"),
  createdAt: text("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON
});
```

- [ ] **Step 2: 生成迁移**

Run: `npm run db:generate`
Expected: `drizzle/` 下生成 `0000_*.sql` 与 meta。

- [ ] **Step 3: 验证测试仍通过(迁移建表成功)**

Run: `npm test`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(db): schema for tasks/projects/templates/executors/recurring/settings"
```

---

### Task 4: 任务状态机

**Files:**
- Create: `src/lib/domain/status.ts`
- Test: `src/lib/domain/status.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/domain/status.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { canTransition } from "./status";

describe("task status machine", () => {
  it("inbox → triaging/ready/canceled 合法", () => {
    expect(canTransition("inbox", "triaging")).toBe(true);
    expect(canTransition("inbox", "ready")).toBe(true);
    expect(canTransition("inbox", "canceled")).toBe(true);
  });
  it("inbox → running 非法", () => {
    expect(canTransition("inbox", "running")).toBe(false);
  });
  it("done → archived 合法,archived 终态", () => {
    expect(canTransition("done", "archived")).toBe(true);
    expect(canTransition("archived", "done")).toBe(false);
  });
  it("canceled 可回 inbox(重新打开)", () => {
    expect(canTransition("canceled", "inbox")).toBe(true);
  });
  it("review → done 合法,running → review 非法(须经 waiting_human 之外路径允许取消)", () => {
    expect(canTransition("review", "done")).toBe(true);
    expect(canTransition("running", "review")).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL。

- [ ] **Step 3: 实现 status.ts**

```ts
export const TASK_STATUSES = [
  "inbox", "triaging", "ready", "running", "waiting_human",
  "review", "done", "archived", "canceled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

const ALLOWED: Record<TaskStatus, TaskStatus[]> = {
  inbox: ["triaging", "ready", "canceled"],
  triaging: ["ready", "inbox", "canceled"],
  ready: ["running", "inbox", "canceled"],
  running: ["waiting_human", "review", "ready", "canceled"],
  waiting_human: ["running", "review", "ready", "canceled"],
  review: ["done", "running", "canceled"],
  done: ["archived"],
  archived: [],
  canceled: ["inbox"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}
```
(注:`running → review` 在规格 §6 画向 review,但执行引擎实现中 review 前必经 checkpoint 步骤置 waiting_human;此处按计划 2 的 runner 需要收紧,M2 阶段手动流转不涉及。)

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): task status machine with guarded transitions"
```

---

### Task 5: LLM 双协议客户端

**Files:**
- Create: `src/lib/llm/client.ts`
- Test: `src/lib/llm/client.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/llm/client.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { callLlm, callLlmWithRetry, resolveApiKey } from "./client";

const okOpenai = () =>
  new Response(JSON.stringify({ choices: [{ message: { content: "你好" } }], usage: { prompt_tokens: 10, completion_tokens: 5 }, model: "m1" }), { status: 200 });
const okAnthropic = () =>
  new Response(JSON.stringify({ content: [{ text: "Bonjour" }], usage: { input_tokens: 7, output_tokens: 3 }, model: "m2" }), { status: 200 });

describe("resolveApiKey", () => {
  it("env: 前缀读环境变量,plain: 取原文", () => {
    process.env.TEST_KEY = "abc";
    expect(resolveApiKey("env:TEST_KEY")).toBe("abc");
    expect(resolveApiKey("plain:xyz")).toBe("xyz");
    expect(resolveApiKey(null)).toBe("");
  });
});

describe("callLlm", () => {
  it("openai 协议:POST {base}/chat/completions 并解析", async () => {
    const f = vi.fn().mockResolvedValue(okOpenai());
    const r = await callLlm({ model: "m1", apiBase: "https://x/v1", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    expect(f.mock.calls[0][0]).toBe("https://x/v1/chat/completions");
    expect(r).toMatchObject({ text: "你好", tokensIn: 10, tokensOut: 5, model: "m1" });
  });
  it("anthropic 协议:POST {base}/v1/messages,system 抽出,Bearer 鉴权", async () => {
    const f = vi.fn().mockResolvedValue(okAnthropic());
    const r = await callLlm({ model: "m2", apiBase: "https://y/api/anthropic", protocol: "anthropic", apiKey: "k" },
      [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }], f as typeof fetch);
    const body = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(f.mock.calls[0][0]).toBe("https://y/api/anthropic/v1/messages");
    expect(body.system).toBe("be brief");
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    const headers = (f.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer k");
    expect(r).toMatchObject({ text: "Bonjour", tokensIn: 7, tokensOut: 3, model: "m2" });
  });
  it("非 2xx 抛错", async () => {
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    await expect(callLlm({ model: "m", apiBase: "https://x", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch)).rejects.toThrow(/500/);
  });
  it("重试一次后成功", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("boom", { status: 502 })).mockResolvedValueOnce(okOpenai());
    const r = await callLlmWithRetry({ model: "m", apiBase: "https://x", protocol: "openai", apiKey: "k" }, [{ role: "user", content: "hi" }], f as typeof fetch);
    expect(r.text).toBe("你好");
    expect(f).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL(模块不存在)。

- [ ] **Step 3: 实现 client.ts**

```ts
export interface LlmMessage { role: "system" | "user" | "assistant"; content: string }
export interface LlmResult { text: string; tokensIn: number; tokensOut: number; model: string }
export interface LlmConfig { model: string; apiBase: string; protocol: "openai" | "anthropic"; apiKey: string }

export function resolveApiKey(ref: string | null): string {
  if (!ref) return "";
  if (ref.startsWith("env:")) return process.env[ref.slice(4)] ?? "";
  if (ref.startsWith("plain:")) return ref.slice(6);
  return "";
}

export async function callLlm(cfg: LlmConfig, messages: LlmMessage[], fetchImpl: typeof fetch = fetch): Promise<LlmResult> {
  if (cfg.protocol === "anthropic") {
    const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n") || undefined;
    const rest = messages.filter((m) => m.role !== "system");
    const res = await fetchImpl(`${cfg.apiBase}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}`, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: cfg.model, max_tokens: 4096, system, messages: rest }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return { text: data.content?.[0]?.text ?? "", tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0, model: data.model };
  }
  const res = await fetchImpl(`${cfg.apiBase}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, messages }),
  });
  if (!res.ok) throw new Error(`openai ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content ?? "", tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0, model: data.model };
}

export async function callLlmWithRetry(cfg: LlmConfig, messages: LlmMessage[], fetchImpl: typeof fetch = fetch): Promise<LlmResult> {
  try {
    return await callLlm(cfg, messages, fetchImpl);
  } catch {
    await new Promise((r) => setTimeout(r, 300));
    return await callLlm(cfg, messages, fetchImpl);
  }
}

export function executorLlmConfig(ex: { type: string; model: string | null; apiBase: string | null; protocol: string | null; apiKeyRef: string | null }): LlmConfig {
  if (ex.type !== "llm" || !ex.model || !ex.apiBase) throw new Error(`执行器未配置模型或端点`);
  return { model: ex.model, apiBase: ex.apiBase, protocol: ex.protocol === "anthropic" ? "anthropic" : "openai", apiKey: resolveApiKey(ex.apiKeyRef) };
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(llm): dual-protocol fetch client (openai/anthropic) with retry"
```

---

### Task 6: 模板路由器(niching 打分)

**Files:**
- Create: `src/lib/domain/router.ts`
- Test: `src/lib/domain/router.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/domain/router.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { scoreTemplate, routeTemplate } from "./router";

const t = (o: Partial<Parameters<typeof scoreTemplate>[0]>): Parameters<typeof scoreTemplate>[0] => ({
  id: "t", tags: "[]", complexity: "M", status: "active",
  statSuccessRate: 0, statAvgCostUsd: 0, statLastUsedAt: null, ...o,
});
const NOW = new Date("2026-09-06T00:00:00Z");

describe("scoreTemplate", () => {
  it("标签交集×3 + 复杂度匹配×2 + 成功率", () => {
    const s = scoreTemplate(t({ tags: '["写作","研究"]', complexity: "L", statSuccessRate: 0.8 }), ["写作"], "L", NOW);
    expect(s).toBeCloseTo(3 + 2 + 0.8);
  });
  it("30 天内使用过 +0.5", () => {
    const s1 = scoreTemplate(t({ statLastUsedAt: "2026-09-01T00:00:00Z" }), [], "M", NOW);
    const s2 = scoreTemplate(t({ statLastUsedAt: "2026-01-01T00:00:00Z" }), [], "M", NOW);
    expect(s1 - s2).toBeCloseTo(0.5);
  });
});

describe("routeTemplate", () => {
  it("只考虑 active;打分并列取平均成本低者", () => {
    const a = t({ id: "a", tags: '["写作"]', statAvgCostUsd: 0.5 });
    const b = t({ id: "b", tags: '["写作"]', statAvgCostUsd: 0.1 });
    const c = t({ id: "c", status: "retired", tags: '["写作"]', statAvgCostUsd: 0 });
    expect(routeTemplate([a, b, c], ["写作"], "M", NOW)?.id).toBe("b");
  });
  it("无候选返回 null(调用方 fallback)", () => {
    expect(routeTemplate([], [], "M", NOW)).toBeNull();
    expect(routeTemplate([t({ status: "retired" })], [], "M", NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL。

- [ ] **Step 3: 实现 router.ts**

```ts
export interface RoutableTemplate {
  id: string; tags: string; complexity: string; status: string;
  statSuccessRate: number; statAvgCostUsd: number; statLastUsedAt: string | null;
}

export function scoreTemplate(t: RoutableTemplate, taskTags: string[], taskComplexity: string, now: Date): number {
  const tTags = JSON.parse(t.tags) as string[];
  const overlap = tTags.filter((x) => taskTags.includes(x)).length;
  let s = overlap * 3 + (t.complexity === taskComplexity ? 2 : 0) + (t.statSuccessRate ?? 0);
  if (t.statLastUsedAt && now.getTime() - new Date(t.statLastUsedAt).getTime() < 30 * 86_400_000) s += 0.5;
  return s;
}

export function routeTemplate<T extends RoutableTemplate>(templates: T[], taskTags: string[], taskComplexity: string, now: Date = new Date()): T | null {
  const active = templates.filter((t) => t.status === "active");
  if (active.length === 0) return null;
  const scored = active.map((t) => ({ t, s: scoreTemplate(t, taskTags, taskComplexity, now) }));
  const max = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s === max).sort((a, b) => a.t.statAvgCostUsd - b.t.statAvgCostUsd);
  return top[0].t;
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): template router with tag niching and cost tie-break"
```

---

### Task 7: 分诊服务

**Files:**
- Create: `src/lib/domain/triage.ts`
- Test: `src/lib/domain/triage.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/domain/triage.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { buildTriagePrompt, parseTriage, triageTask, FALLBACK_TRIAGE } from "./triage";

describe("parseTriage", () => {
  it("解析纯 JSON", () => {
    expect(parseTriage('{"tags":["写作"],"complexity":"M","reason":"r"}')).toEqual({ tags: ["写作"], complexity: "M", reason: "r" });
  });
  it("容忍围栏文本", () => {
    expect(parseTriage('好的:```json\n{"tags":[],"complexity":"S","reason":"x"}\n```')).toEqual({ tags: [], complexity: "S", reason: "x" });
  });
  it("非法返回 null", () => {
    expect(parseTriage("不是 JSON")).toBeNull();
    expect(parseTriage('{"tags":"写作","complexity":"M"}')).toBeNull();
  });
});

describe("triageTask", () => {
  const cfg = { model: "m", apiBase: "https://x", protocol: "openai" as const, apiKey: "k" };
  it("成功:解析 LLM 输出", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"tags":["研究"],"complexity":"L","reason":"ok"}' } }], usage: {}, model: "m" }), { status: 200 }));
    const r = await triageTask({ title: "写论文", description: "AI 方向" }, ["写作", "研究"], cfg, f as typeof fetch);
    expect(r.result.tags).toEqual(["研究"]);
    expect(r.degraded).toBe(false);
  });
  it("两次失败 → 降级 fallback", async () => {
    const f = vi.fn().mockResolvedValue(new Response("boom", { status: 500 }));
    const r = await triageTask({ title: "x", description: "" }, [], cfg, f as typeof fetch);
    expect(r.degraded).toBe(true);
    expect(r.result).toEqual(FALLBACK_TRIAGE);
  });
  it("cfg 为 null(未配模型)→ 直接降级且不调接口", async () => {
    const f = vi.fn();
    const r = await triageTask({ title: "x", description: "" }, [], null, f as typeof fetch);
    expect(r.degraded).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});

describe("buildTriagePrompt", () => {
  it("包含任务与已知标签,要求 JSON 输出", () => {
    const msgs = buildTriagePrompt({ title: "t", description: "d" }, ["写作", "开发"]);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("写作");
    expect(msgs[1].content).toContain("t");
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL。

- [ ] **Step 3: 实现 triage.ts**

```ts
import { z } from "zod";
import { callLlmWithRetry, executorLlmConfig, type LlmConfig, type LlmMessage } from "@/lib/llm/client";

export const TriageResultSchema = z.object({
  tags: z.array(z.string().min(1)).max(5),
  complexity: z.enum(["S", "M", "L"]),
  reason: z.string(),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

export const FALLBACK_TRIAGE: TriageResult = { tags: ["事务"], complexity: "M", reason: "分诊失败,已用默认(标签=事务,复杂度=M)" };

export function buildTriagePrompt(task: { title: string; description: string }, knownTags: string[]): LlmMessage[] {
  return [
    { role: "system", content: `你是任务分诊助手。为任务建议标签与复杂度。可用标签:${knownTags.join("、")}(可新增,最多 5 个)。复杂度:S=琐事(<10 分钟)、M=常规、L=重要需深度处理。只输出 JSON:{"tags":[...],"complexity":"S|M|L","reason":"简短理由"}` },
    { role: "user", content: `任务标题:${task.title}\n任务描述:${task.description || "(无)"}` },
  ];
}

export function parseTriage(raw: string): TriageResult | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return TriageResultSchema.parse(JSON.parse(raw.slice(start, end + 1)));
  } catch {
    return null;
  }
}

export async function triageTask(
  task: { title: string; description: string },
  knownTags: string[],
  cfg: LlmConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<{ result: TriageResult; degraded: boolean }> {
  if (!cfg) return { result: FALLBACK_TRIAGE, degraded: true };
  try {
    const out = await callLlmWithRetry(cfg, buildTriagePrompt(task, knownTags), fetchImpl);
    const parsed = parseTriage(out.text);
    if (parsed) return { result: parsed, degraded: false };
    return { result: FALLBACK_TRIAGE, degraded: true };
  } catch {
    return { result: FALLBACK_TRIAGE, degraded: true };
  }
}

export { executorLlmConfig };
```

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): LLM triage with zod parsing and degraded fallback"
```

---

### Task 8: 周期任务投放器

**Files:**
- Create: `src/lib/domain/recurring.ts`
- Test: `src/lib/domain/recurring.test.ts`

- [ ] **Step 1: 写失败测试**

`src/lib/domain/recurring.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { nextRunAfter, tickRecurring } from "./recurring";
import { createTestDb } from "@/lib/db/test-util";
import { recurringRules, tasks } from "@/lib/db/schema";

const NOW = new Date("2026-09-06T08:00:00Z"); // 周日

function rule(o: Partial<typeof recurringRules.$inferInsert>) {
  return {
    id: crypto.randomUUID(), title: "英语学习", tags: "[]", complexity: "S", priority: 1,
    freq: "daily", enabled: true, nextRunAt: "2026-09-06T00:00:00Z", createdAt: "2026-09-01T00:00:00Z", ...o,
  } as typeof recurringRules.$inferInsert;
}

describe("nextRunAfter", () => {
  it("daily:次日", () => {
    expect(nextRunAfter("daily", null, new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-07T00:00:00.000Z");
  });
  it("weekdays:周五 → 下周一", () => {
    expect(nextRunAfter("weekdays", null, new Date("2026-09-04T00:00:00Z"))).toBe("2026-09-07T00:00:00.000Z");
  });
  it("weekly(weekday=3 周三):周日 → 周三", () => {
    expect(nextRunAfter("weekly", 3, new Date("2026-09-06T00:00:00Z"))).toBe("2026-09-09T00:00:00.000Z");
  });
});

describe("tickRecurring", () => {
  it("到期生成任务并推进 next_run_at", () => {
    const db = createTestDb();
    db.insert(recurringRules).values(rule({})).run();
    const n = tickRecurring(db, NOW);
    expect(n).toBe(1);
    const t = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
    expect(t[0].title).toBe("英语学习");
    expect(t[0].dueDate).toBe("2026-09-06");
    expect(t[0].recurringRuleId).toBeTruthy();
    const r = db.select().from(recurringRules).all() as (typeof recurringRules.$inferSelect)[];
    expect(r[0].nextRunAt).toBe("2026-09-07T00:00:00.000Z");
  });
  it("错过多天补齐为多条实例(上限 31)", () => {
    const db = createTestDb();
    db.insert(recurringRules).values(rule({ nextRunAt: "2026-08-01T00:00:00Z" })).run();
    const n = tickRecurring(db, NOW);
    expect(n).toBe(31); // 触发上限保护
  });
  it("未启用或未到期不生成", () => {
    const db = createTestDb();
    db.insert(recurringRules).values([rule({ enabled: false }), rule({ id: crypto.randomUUID(), title: "x", freq: "daily", enabled: true, nextRunAt: "2026-09-30T00:00:00Z", createdAt: "2026-09-01T00:00:00Z" })]).run();
    expect(tickRecurring(db, NOW)).toBe(0);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL。

- [ ] **Step 3: 实现 recurring.ts**

```ts
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db/test-util";
import { recurringRules, tasks } from "@/lib/db/schema";

export type Freq = "daily" | "weekdays" | "weekly";

export function nextRunAfter(freq: Freq, weekday: number | null, from: Date): string {
  const d = new Date(from);
  d.setDate(d.getDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  if (freq === "daily") return d.toISOString();
  if (freq === "weekdays") {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }
  const target = weekday ?? 1;
  while (d.getUTCDay() !== target) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

export function tickRecurring(db: Db, now: Date = new Date()): number {
  const rules = db.select().from(recurringRules).where(eq(recurringRules.enabled, true)).all() as (typeof recurringRules.$inferSelect)[];
  let created = 0;
  for (const r of rules) {
    let guard = 0;
    while (new Date(r.nextRunAt) <= now && guard < 31) {
      const due = r.nextRunAt.slice(0, 10);
      const id = crypto.randomUUID();
      db.insert(tasks).values({
        id, title: r.title, description: r.description, tags: r.tags, complexity: r.complexity,
        priority: r.priority, projectId: r.projectId, recurringRuleId: r.id,
        status: "inbox", dueDate: due, createdAt: now.toISOString(), updatedAt: now.toISOString(),
      }).run();
      created++;
      r.nextRunAt = nextRunAfter(r.freq as Freq, r.weekday, new Date(r.nextRunAt));
      guard++;
    }
    if (guard > 0) db.update(recurringRules).set({ nextRunAt: r.nextRunAt, lastTaskId: null }).where(eq(recurringRules.id, r.id)).run();
  }
  return created;
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(domain): recurring rules ticker with catch-up cap"
```

---

### Task 9: 种子数据

**Files:**
- Create: `src/lib/db/seed.ts`
- Test: `src/lib/db/seed.test.ts`

- [ ] **Step 1: 写失败测试(幂等 + 内容齐)**

`src/lib/db/seed.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createTestDb } from "./test-util";
import { seedIfEmpty } from "./seed";
import { tasks, projects, flowTemplates, executors, recurringRules, settings } from "./schema";

describe("seedIfEmpty", () => {
  it("首播:4 模板/4 执行器/2 项目/2 规则/5 示例任务/设置;幂等:再跑不增", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    seedIfEmpty(db);
    expect((db.select().from(flowTemplates).all() as unknown[]).length).toBe(4);
    expect((db.select().from(executors).all() as unknown[]).length).toBe(4);
    expect((db.select().from(projects).all() as unknown[]).length).toBe(2);
    expect((db.select().from(recurringRules).all() as unknown[]).length).toBe(2);
    expect((db.select().from(tasks).all() as unknown[]).length).toBe(5);
    expect((db.select().from(settings).all() as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
  it("种子执行器含人工与两个未启用的模型占位", () => {
    const db = createTestDb();
    seedIfEmpty(db);
    const ex = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    expect(ex.filter((e) => e.type === "manual").length).toBe(1);
    expect(ex.filter((e) => e.type === "llm" && !e.enabled).length).toBe(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL。

- [ ] **Step 3: 实现 seed.ts**

```ts
import type { Db } from "./test-util";
import { flowTemplates, executors, projects, recurringRules, settings, tasks } from "./schema";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const tomorrow = () => {
  const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString();
};

const T = (name: string, complexity: string, tags: string[], steps: unknown[]) => ({
  id: id(), name, description: "", tags: JSON.stringify(tags), complexity, version: 1,
  lineageId: id(), origin: "seed", status: "active", steps: JSON.stringify(steps),
  createdAt: now(), updatedAt: now(),
});

export function seedIfEmpty(db: Db): void {
  const has = (db.select().from(tasks).all() as unknown[]).length > 0
    || (db.select().from(flowTemplates).all() as unknown[]).length > 0;
  if (has) return;

  db.insert(flowTemplates).values([
    T("S 轻量通道", "S", [], [
      { name: "快速执行", type: "llm", executorRole: "executor", prompt: "直接完成任务:{{task.title}}\n{{task.description}}", optional: false },
      { name: "交付确认", type: "checkpoint", instruction: "确认产出满足预期", optional: false },
    ]),
    T("M 标准流程", "M", [], [
      { name: "任务澄清", type: "llm", executorRole: "planner", prompt: "澄清任务目标与边界:{{task.title}}\n{{task.description}}", optional: false },
      { name: "执行", type: "llm", executorRole: "executor", prompt: "完成任务:{{task.title}}\n{{task.description}}\n参考上一步:\n{{prev_output}}", optional: false },
      { name: "自检", type: "llm", executorRole: "reviewer", prompt: "检查产出是否完整可用:\n{{prev_output}}", optional: false },
      { name: "交付审核", type: "checkpoint", instruction: "对照完成标准检查", optional: false },
    ]),
    T("L 深度流程", "L", [], [
      { name: "规划", type: "llm", executorRole: "planner", prompt: "制定分步计划:{{task.title}}\n{{task.description}}", optional: false },
      { name: "收集素材", type: "manual", instruction: "手动整理参考资料并粘贴到下方", optional: true },
      { name: "执行", type: "llm", executorRole: "executor", prompt: "按计划执行:{{task.title}}\n{{task.description}}\n计划:\n{{prev_output}}", optional: false },
      { name: "审查", type: "llm", executorRole: "reviewer", prompt: "严格审查:\n{{prev_output}}", optional: false },
      { name: "修订", type: "llm", executorRole: "executor", prompt: "按审查意见修订:\n{{prev_output}}", optional: false },
      { name: "交付审核", type: "checkpoint", instruction: "最终确认", optional: false },
    ]),
    T("资讯摘要", "M", ["研究"], [
      { name: "要点提取", type: "llm", executorRole: "executor", prompt: "从以下资讯中提取 5 条要点:\n{{task.description}}", optional: false },
      { name: "摘要卡生成", type: "llm", executorRole: "executor", prompt: "把要点整理成 200 字内摘要卡:\n{{prev_output}}", optional: false },
      { name: "归档确认", type: "checkpoint", instruction: "确认摘要准确后归档到笔记", optional: false },
    ]),
  ]).run();

  db.insert(executors).values([
    { id: id(), name: "人工", type: "manual", role: "executor", enabled: true, createdAt: now() },
    { id: id(), name: "快速模型", type: "llm", role: "triage", model: "YOUR_FAST_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_FAST_KEY", enabled: false, createdAt: now() },
    { id: id(), name: "强模型", type: "llm", role: "planner", model: "YOUR_STRONG_MODEL", apiBase: "https://api.openai.com/v1", protocol: "openai", apiKeyRef: "env:EVODESK_STRONG_KEY", enabled: false, createdAt: now() },
    { id: id(), name: "PowerShell 本地执行", type: "script", role: "executor", shell: "powershell", workingDir: "data/sandbox", timeoutMs: 60000, autoApprove: false, enabled: true, createdAt: now() },
  ]).run();

  const p1 = id(), p2 = id();
  db.insert(projects).values([
    { id: p1, name: "工作台开发", color: "#6366f1", createdAt: now() },
    { id: p2, name: "个人成长", color: "#8b5cf6", createdAt: now() },
  ]).run();

  db.insert(recurringRules).values([
    { id: id(), title: "英语学习 30 分钟", tags: '["学习"]', complexity: "S", priority: 1, projectId: p2, freq: "daily", enabled: true, nextRunAt: tomorrow(), createdAt: now() },
    { id: id(), title: "健身 45 分钟", tags: '["健身"]', complexity: "S", priority: 1, projectId: p2, freq: "weekly", weekday: 1, enabled: true, nextRunAt: tomorrow(), createdAt: now() },
  ]).run();

  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  db.insert(tasks).values([
    { id: id(), title: "试用 EvoDesk:把一条任务走完分诊流程", tags: '["事务"]', complexity: "S", status: "inbox", createdAt: now(), updatedAt: now() },
    { id: id(), title: "阅读行业周报并摘要", tags: '["研究"]', complexity: "M", status: "inbox", projectId: p1, createdAt: now(), updatedAt: now() },
    { id: id(), title: "整理 Obsidian 笔记目录", tags: '["事务"]', complexity: "M", status: "ready", dueDate: today, projectId: p1, createdAt: now(), updatedAt: now() },
    { id: id(), title: "体检预约", tags: '["生活"]', complexity: "S", status: "ready", dueDate: yesterday, createdAt: now(), updatedAt: now() },
    { id: id(), title: "配置每日站会要点模板", tags: '["事务"]', complexity: "M", status: "done", projectId: p1, createdAt: now(), updatedAt: now() },
  ]).run();

  db.insert(settings).values([
    { key: "theme", value: '"dark"' },
    { key: "cost_budget_usd", value: "10" },
    { key: "vault_path", value: '"D:\\\\work\\\\Obsidian\\\\Obsidian"' },
    { key: "known_tags", value: '["写作","研究","事务","开发","生活","学习","健身"]' },
    { key: "waiting_human_timeout_hours", value: "24" },
  ]).run();
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): idempotent seed (templates/executors/projects/rules/sample tasks/settings)"
```

---

### Task 10: API /api/tasks(列表 + 新建)

**Files:**
- Create: `src/app/api/tasks/route.ts`
- Test: `src/app/api/tasks/route.test.ts`

- [ ] **Step 1: 写失败测试**

`src/app/api/tasks/route.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, POST } from "./route";

function req(url: string, init?: RequestInit) {
  return new NextRequest(`http://localhost${url}`, init);
}

beforeEach(() => {
  const db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
});

describe("GET /api/tasks", () => {
  it("返回任务数组且触发周期投放(到期规则生成实例)", async () => {
    const res = await GET(req("/api/tasks"));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tasks)).toBe(true);
    expect(data.tasks.length).toBeGreaterThanOrEqual(5);
  });
  it("status 过滤生效", async () => {
    const res = await GET(req("/api/tasks?status=ready"));
    const data = await res.json();
    expect(data.tasks.every((t: { status: string }) => t.status === "ready")).toBe(true);
  });
});

describe("POST /api/tasks", () => {
  it("创建任务进收件箱", async () => {
    const res = await POST(req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "新任务", tags: ["写作"] }) }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.task.status).toBe("inbox");
    expect(data.task.title).toBe("新任务");
  });
  it("缺标题返回 400", async () => {
    const res = await POST(req("/api/tasks", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL(route 不存在)。

- [ ] **Step 3: 实现 route.ts**

```ts
import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = getDb();
  tickRecurring(db);
  const status = req.nextUrl.searchParams.get("status");
  const projectId = req.nextUrl.searchParams.get("project_id");
  const rows = status
    ? db.select().from(tasks).where(eq(tasks.status, status)).orderBy(desc(tasks.createdAt)).all()
    : db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();
  const filtered = projectId ? rows.filter((t) => t.projectId === projectId) : rows;
  return NextResponse.json({ tasks: filtered });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title 必填" }, { status: 400 });
  }
  const db = getDb();
  const nowIso = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    description: typeof body.description === "string" ? body.description : "",
    tags: JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 5) : []),
    complexity: ["S", "M", "L"].includes(body.complexity) ? body.complexity : "M",
    priority: Number.isInteger(body.priority) ? Math.min(3, Math.max(0, body.priority)) : 1,
    dueDate: typeof body.due_date === "string" ? body.due_date : null,
    projectId: typeof body.project_id === "string" ? body.project_id : null,
    status: "inbox" as const,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  db.insert(tasks).values(task).run();
  return NextResponse.json({ task }, { status: 201 });
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): tasks list (with recurring tick) and create endpoints"
```

---

### Task 11: API /api/tasks/[id](详情 + 更新,状态机校验)

**Files:**
- Create: `src/app/api/tasks/[id]/route.ts`
- Test: `src/app/api/tasks/[id]/route.test.ts`

- [ ] **Step 1: 写失败测试**

`src/app/api/tasks/[id]/route.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, PATCH } from "./route";
import { POST as POST_LIST } from "../route";

function req(url: string, init?: RequestInit) {
  return new NextRequest(`http://localhost${url}`, init);
}
let taskId = "";
beforeEach(async () => {
  const db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  const res = await POST_LIST(req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "临时" }) }));
  taskId = (await res.json()).task.id;
});

describe("GET /api/tasks/[id]", () => {
  it("返回详情;不存在 404", async () => {
    expect((await GET(req(`/api/tasks/${taskId}`), { params: Promise.resolve({ id: taskId }) })).status).toBe(200);
    expect((await GET(req("/api/tasks/nope"), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
  });
});

describe("PATCH /api/tasks/[id]", () => {
  it("合法流转 inbox→ready", async () => {
    const res = await PATCH(req(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "ready" }) }), { params: Promise.resolve({ id: taskId }) });
    const data = await res.json();
    expect(data.task.status).toBe("ready");
  });
  it("非法流转 inbox→done 返回 422", async () => {
    const res = await PATCH(req(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "done" }) }), { params: Promise.resolve({ id: taskId }) });
    expect(res.status).toBe(422);
  });
  it("可更新标题与标签", async () => {
    const res = await PATCH(req(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ title: "改名", tags: ["开发"] }) }), { params: Promise.resolve({ id: taskId }) });
    const data = await res.json();
    expect(data.task.title).toBe("改名");
    expect(data.task.tags).toEqual(["开发"]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL。

- [ ] **Step 3: 实现 route.ts**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { canTransition, TASK_STATUSES, type TaskStatus } from "@/lib/domain/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 到期日只接受 yyyy-mm-dd(schema 头注的 UTC-ISO 约定:领域代码依赖字典序比较)。
// 空串/垃圾值静默归一为 null 而非 400,保持个人工具的录入摩擦最小。(Task 10 评审修正,POST/PATCH 共用)
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const normDate = (v: unknown): string | null =>
  typeof v === "string" && dateRe.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const row = (await getDb().select().from(tasks).where(eq(tasks.id, id)).all())[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ task: row });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  const rows = db.select().from(tasks).where(eq(tasks.id, id)).all();
  const current = rows[0];
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));

  const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.description === "string") patch.description = body.description;
  if (Array.isArray(body.tags)) patch.tags = JSON.stringify(body.tags.slice(0, 5));
  if (["S", "M", "L"].includes(body.complexity)) patch.complexity = body.complexity;
  if (Number.isInteger(body.priority)) patch.priority = Math.min(3, Math.max(0, body.priority));
  if ("due_date" in body) patch.dueDate = normDate(body.due_date);
  if ("project_id" in body) patch.projectId = typeof body.project_id === "string" ? body.project_id : null;
  if ("flow_template_id" in body) patch.flowTemplateId = typeof body.flow_template_id === "string" ? body.flow_template_id : null;

  if (typeof body.status === "string") {
    if (!TASK_STATUSES.includes(body.status as TaskStatus)) return NextResponse.json({ error: "未知状态" }, { status: 400 });
    if (!canTransition(current.status as TaskStatus, body.status as TaskStatus)) {
      return NextResponse.json({ error: `非法流转 ${current.status} → ${body.status}` }, { status: 422 });
    }
    patch.status = body.status;
  }

  db.update(tasks).set(patch).where(eq(tasks.id, id)).run();
  const updated = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
  return NextResponse.json({ task: updated });
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): task detail/update with status-machine guard"
```

---

### Task 12: API 分诊与就绪确认

**Files:**
- Create: `src/app/api/tasks/[id]/triage/route.ts`
- Test: `src/app/api/tasks/[id]/triage/route.test.ts`

- [ ] **Step 1: 写失败测试**

`src/app/api/tasks/[id]/triage/route.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { tasks, executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { POST as POST_LIST } from "../../route";

function req(url: string, init?: RequestInit) {
  return new NextRequest(`http://localhost${url}`, init);
}
let taskId = "";
let db: ReturnType<typeof createTestDb>;
beforeEach(async () => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  const res = await POST_LIST(req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "写行业周报摘要" }) }));
  taskId = (await res.json()).task.id;
});

describe("POST /api/tasks/[id]/triage", () => {
  it("无可用 LLM 执行器 → 降级 fallback,任务状态 triaging", async () => {
    const res = await POST(req(`/api/tasks/${taskId}/triage`), { params: Promise.resolve({ id: taskId }) });
    const data = await res.json();
    expect(data.degraded).toBe(true);
    expect(data.task.status).toBe("triaging");
    expect(data.task.complexity).toBe("M");
  });
  it("启用一个 mock 执行器(注入 fetch)→ 成功分诊并路由到模板", async () => {
    db.update(executors).set({ enabled: true, model: "m1", apiBase: "https://x" }).where(eq(executors.name, "快速模型")).run();
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"tags":["研究"],"complexity":"M","reason":"ok"}' } }], usage: {}, model: "m1" }), { status: 200 }));
    // 通过全局 stub 注入 fetch(callLlmWithRetry 默认参数取全局 fetch)
    vi.stubGlobal("fetch", f);
    const res = await POST(req(`/api/tasks/${taskId}/triage`), { params: Promise.resolve({ id: taskId }) });
    const data = await res.json();
    vi.unstubAllGlobals();
    expect(data.degraded).toBe(false);
    expect(data.task.tags).toEqual(["研究"]);
    expect(data.task.flow_template_id).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test`
Expected: FAIL。

- [ ] **Step 3: 实现 route.ts**

```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks, executors, settings } from "@/lib/db/schema";
import { executorLlmConfig } from "@/lib/llm/client";
import { triageTask } from "@/lib/domain/triage";
import { routeTemplate } from "@/lib/domain/router";
import { flowTemplates } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const task = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
  if (!task) return NextResponse.json({ error: "not found" }, { status: 404 });

  const knownTags = JSON.parse((db.select().from(settings).where(eq(settings.key, "known_tags")).all()[0] ?? { value: "[]" }).value) as string[];
  const triageEx = (db.select().from(executors).all() as (typeof executors.$inferSelect)[])
    .find((e) => e.type === "llm" && e.enabled && (e.role === "triage" || e.role === "executor"));
  let cfg = null;
  try {
    cfg = triageEx ? executorLlmConfig(triageEx) : null;
  } catch {
    cfg = null;
  }

  const { result, degraded } = await triageTask(
    { title: task.title, description: task.description },
    knownTags, cfg,
  );

  const templates = db.select().from(flowTemplates).all() as unknown as Parameters<typeof routeTemplate>[0];
  const matched = routeTemplate(templates, result.tags, result.complexity);

  const nowIso = new Date().toISOString();
  db.update(tasks).set({
    tags: JSON.stringify(result.tags),
    complexity: result.complexity,
    flowTemplateId: task.flowTemplateId ?? matched?.id ?? null,
    status: "triaging",
    updatedAt: nowIso,
  }).where(eq(tasks.id, id)).run();

  const updated = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
  return NextResponse.json({ task: updated, suggestion: result, degraded, matched_template_id: matched?.id ?? null });
}
```

- [ ] **Step 4: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(api): triage endpoint with router match and degraded mode"
```

---

### Task 13: API projects / recurring-rules / settings

**Files:**
- Create: `src/app/api/projects/route.ts`、`src/app/api/projects/[id]/route.ts`、`src/app/api/recurring-rules/route.ts`、`src/app/api/recurring-rules/tick/route.ts`、`src/app/api/settings/route.ts`
- Test: `src/app/api/projects/route.test.ts`、`src/app/api/recurring-rules/route.test.ts`、`src/app/api/settings/route.test.ts`

- [ ] **Step 1: 写失败测试(projects)**

`src/app/api/projects/route.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, POST } from "./route";

const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init);
beforeEach(() => { const db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

describe("projects", () => {
  it("GET 返回种子项目;POST 创建", async () => {
    const list = await (await GET(req("/api/projects"))).json();
    expect(list.projects.length).toBe(2);
    const created = await (await POST(req("/api/projects", { method: "POST", body: JSON.stringify({ name: "副业" }) }))).json();
    expect(created.project.name).toBe("副业");
  });
  it("POST 缺 name 返回 400", async () => {
    expect((await POST(req("/api/projects", { method: "POST", body: JSON.stringify({}) }))).status).toBe(400);
  });
});
```

- [ ] **Step 2: 写失败测试(recurring + settings)**

`src/app/api/recurring-rules/route.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, POST } from "./route";
import { POST as POST_TICK } from "./tick/route";

const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init);
beforeEach(() => { const db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

describe("recurring-rules", () => {
  it("GET 返回规则;POST 创建 weekly 规则", async () => {
    const list = await (await GET(req("/api/recurring-rules"))).json();
    expect(list.rules.length).toBe(2);
    const res = await POST(req("/api/recurring-rules", { method: "POST", body: JSON.stringify({ title: "周报", freq: "weekly", weekday: 1 }) }));
    expect(res.status).toBe(201);
  });
  it("POST 非法 freq 返回 400", async () => {
    expect((await POST(req("/api/recurring-rules", { method: "POST", body: JSON.stringify({ title: "x", freq: "monthly" }) }))).status).toBe(400);
  });
  it("tick 幂等返回生成数", async () => {
    const r1 = await (await POST_TICK(req("/api/recurring-rules/tick", { method: "POST" }))).json();
    expect(r1.created).toBeGreaterThanOrEqual(0);
  });
});
```

`src/app/api/settings/route.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, PUT } from "./route";

const req = (url: string, init?: RequestInit) => new NextRequest(`http://localhost${url}`, init);
beforeEach(() => { const db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

describe("settings", () => {
  it("GET 返回 KV 对象;PUT 更新一个键", async () => {
    const s1 = await (await GET(req("/api/settings"))).json();
    expect(s1.settings.theme).toBe("dark");
    const r = await (await PUT(req("/api/settings", { method: "PUT", body: JSON.stringify({ cost_budget_usd: 20 }) }))).json();
    expect(r.settings.cost_budget_usd).toBe(20);
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `npm test`
Expected: FAIL。

- [ ] **Step 4: 实现 5 个 route 文件**

`src/app/api/projects/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ projects: getDb().select().from(projects).all() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "name 必填" }, { status: 400 });
  }
  const project = { id: crypto.randomUUID(), name: body.name.trim(), color: typeof body.color === "string" ? body.color : "#6366f1", createdAt: new Date().toISOString() };
  getDb().insert(projects).values(project).run();
  return NextResponse.json({ project }, { status: 201 });
}
```

`src/app/api/projects/[id]/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { projects } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Partial<typeof projects.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.color === "string") patch.color = body.color;
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  getDb().update(projects).set(patch).where(eq(projects.id, id)).run();
  const row = getDb().select().from(projects).where(eq(projects.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project: row });
}
```

`src/app/api/recurring-rules/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { recurringRules } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FREQS = ["daily", "weekdays", "weekly"];

export async function GET() {
  return NextResponse.json({ rules: getDb().select().from(recurringRules).all() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim() || !FREQS.includes(body.freq)) {
    return NextResponse.json({ error: "title 与 freq(daily|weekdays|weekly) 必填" }, { status: 400 });
  }
  if (body.freq === "weekly" && !Number.isInteger(body.weekday)) {
    return NextResponse.json({ error: "weekly 需要 weekday(0-6)" }, { status: 400 });
  }
  const next = new Date(); next.setUTCHours(0, 0, 0, 0); next.setUTCDate(next.getUTCDate() + 1);
  const rule = {
    id: crypto.randomUUID(), title: body.title.trim(), description: typeof body.description === "string" ? body.description : "",
    tags: JSON.stringify(Array.isArray(body.tags) ? body.tags : []), complexity: ["S", "M", "L"].includes(body.complexity) ? body.complexity : "S",
    priority: Number.isInteger(body.priority) ? body.priority : 1,
    projectId: typeof body.project_id === "string" ? body.project_id : null,
    freq: body.freq, weekday: Number.isInteger(body.weekday) ? body.weekday : null,
    enabled: true, nextRunAt: next.toISOString(), createdAt: new Date().toISOString(),
  };
  getDb().insert(recurringRules).values(rule).run();
  return NextResponse.json({ rule }, { status: 201 });
}
```

`src/app/api/recurring-rules/tick/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tickRecurring } from "@/lib/domain/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const created = tickRecurring(getDb());
  return NextResponse.json({ created });
}
```

`src/app/api/settings/route.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = getDb().select().from(settings).all() as { key: string; value: string }[];
  const out: Record<string, unknown> = {};
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
  return NextResponse.json({ settings: out });
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "需要键值对象" }, { status: 400 });
  const db = getDb();
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    const value = JSON.stringify(v);
    if (db.select().from(settings).where(eq(settings.key, k)).all().length > 0) {
      db.update(settings).set({ value }).where(eq(settings.key, k)).run();
    } else {
      db.insert(settings).values({ key: k, value }).run();
    }
  }
  return GET();
}
```

- [ ] **Step 5: 运行测试通过**

Run: `npm test`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(api): projects, recurring-rules (+tick), settings endpoints"
```

---

### Task 14: 主题与布局外壳

**Files:**
- Create: `src/lib/quotes.ts`、`src/components/Sidebar.tsx`、`src/components/TopBar.tsx`、`src/components/Clock.tsx`、`src/components/QuoteOfDay.tsx`、`src/components/QuickAdd.tsx`、`src/components/ThemeToggle.tsx`
- Modify: `src/app/globals.css`、`src/app/layout.tsx`

- [ ] **Step 1: globals.css(深色默认 + 蓝紫强调,变量换肤)**

替换 `src/app/globals.css` 全部内容:
```css
@import "tailwindcss";

:root {
  --bg: #f7f7fb; --surface: #ffffff; --surface-2: #eef0f8; --text: #1a1b2e;
  --muted: #6b6f85; --border: #e2e4f0; --accent: #6366f1; --accent-2: #8b5cf6;
  --danger: #ef4444; --warn: #f59e0b; --ok: #10b981;
}
.dark {
  --bg: #0b0d14; --surface: #141725; --surface-2: #1b1f31; --text: #e7e9f4;
  --muted: #8a90a8; --border: #252a40;
}

html, body { height: 100%; }
body { background: var(--bg); color: var(--text); }

.surface { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; }
.accent-btn {
  background: linear-gradient(135deg, var(--accent), var(--accent-2));
  color: #fff; border-radius: 10px; transition: opacity .15s, transform .15s;
}
.accent-btn:hover { opacity: .9; }
.accent-btn:active { transform: scale(.97); }
.ghost-btn { border: 1px solid var(--border); border-radius: 10px; transition: background .15s; }
.ghost-btn:hover { background: var(--surface-2); }
.input {
  background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px;
  color: var(--text); outline: none;
}
.input:focus { border-color: var(--accent); }
```

- [ ] **Step 2: quotes.ts(10 条内置语句,按日轮换)**

```ts
const QUOTES = [
  "专注当下的一件事,胜过计划十件事。",
  "把大象放进冰箱,也需要先打开门。",
  "今天的三个小步,胜过明天的一个大跃进。",
  "完成,好过完美。",
  "复杂度自适应:琐事快跑,大事深耕。",
  "记录它,然后放下它。",
  "进化来自复盘,不来自重复。",
  "先捕获,再分诊,后执行。",
  "你不需要更多工具,需要更少的犹豫。",
  "休息也是任务队列的一部分。",
];
export function quoteOfDay(d = new Date()): string {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((d.getTime() - start) / 86_400_000);
  return QUOTES[dayOfYear % QUOTES.length];
}
```

- [ ] **Step 3: 组件(Clock / QuoteOfDay / ThemeToggle / QuickAdd / Sidebar / TopBar)**

`src/components/Clock.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";

export function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="text-sm" style={{ color: "var(--muted)" }} />;
  return (
    <span className="text-sm tabular-nums" style={{ color: "var(--muted)" }}>
      {now.toLocaleTimeString("zh-CN", { hour12: false })} · {now.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", weekday: "short" })}
    </span>
  );
}
```

`src/components/QuoteOfDay.tsx`:
```tsx
"use client";
import { quoteOfDay } from "@/lib/quotes";
export function QuoteOfDay() {
  return <span className="hidden md:inline text-sm" style={{ color: "var(--muted)" }}>{quoteOfDay()}</span>;
}
```

`src/components/ThemeToggle.tsx`:
```tsx
"use client";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("evodesk-theme", next ? "dark" : "light");
  };
  return (
    <button onClick={toggle} className="ghost-btn px-3 py-1.5 text-sm" aria-label="切换主题">
      {dark ? "🌙" : "☀️"}
    </button>
  );
}
```

`src/components/QuickAdd.tsx`:
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function QuickAdd() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) });
    setTitle("");
    setBusy(false);
    router.push("/inbox");
    router.refresh();
  };
  return (
    <div className="flex gap-2">
      <input
        className="input px-3 py-1.5 text-sm w-48 md:w-64"
        placeholder="快速新增任务…"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <button onClick={add} className="accent-btn px-3 py-1.5 text-sm">{busy ? "…" : "新增"}</button>
    </div>
  );
}
```

`src/components/Sidebar.tsx`:
```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const I = (d: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const GROUPS: { label: string; items: { href: string; label: string; icon: JSX.Element; ready: boolean }[] }[] = [
  { label: "核心", items: [
    { href: "/", label: "仪表盘", icon: I("M3 12l9-9 9 9M5 10v10h14V10"), ready: true },
    { href: "/inbox", label: "收件箱", icon: I("M22 12h-6l-2 3h-4l-2-3H2M5 5h14l3 7v7H2v-7z"), ready: true },
    { href: "/tasks", label: "任务看板", icon: I("M4 4h6v16H4zM14 4h6v10h-6z"), ready: true },
    { href: "/calendar", label: "日历", icon: I("M8 2v4M16 2v4M3 8h18M5 4h14v18H5z"), ready: false },
  ]},
  { label: "AI", items: [
    { href: "/chat", label: "对话台", icon: I("M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z"), ready: false },
  ]},
  { label: "资产", items: [
    { href: "/flows", label: "流程库", icon: I("M4 6h16M4 12h10M4 18h7"), ready: false },
    { href: "/executors", label: "执行器", icon: I("M12 2v4M12 18v4M2 12h4M18 12h4M12 8a4 4 0 100 8 4 4 0 000-8z"), ready: false },
    { href: "/notes", label: "笔记", icon: I("M4 4h16v16H4zM8 8h8M8 12h8M8 16h5"), ready: false },
    { href: "/vault", label: "知识库", icon: I("M4 19V5a2 2 0 012-2h14v18H6a2 2 0 01-2-2zM8 7h8M8 11h8"), ready: false },
  ]},
  { label: "系统", items: [
    { href: "/settings", label: "设置", icon: I("M12 8a4 4 0 100 8 4 4 0 000-8zM19 12a7 7 0 00-.1-1l2-1.5-2-3.5-2.4 1a7 7 0 00-1.7-1L14.5 3h-5l-.3 2.5a7 7 0 00-1.7 1l-2.4-1-2 3.5L5.1 11a7 7 0 000 2l-2 1.5 2 3.5 2.4-1a7 7 0 001.7 1l.3 2.5h5l.3-2.5a7 7 0 001.7-1l2.4 1 2-3.5-2-1.5c.06-.33.1-.66.1-1z"), ready: true },
  ]},
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden md:flex flex-col gap-4 w-52 shrink-0 p-4" style={{ borderRight: "1px solid var(--border)" }}>
      <div className="text-lg font-bold" style={{ color: "var(--accent)" }}>EvoDesk</div>
      {GROUPS.map((g) => (
        <div key={g.label}>
          <div className="text-xs uppercase mb-1" style={{ color: "var(--muted)" }}>{g.label}</div>
          {g.items.map((it) =>
            it.ready ? (
              <Link key={it.href} href={it.href}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm my-0.5"
                style={pathname === it.href ? { background: "var(--surface-2)", color: "var(--accent)" } : { color: "var(--text)" }}>
                {it.icon}{it.label}
              </Link>
            ) : (
              <span key={it.href} className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm my-0.5 opacity-40 cursor-not-allowed" title="后续版本上线">
                {it.icon}{it.label}
              </span>
            ),
          )}
        </div>
      ))}
    </aside>
  );
}
```

`src/components/TopBar.tsx`:
```tsx
"use client";
import { Clock } from "./Clock";
import { QuoteOfDay } from "./QuoteOfDay";
import { QuickAdd } from "./QuickAdd";
import { ThemeToggle } from "./ThemeToggle";

export function TopBar() {
  return (
    <header className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: "1px solid var(--border)" }}>
      <Clock />
      <QuoteOfDay />
      <div className="ml-auto flex items-center gap-3">
        <QuickAdd />
        <ThemeToggle />
      </div>
    </header>
  );
}
```

- [ ] **Step 4: layout.tsx(主题初始化 + 外壳)**

替换 `src/app/layout.tsx` 全部内容:
```tsx
import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";

export const metadata: Metadata = { title: "EvoDesk · 个人工作台", description: "EvoFlow 式本地优先个人 AI 工作台" };

const themeInit = `(function(){try{var t=localStorage.getItem("evodesk-theme")||"dark";if(t==="dark")document.documentElement.classList.add("dark");}catch(e){document.documentElement.classList.add("dark");}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInit }} /></head>
      <body className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <TopBar />
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
```

- [ ] **Step 5: 验证构建**

Run: `npm run build`
Expected: 构建成功(可能有 eslint 对 JSX namespace 警告;若报 `JSX.Element` 类型错误,将 Sidebar.tsx 中 `JSX.Element` 改为 `React.ReactNode` 并在文件顶部 `import type React from "react"`)。

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(ui): dark-default theme shell, grouped sidebar, clock/quote/quick-add"
```

---

### Task 15: 仪表盘页

**Files:**
- Modify: `src/app/page.tsx`(替换脚手架内容)
- Create: `src/components/TaskCard.tsx`

- [ ] **Step 1: TaskCard 组件**

`src/components/TaskCard.tsx`:
```tsx
import Link from "next/link";
import type { tasks } from "@/lib/db/schema";

type Task = typeof tasks.$inferSelect;

const STATUS_LABEL: Record<string, string> = {
  inbox: "收件箱", triaging: "分诊中", ready: "就绪", running: "执行中",
  waiting_human: "待人工", review: "评审", done: "完成", archived: "归档", canceled: "已取消",
};
const COMPLEXITY_COLOR: Record<string, string> = { S: "var(--ok)", M: "var(--warn)", L: "var(--danger)" };

export function TaskCard({ task, projectName }: { task: Task; projectName?: string }) {
  const tags = JSON.parse(task.tags) as string[];
  return (
    <Link href={`/tasks#task-${task.id}`} className="surface block p-3 mb-2 hover:opacity-90">
      <div className="flex items-center gap-2">
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>{STATUS_LABEL[task.status]}</span>
        <span className="text-xs px-1.5 py-0.5 rounded" style={{ color: COMPLEXITY_COLOR[task.complexity] }}>{task.complexity}</span>
        {task.dueDate && <span className="text-xs" style={{ color: "var(--danger)" }}>{task.dueDate}</span>}
      </div>
      <div className="mt-1 text-sm font-medium">{task.title}</div>
      <div className="mt-1 flex gap-1 flex-wrap">
        {projectName && <span className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)" }}>{projectName}</span>}
        {tags.map((t) => <span key={t} className="text-xs px-1.5 rounded" style={{ background: "var(--surface-2)", color: "var(--muted)" }}>#{t}</span>)}
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: 仪表盘 page.tsx(核心数据 + 今日清单 + 项目进度;M5 再加风险雷达)**

替换 `src/app/page.tsx`:
```tsx
import { getDb } from "@/lib/db/client";
import { tasks, projects } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";
import { TaskCard } from "@/components/TaskCard";

export const dynamic = "force-dynamic";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Dashboard() {
  const db = getDb();
  tickRecurring(db);
  const allTasks = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
  const projectRows = db.select().from(projects).all() as (typeof projects.$inferSelect)[];
  const projectName = (id: string | null) => projectRows.find((p) => p.id === id)?.name;
  const active = allTasks.filter((t) => !["done", "archived", "canceled"].includes(t.status));
  const overdue = active.filter((t) => t.dueDate && t.dueDate < today());
  const dueToday = active.filter((t) => t.dueDate === today());
  const upcoming = active.filter((t) => t.dueDate && t.dueDate > today()).slice(0, 5);
  const counters = [
    { label: "今日待办", value: dueToday.length + overdue.length },
    { label: "执行中", value: allTasks.filter((t) => t.status === "running").length },
    { label: "待人工", value: allTasks.filter((t) => t.status === "waiting_human").length },
    { label: "收件箱", value: allTasks.filter((t) => t.status === "inbox").length },
  ];

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold mb-4">仪表盘</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {counters.map((c) => (
          <div key={c.label} className="surface p-4">
            <div className="text-2xl font-bold">{c.value}</div>
            <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>{c.label}</div>
          </div>
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <section>
          <h2 className="font-semibold mb-2">今日清单(含延期置顶)</h2>
          {[...overdue, ...dueToday].length === 0
            ? <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>今天没有截止任务,安排点小事或休息。</div>
            : [...overdue, ...dueToday].map((t) => <TaskCard key={t.id} task={t} projectName={projectName(t.projectId)} />)}
        </section>
        <section>
          <h2 className="font-semibold mb-2">项目进度</h2>
          {projectRows.map((p) => {
            const pt = allTasks.filter((t) => t.projectId === p.id);
            const done = pt.filter((t) => ["done", "archived"].includes(t.status)).length;
            const pct = pt.length === 0 ? 0 : Math.round((done / pt.length) * 100);
            return (
              <div key={p.id} className="surface p-3 mb-2">
                <div className="flex justify-between text-sm mb-1">
                  <span>{p.name}</span>
                  <span style={{ color: "var(--muted)" }}>{done}/{pt.length} · {pct}%</span>
                </div>
                <div className="h-2 rounded" style={{ background: "var(--surface-2)" }}>
                  <div className="h-2 rounded" style={{ width: `${pct}%`, background: `linear-gradient(90deg, var(--accent), var(--accent-2))` }} />
                </div>
              </div>
            );
          })}
          <h2 className="font-semibold mb-2 mt-4">即将截止</h2>
          {upcoming.length === 0
            ? <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>暂无</div>
            : upcoming.map((t) => <TaskCard key={t.id} task={t} projectName={projectName(t.projectId)} />)}
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证构建**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): dashboard with counters, today list (overdue first), project progress"
```

---

### Task 16: 收件箱页(录入 + 分诊队列)

**Files:**
- Create: `src/app/inbox/page.tsx`、`src/components/TriageCard.tsx`

- [ ] **Step 1: TriageCard 客户端组件(一键分诊 → 确认就绪)**

`src/components/TriageCard.tsx`:
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { tasks, flowTemplates } from "@/lib/db/schema";

type Task = typeof tasks.$inferSelect;
type Template = typeof flowTemplates.$inferSelect;

export function TriageCard({ task, templates }: { task: Task; templates: Template[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [form, setForm] = useState<{ tags: string; complexity: string; templateId: string } | null>(null);

  const triage = async () => {
    setBusy(true);
    const res = await fetch(`/api/tasks/${task.id}/triage`, { method: "POST" });
    const data = await res.json();
    setForm({
      tags: (data.task.tags ?? []).join(","),
      complexity: data.task.complexity,
      templateId: data.task.flow_template_id ?? data.matched_template_id ?? "",
    });
    setNote(data.degraded ? "AI 分诊不可用,已用默认建议,请手动确认。" : `AI 建议:${data.suggestion.reason}`);
    setBusy(false);
    router.refresh();
  };
  const confirm = async () => {
    if (!form) return;
    setBusy(true);
    await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tags: form.tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
        complexity: form.complexity,
        flow_template_id: form.templateId || null,
        status: "ready",
      }),
    });
    setBusy(false);
    setForm(null);
    setNote(null);
    router.refresh();
  };
  return (
    <div className="surface p-3 mb-2">
      <div className="text-sm font-medium">{task.title}</div>
      <div className="flex gap-2 mt-2">
        <button onClick={triage} disabled={busy} className="accent-btn px-3 py-1.5 text-sm">{busy ? "分诊中…" : form ? "重新分诊" : "一键分诊"}</button>
      </div>
      {note && <div className="text-xs mt-2" style={{ color: "var(--muted)" }}>{note}</div>}
      {form && (
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <input className="input px-2 py-1.5 text-sm" placeholder="标签,逗号分隔" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
          <select className="input px-2 py-1.5 text-sm" value={form.complexity} onChange={(e) => setForm({ ...form, complexity: e.target.value })}>
            <option value="S">S 琐事</option><option value="M">M 常规</option><option value="L">L 深度</option>
          </select>
          <select className="input px-2 py-1.5 text-sm" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
            <option value="">(暂不绑定流程)</option>
            {templates.filter((t) => t.status === "active").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <button onClick={confirm} disabled={busy} className="accent-btn px-3 py-1.5 text-sm md:col-span-3">确认,进入就绪</button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 收件箱 page.tsx**

`src/app/inbox/page.tsx`:
```tsx
import { getDb } from "@/lib/db/client";
import { tasks, flowTemplates } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";
import { TriageCard } from "@/components/TriageCard";
import { InboxQuickInput } from "@/components/InboxQuickInput";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  const db = getDb();
  tickRecurring(db);
  const queue = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[])
    .filter((t) => t.status === "inbox" || t.status === "triaging");
  const templates = db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-4">收件箱</h1>
      <InboxQuickInput />
      <div className="mt-6">
        {queue.length === 0
          ? <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>收件箱已清空。用顶部快速新增,或 POST /api/tasks 投递任务。</div>
          : queue.map((t) => <TriageCard key={t.id} task={t} templates={templates} />)}
      </div>
    </div>
  );
}
```

`src/components/InboxQuickInput.tsx`:
```tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function InboxQuickInput() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, description: desc }) });
    setTitle(""); setDesc(""); setBusy(false); router.refresh();
  };
  return (
    <div className="surface p-3">
      <input className="input w-full px-3 py-2 text-sm" placeholder="一句话记录任务…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
      <textarea className="input w-full px-3 py-2 text-sm mt-2" rows={2} placeholder="补充描述(可选,有助 AI 分诊)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <button onClick={add} className="accent-btn px-4 py-1.5 text-sm mt-2">{busy ? "保存中…" : "放入收件箱"}</button>
    </div>
  );
}
```

- [ ] **Step 3: 验证构建**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): inbox with quick capture and triage queue"
```

---

### Task 17: 任务看板页(状态列 + 项目过滤)

**Files:**
- Create: `src/app/tasks/page.tsx`、`src/components/BoardActions.tsx`

- [ ] **Step 1: BoardActions(项目过滤 + 状态操作按钮)**

`src/components/BoardActions.tsx`:
```tsx
"use client";
import { useRouter } from "next/navigation";

export function ProjectFilter({ projects, current }: { projects: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <select className="input px-2 py-1.5 text-sm" value={current} onChange={(e) => router.push(e.target.value ? `/tasks?project=${e.target.value}` : "/tasks")}>
      <option value="">全部项目</option>
      {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
    </select>
  );
}

export function StatusButton({ taskId, to, label }: { taskId: string; to: string; label: string }) {
  const router = useRouter();
  const go = async () => {
    await fetch(`/api/tasks/${taskId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: to }) });
    router.refresh();
  };
  return <button onClick={go} className="ghost-btn px-2 py-1 text-xs">{label}</button>;
}
```

- [ ] **Step 2: 看板 page.tsx**

`src/app/tasks/page.tsx`:
```tsx
import { getDb } from "@/lib/db/client";
import { tasks, projects } from "@/lib/db/schema";
import { ProjectFilter, StatusButton } from "@/components/BoardActions";

export const dynamic = "force-dynamic";

const COLUMNS: { status: string; label: string }[] = [
  { status: "ready", label: "就绪" },
  { status: "running", label: "执行中" },
  { status: "waiting_human", label: "待人工" },
  { status: "review", label: "评审" },
  { status: "done", label: "完成" },
];

const NEXT_ACTIONS: Record<string, { to: string; label: string }[]> = {
  ready: [{ to: "canceled", label: "取消" }],
  review: [{ to: "done", label: "通过完成" }, { to: "canceled", label: "取消" }],
  waiting_human: [{ to: "ready", label: "退回就绪" }],
};

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  const db = getDb();
  const all = db.select().from(tasks).all() as (typeof tasks.$inferSelect)[];
  const projectRows = db.select().from(projects).all() as (typeof projects.$inferSelect)[];
  const shown = project ? all.filter((t) => t.projectId === project) : all;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center gap-4 mb-4">
        <h1 className="text-xl font-bold">任务看板</h1>
        <ProjectFilter projects={projectRows.map((p) => ({ id: p.id, name: p.name }))} current={project ?? ""} />
      </div>
      <div className="grid md:grid-cols-5 gap-3">
        {COLUMNS.map((col) => {
          const list = shown.filter((t) => t.status === col.status);
          return (
            <div key={col.status} className="min-w-0">
              <div className="text-sm font-semibold mb-2">{col.label} <span style={{ color: "var(--muted)" }}>{list.length}</span></div>
              {list.map((t) => (
                <div key={t.id} id={`task-${t.id}`} className="surface p-3 mb-2">
                  <div className="text-sm">{t.title}</div>
                  <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                    {t.complexity}
                    {t.dueDate ? ` · 截止 ${t.dueDate}` : ""}
                    {t.flowTemplateId ? " · 已绑定流程" : ""}
                  </div>
                  <div className="mt-2 flex gap-1 flex-wrap">
                    {(NEXT_ACTIONS[t.status] ?? []).map((a) => (
                      <StatusButton key={a.to} taskId={t.id} to={a.to} label={a.label} />
                    ))}
                  </div>
                </div>
              ))}
              {list.length === 0 && <div className="text-xs p-2" style={{ color: "var(--muted)" }}>空</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 验证构建**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(ui): kanban board with status columns and project filter"
```

---

### Task 18: 设置页

**Files:**
- Create: `src/app/settings/page.tsx`、`src/components/SettingsForm.tsx`

- [ ] **Step 1: SettingsForm 客户端组件**

`src/components/SettingsForm.tsx`:
```tsx
"use client";
import { useState } from "react";

export function SettingsForm({ initial }: { initial: Record<string, unknown> }) {
  const [form, setForm] = useState({
    cost_budget_usd: String(initial.cost_budget_usd ?? 10),
    vault_path: String(initial.vault_path ?? "D:\\work\\Obsidian\\Obsidian"),
    waiting_human_timeout_hours: String(initial.waiting_human_timeout_hours ?? 24),
  });
  const [saved, setSaved] = useState(false);
  const save = async () => {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        cost_budget_usd: Number(form.cost_budget_usd) || 0,
        vault_path: form.vault_path,
        waiting_human_timeout_hours: Number(form.waiting_human_timeout_hours) || 24,
      }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };
  const field = (label: string, key: keyof typeof form) => (
    <label className="block mb-3">
      <span className="text-sm block mb-1">{label}</span>
      <input className="input w-full px-3 py-2 text-sm" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <div className="surface p-4 max-w-xl">
      {field("成本预算(USD,超限进风险雷达)", "cost_budget_usd")}
      {field("Obsidian vault 路径(知识库 M4 接入)", "vault_path")}
      {field("待人工超时阈值(小时)", "waiting_human_timeout_hours")}
      <button onClick={save} className="accent-btn px-4 py-2 text-sm">{saved ? "已保存 ✓" : "保存设置"}</button>
    </div>
  );
}
```

- [ ] **Step 2: 设置 page.tsx**

`src/app/settings/page.tsx`:
```tsx
import { getDb } from "@/lib/db/client";
import { settings } from "@/lib/db/schema";
import { SettingsForm } from "@/components/SettingsForm";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  const rows = getDb().select().from(settings).all() as { key: string; value: string }[];
  const kv: Record<string, unknown> = {};
  for (const r of rows) { try { kv[r.key] = JSON.parse(r.value); } catch { kv[r.key] = r.value; } }
  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-4">设置</h1>
      <div className="surface p-4 mb-4 flex items-center gap-3">
        <span className="text-sm">外观主题</span>
        <ThemeToggle />
        <span className="text-xs" style={{ color: "var(--muted)" }}>深色为默认;切换会保存在浏览器。</span>
      </div>
      <SettingsForm initial={kv} />
    </div>
  );
}
```

- [ ] **Step 3: 验证构建 + 冒烟(启动开发服务器人工核对四页)**

```bash
npm run build
npm run dev &
sleep 8
curl -s http://localhost:3000/api/tasks | head -c 300
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/ http://localhost:3000/inbox http://localhost:3000/tasks http://localhost:3000/settings
```
Expected: API 返回任务 JSON;四个页面均 200。

- [ ] **Step 4: 全量测试回归**

Run: `npm test`
Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): settings page (theme/budget/vault path/timeout)"
```

---

### Task 19: README 与收尾

**Files:**
- Create: `README.md`

- [ ] **Step 1: 写 README.md**

````markdown
# EvoDesk · EvoFlow 式个人 AI 工作台

本地优先的个人工作台:任务收口 → AI 分诊路由 → 流程化执行(后续里程碑)→ 数据反哺流程进化。
设计文档见 `docs/superpowers/specs/`,实施计划见 `docs/superpowers/plans/`。

## 启动

```bash
npm install
npm run dev        # http://localhost:3000
```

数据存于 `data/evodesk.db`(SQLite,WAL)。首次启动自动建表并写入种子数据(示例任务/项目/周期规则/流程模板)。

## 测试

```bash
npm test           # vitest 单测 + API 集成测试
npm run build      # 生产构建
```

## 当前里程碑(M1+M2)能力

- 收件箱:快速录入、AI 一键分诊(标签/复杂度/流程模板,失败自动降级)、确认就绪
- 任务看板:状态分列、项目过滤、手动流转(状态机保护)
- 仪表盘:核心数据、今日清单(延期置顶)、项目进度
- 周期任务:每日/工作日/每周规则,到点自动投放,错过补齐
- 主题:深色(默认)+ 蓝紫强调,浅色可切换;实时时钟与每日语句

## 接入 AI(可选)

分诊默认降级可用。启用 AI 分诊:在数据库或后续"执行器"页配置模型执行器后启用,
或设置环境变量后启用种子执行器(快速模型 `EVODESK_FAST_KEY` / 强模型 `EVODESK_STRONG_KEY`,
默认指向 OpenAI 兼容端点,可改 apiBase 为 Z.ai/DeepSeek/MiMo 等任何兼容端点;
Anthropic 协议端点同样支持)。

## 后续里程碑

M3 执行引擎(runner/SSE/script 安全门)+ AI 对话台;M4 流程库/进化引擎/快捷指令/知识库;M5 风险雷达/日历/统计。
````

- [ ] **Step 2: 最终验证**

```bash
npm test && npm run build
```
Expected: 测试全 PASS,构建成功。

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "docs: README with setup, capabilities, and roadmap"
```

---

## 后续计划(本计划完成后逐个编写)

1. **Plan 2(M3 执行引擎)**:flow_runs/step_runs 表、runner、SSE 流式、script 执行器与 §10.2 安全门、执行视图、provider_profiles + 双协议实战、AI 对话台(chats/chat_messages)。
2. **Plan 3(M4 进化与资产)**:进化引擎(复盘/变体/diff/晋升/淘汰)、流程库页、快捷指令(command/url/launch + 启动器导入器)、笔记速记、Obsidian 知识库。
3. **Plan 4(M5 驾驶舱)**:风险雷达、日历视图、统计页(recharts)、响应式打磨、空态/错误态。
