import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { quickActions, quickActionRuns, providerProfiles } from "@/lib/db/schema";
import { GET, POST, PATCH } from "./route";
import { POST as PREVIEW } from "./preview/route";
import { POST as CONFIRM } from "./[id]/confirm/route";
import { GET as RUNS } from "./runs/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seedIfEmpty(db);
  __setDbForTests(db);
  // command 型 confirm 的默认工作目录(data/sandbox 白名单内),防御性确保存在
  fs.mkdirSync(path.join(process.cwd(), "data", "sandbox"), { recursive: true });
});

type ActionRow = typeof quickActions.$inferSelect;
const insertAction = (over: Partial<typeof quickActions.$inferInsert> = {}): ActionRow => {
  const row = {
    id: crypto.randomUUID(),
    name: "动作",
    type: "command",
    payload: "Write-Output hi",
    shell: null,
    icon: null,
    sort: 0,
    enabled: true,
    createdAt: new Date().toISOString(),
    ...over,
  } as typeof quickActions.$inferInsert;
  db.insert(quickActions).values(row).run();
  return row as ActionRow;
};
const getAction = (id: string): ActionRow | undefined =>
  (db.select().from(quickActions).all() as ActionRow[]).find((a) => a.id === id);

const GENERATED_DIR = path.join(process.cwd(), "data", "generated");
const listGeneratedJson = (): string[] =>
  fs.existsSync(GENERATED_DIR) ? fs.readdirSync(GENERATED_DIR).filter((f) => f.endsWith(".json")) : [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const insertProfile = (over: Partial<typeof providerProfiles.$inferInsert> = {}) => {
  const row = {
    id: crypto.randomUUID(),
    name: "测试档案",
    protocol: "anthropic",
    apiBase: "https://api.example.com",
    apiKeyRef: "plain:sk-test",
    createdAt: new Date().toISOString(),
    ...over,
  } as typeof providerProfiles.$inferInsert;
  db.insert(providerProfiles).values(row).run();
  return row;
};

describe("quick-actions CRUD", () => {
  it("POST command:缺省 shell=powershell;可选 icon/sort/enabled 生效;201", async () => {
    const res = await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "清理沙盒", type: "command", payload: "Get-ChildItem" }) }));
    expect(res.status).toBe(201);
    const a = (await res.json()).action as ActionRow;
    expect(a.shell).toBe("powershell");
    expect(a.enabled).toBe(true);
    expect(a.sort).toBe(0);

    const res2 = await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "带图标", type: "command", payload: "dir", shell: "cmd", icon: "🧹", sort: 5, enabled: false }) }));
    expect(res2.status).toBe(201);
    const b = (await res2.json()).action as ActionRow;
    expect(b.shell).toBe("cmd");
    expect(b.icon).toBe("🧹");
    expect(b.sort).toBe(5);
    expect(b.enabled).toBe(false);
  });
  it("POST 必填校验:name/type/payload 缺一 400;shell 非法 400", async () => {
    expect((await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ type: "command", payload: "x" }) }))).status).toBe(400);
    expect((await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "n", payload: "x" }) }))).status).toBe(400);
    expect((await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "n", type: "command" }) }))).status).toBe(400);
    expect((await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "n", type: "weird", payload: "x" }) }))).status).toBe(400);
    expect((await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "n", type: "command", payload: "x", shell: "sh" }) }))).status).toBe(400);
  });
  it("POST launch:payload 非法 JSON 或缺 profile_id → 400;合法 201", async () => {
    const bad1 = await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "启动", type: "launch", payload: "{ broken" }) }));
    expect(bad1.status).toBe(400);
    expect(((await bad1.json()) as { error: string }).error).toContain("profile_id");
    const bad2 = await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "启动", type: "launch", payload: JSON.stringify({ model: "m" }) }) }));
    expect(bad2.status).toBe(400);
    const ok = await POST(req("/api/quick-actions", { method: "POST", body: JSON.stringify({ name: "启动", type: "launch", payload: JSON.stringify({ profile_id: "p1", model: "glm-x" }) }) }));
    expect(ok.status).toBe(201);
  });
  it("GET:enabled 排前,再 sort asc,再 createdAt asc;runs 含最近 20 条 ts desc", async () => {
    const t0 = "2026-09-01T00:00:00.000Z";
    const t1 = "2026-09-02T00:00:00.000Z";
    const t2 = "2026-09-03T00:00:00.000Z";
    const a = insertAction({ name: "A", enabled: true, sort: 1, createdAt: t0 });
    const b = insertAction({ name: "B", enabled: false, sort: 0, createdAt: t1 });
    const c = insertAction({ name: "C", enabled: true, sort: 0, createdAt: t2 });
    const list = await (await GET(req("/api/quick-actions"))).json();
    expect((list.actions as ActionRow[]).map((x) => x.id)).toEqual([c.id, a.id, b.id]);

    for (let i = 0; i < 22; i++) {
      db.insert(quickActionRuns).values({
        id: crypto.randomUUID(), actionId: a.id, renderedPayload: "p", output: "o",
        status: "ok", durationMs: 0, ts: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
      }).run();
    }
    const list2 = (await (await GET(req("/api/quick-actions"))).json()) as { runs: (typeof quickActionRuns.$inferSelect)[] };
    expect(list2.runs).toHaveLength(20);
    const tsList = list2.runs.map((r) => r.ts);
    expect([...tsList].sort().reverse()).toEqual(tsList);
  });
  it("PATCH:enabled 切换 + 字段更新;未知 id 404;无可更新字段 400;非法值 400", async () => {
    const a = insertAction({ name: "原", enabled: true });
    const r1 = await PATCH(req("/api/quick-actions", { method: "PATCH", body: JSON.stringify({ id: a.id, enabled: false }) }));
    expect(r1.status).toBe(200);
    expect(getAction(a.id)?.enabled).toBe(false);
    const r2 = await PATCH(req("/api/quick-actions", { method: "PATCH", body: JSON.stringify({ id: a.id, enabled: true, name: "新名", sort: 3, icon: "⚡" }) }));
    expect(r2.status).toBe(200);
    const updated = getAction(a.id)!;
    expect(updated.enabled).toBe(true);
    expect(updated.name).toBe("新名");
    expect(updated.sort).toBe(3);
    expect(updated.icon).toBe("⚡");
    expect((await PATCH(req("/api/quick-actions", { method: "PATCH", body: JSON.stringify({ id: "nope", enabled: true }) }))).status).toBe(404);
    expect((await PATCH(req("/api/quick-actions", { method: "PATCH", body: JSON.stringify({ id: a.id }) }))).status).toBe(400);
    expect((await PATCH(req("/api/quick-actions", { method: "PATCH", body: JSON.stringify({ id: a.id, shell: "tcsh" }) }))).status).toBe(400);
  });
});

describe("quick-actions preview", () => {
  it("command:渲染 {{task.title}} + 风险扫描 + workingDir + awaiting", async () => {
    const plain = insertAction({ payload: "Write-Output hi" });
    const p1 = (await (await PREVIEW(req("/api/quick-actions/preview", { method: "POST", body: JSON.stringify({ id: plain.id }) }))).json()) as Record<string, unknown>;
    expect(p1.rendered).toBe("Write-Output hi");
    expect(p1.risks).toEqual([]);
    expect(typeof p1.workingDir).toBe("string");
    expect((p1.workingDir as string).length).toBeGreaterThan(0);
    expect(p1.awaiting).toBe(true);

    const tpl = insertAction({ payload: "echo {{task.title}}" });
    const p2 = (await (await PREVIEW(req("/api/quick-actions/preview", { method: "POST", body: JSON.stringify({ id: tpl.id, task_title: "世界" }) }))).json()) as Record<string, unknown>;
    expect(p2.rendered).toBe("echo 世界");

    const risky = insertAction({ payload: "Remove-Item C:\\x -Recurse -Force" });
    const p3 = (await (await PREVIEW(req("/api/quick-actions/preview", { method: "POST", body: JSON.stringify({ id: risky.id }) }))).json()) as { risks: string[] };
    expect(p3.risks.length).toBeGreaterThan(0);
  });
  it("url:rendered=payload,awaiting:false", async () => {
    const a = insertAction({ type: "url", payload: "https://chat.z.ai" });
    const body = (await (await PREVIEW(req("/api/quick-actions/preview", { method: "POST", body: JSON.stringify({ id: a.id }) }))).json()) as Record<string, unknown>;
    expect(body.rendered).toBe("https://chat.z.ai");
    expect(body.awaiting).toBe(false);
    expect(body.risks).toEqual([]);
  });
  it("launch:dryRun 预览 + settings 文件即时删除(data/generated 无 *.json 残留)", async () => {
    const prof = insertProfile({ apiKeyRef: "plain:sk-test" });
    const workdir = path.join(process.cwd(), "data", "sandbox");
    const a = insertAction({ type: "launch", payload: JSON.stringify({ profile_id: prof.id, model: "glm-x", workdir }) });
    const before = listGeneratedJson();
    const res = await PREVIEW(req("/api/quick-actions/preview", { method: "POST", body: JSON.stringify({ id: a.id }) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rendered: string; risks: string[]; model: string | null; workdir: string; awaiting: boolean; action: ActionRow };
    expect(body.rendered).toContain("claude.cmd");
    expect(body.rendered).toContain("--model glm-x");
    expect(body.risks).toEqual([]);
    expect(body.model).toBe("glm-x");
    expect(body.workdir).toBe(workdir);
    expect(body.awaiting).toBe(true);
    expect(body.action.id).toBe(a.id);
    // 预览不留含密钥文件:即时删除契约
    const after = listGeneratedJson();
    expect(after.filter((f) => !before.includes(f))).toEqual([]);
  });
  it("404(不存在);disabled → 409 快捷指令已禁用", async () => {
    expect((await PREVIEW(req("/api/quick-actions/preview", { method: "POST", body: JSON.stringify({ id: "nope" }) }))).status).toBe(404);
    const a = insertAction({ enabled: false });
    const res = await PREVIEW(req("/api/quick-actions/preview", { method: "POST", body: JSON.stringify({ id: a.id }) }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("禁用");
  });
});

describe("quick-actions confirm", () => {
  it("command:真实 powershell 执行 → run ok + output 含 qa-ok + runs 返回", async () => {
    const a = insertAction({ payload: "Write-Output qa-ok" });
    const res = await CONFIRM(req(`/api/quick-actions/${a.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: typeof quickActionRuns.$inferSelect; runs: (typeof quickActionRuns.$inferSelect)[] };
    expect(body.run.status).toBe("ok");
    expect(body.run.exitCode).toBe(0);
    expect(body.run.output).toContain("qa-ok");
    expect(body.run.renderedPayload).toBe("Write-Output qa-ok");
    expect(body.run.actionId).toBe(a.id);
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs[0]?.id).toBe(body.run.id);
  });
  it("command:非零退出 → failed", async () => {
    const a = insertAction({ payload: "exit 3" });
    const body = (await (await CONFIRM(req(`/api/quick-actions/${a.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a.id }) })).json()) as { run: typeof quickActionRuns.$inferSelect };
    expect(body.run.status).toBe("failed");
    expect(body.run.exitCode).toBe(3);
  });
  it("command:超长输出截断 ≤ 65536", async () => {
    const a = insertAction({ payload: 'Write-Output ("x" * 100000)' });
    const body = (await (await CONFIRM(req(`/api/quick-actions/${a.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a.id }) })).json()) as { run: typeof quickActionRuns.$inferSelect };
    expect(body.run.status).toBe("ok");
    expect(body.run.output!.length).toBeLessThanOrEqual(65536);
    expect(body.run.output!.length).toBeGreaterThan(0);
  }, 30_000);
  it("url:记 run ok + 响应含 url", async () => {
    const a = insertAction({ type: "url", payload: "https://example.com" });
    const res = await CONFIRM(req(`/api/quick-actions/${a.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: typeof quickActionRuns.$inferSelect; url: string };
    expect(body.run.status).toBe("ok");
    expect(body.run.renderedPayload).toBe("https://example.com");
    expect(body.run.output).toBe("https://example.com");
    expect(body.url).toBe("https://example.com");
  });
  it("launch:model 非法 → 400,不落 settings 文件、不记 run", async () => {
    const prof = insertProfile({ apiKeyRef: "plain:sk-test" });
    // 注:双下划线名是合法字符(isValidModelName 允许 _),须用真非法名(含 shell 元字符)才触发 400
    const a = insertAction({ type: "launch", payload: JSON.stringify({ profile_id: prof.id, model: "bad|model" }) });
    const before = listGeneratedJson();
    const res = await CONFIRM(req(`/api/quick-actions/${a.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a.id }) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("非法");
    expect(listGeneratedJson().filter((f) => !before.includes(f))).toEqual([]);
    expect((db.select().from(quickActionRuns).all() as (typeof quickActionRuns.$inferSelect)[]).filter((r) => r.actionId === a.id)).toHaveLength(0);
  });
  it("launch:密钥未配置 → 409 档案密钥未配置", async () => {
    const prof = insertProfile({ apiKeyRef: "env:NO_SUCH_ENV_VAR_FOR_QA_TEST" });
    const a = insertAction({ type: "launch", payload: JSON.stringify({ profile_id: prof.id }) });
    const res = await CONFIRM(req(`/api/quick-actions/${a.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a.id }) });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("档案密钥未配置");
  });
  it("launch:profile 不存在 → 404;payload 非 JSON → 400", async () => {
    const a1 = insertAction({ type: "launch", payload: JSON.stringify({ profile_id: "nope" }) });
    expect((await CONFIRM(req(`/api/quick-actions/${a1.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a1.id }) })).status).toBe(404);
    const a2 = insertAction({ type: "launch", payload: "not-json" });
    expect((await CONFIRM(req(`/api/quick-actions/${a2.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a2.id }) })).status).toBe(400);
  });
  it("launch:真实路径(claude 预检/spawn)→ run 已记录;1s 后 settings 文件删除,无残留", async () => {
    const prof = insertProfile({ apiKeyRef: "plain:sk-test" });
    // 工作目录必不存在 → spawn 必失败不开窗;无论环境是否装了 claude.cmd,结果都确定是 failed
    const a = insertAction({ type: "launch", payload: JSON.stringify({ profile_id: prof.id, model: "glm-x", workdir: "Z:/no/such/dir-qa" }) });
    const before = listGeneratedJson();
    const res = await CONFIRM(req(`/api/quick-actions/${a.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a.id }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { run: typeof quickActionRuns.$inferSelect };
    expect(["ok", "failed"]).toContain(body.run.status);
    expect(body.run.status).toBe("failed");
    expect(body.run.output!.length).toBeGreaterThan(0);
    const recorded = (db.select().from(quickActionRuns).all() as (typeof quickActionRuns.$inferSelect)[]).find((r) => r.actionId === a.id);
    expect(recorded).toBeDefined();
    // 延迟删除契约:1s 后含密钥临时文件必须消失
    await sleep(1300);
    expect(listGeneratedJson().filter((f) => !before.includes(f))).toEqual([]);
  });
  it("404;disabled → 409", async () => {
    expect((await CONFIRM(req("/api/quick-actions/nope/confirm", { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: "nope" }) })).status).toBe(404);
    const a = insertAction({ enabled: false });
    expect((await CONFIRM(req(`/api/quick-actions/${a.id}/confirm`, { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: a.id }) })).status).toBe(409);
  });
});

describe("quick-actions runs", () => {
  it("GET:最新 20 条 ts desc", async () => {
    const a = insertAction();
    for (let i = 0; i < 22; i++) {
      db.insert(quickActionRuns).values({
        id: crypto.randomUUID(), actionId: a.id, renderedPayload: "p", output: "o",
        status: "ok", durationMs: 0, ts: new Date(Date.UTC(2026, 8, 1, 0, 0, i)).toISOString(),
      }).run();
    }
    const res = await RUNS(req("/api/quick-actions/runs"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { runs: (typeof quickActionRuns.$inferSelect)[] };
    expect(body.runs).toHaveLength(20);
    const tsList = body.runs.map((r) => r.ts);
    expect([...tsList].sort().reverse()).toEqual(tsList);
  });
});
