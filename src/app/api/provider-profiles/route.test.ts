import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { providerProfiles, executors } from "@/lib/db/schema";
import { GET, POST } from "./route";
import { POST as IMPORT } from "./import/route";
import { POST as DERIVE } from "./[id]/derive/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

const PROFILE = JSON.stringify({
  env: {
    ANTHROPIC_AUTH_TOKEN: "sk-tok",
    ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
    ANTHROPIC_MODEL: "glm-5.3-flash",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.2",
  },
});

describe("provider-profiles", () => {
  it("POST 手动创建(api_key 包装为 plain:)+ GET 列表", async () => {
    const res = await POST(req("/api/provider-profiles", { method: "POST", body: JSON.stringify({ name: "智谱", api_base: "https://api.z.ai/api/anthropic", api_key: "sk-manual" }) }));
    expect(res.status).toBe(201);
    const created = (await res.json()).profile as typeof providerProfiles.$inferSelect;
    expect(created.apiKeyRef).toBe("plain:sk-manual");
    expect(created.source).toBe("manual");
    const list = await (await GET(req("/api/provider-profiles"))).json();
    expect(list.profiles).toHaveLength(1);
    expect(list.profiles[0].name).toBe("智谱");
  });
  it("POST 缺字段 400", async () => {
    const res = await POST(req("/api/provider-profiles", { method: "POST", body: JSON.stringify({ name: "只有名字" }) }));
    expect(res.status).toBe(400);
  });
  it("import:成功+坏 JSON 跳过;重复导入同名跳过", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-import-"));
    fs.writeFileSync(path.join(dir, "A.txt"), PROFILE);
    fs.writeFileSync(path.join(dir, "B.txt"), "{ broken");
    const r1 = await IMPORT(req("/api/provider-profiles/import", { method: "POST", body: JSON.stringify({ dir }) }));
    expect(r1.status).toBe(200);
    expect((await r1.json()).report.imported).toEqual(["A"]);
    const r2 = await IMPORT(req("/api/provider-profiles/import", { method: "POST", body: JSON.stringify({ dir }) }));
    expect((await r2.json()).report.skipped[0].reason).toContain("已存在");
    fs.rmSync(dir, { recursive: true, force: true });
  });
  it("import:缺 dir 400;目录不可读 400", async () => {
    expect((await IMPORT(req("/api/provider-profiles/import", { method: "POST", body: JSON.stringify({}) }))).status).toBe(400);
    expect((await IMPORT(req("/api/provider-profiles/import", { method: "POST", body: JSON.stringify({ dir: "Z:/no/such/dir" }) }))).status).toBe(400);
  });
  it("derive:创建禁用执行器;缺档位 409;档案不存在 409", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evodesk-derive-"));
    fs.writeFileSync(path.join(dir, "P.txt"), PROFILE);
    await IMPORT(req("/api/provider-profiles/import", { method: "POST", body: JSON.stringify({ dir }) }));
    fs.rmSync(dir, { recursive: true, force: true });
    const prof = (db.select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[])[0];
    const res = await DERIVE(req(`/api/provider-profiles/${prof.id}/derive`, { method: "POST", body: JSON.stringify({ selections: [{ tier: "primary", role: "executor" }, { tier: "haiku", role: "triage" }] }) }), { params: Promise.resolve({ id: prof.id }) });
    expect(res.status).toBe(201);
    const createdIds = (await res.json()).created as string[];
    expect(createdIds).toHaveLength(2);
    const rows = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
    const derived = rows.filter((e) => createdIds.includes(e.id));
    expect(derived.every((e) => e.enabled === false)).toBe(true);
    expect(derived.every((e) => e.providerProfileId === prof.id)).toBe(true);
    const bad = await DERIVE(req(`/api/provider-profiles/${prof.id}/derive`, { method: "POST", body: JSON.stringify({ selections: [{ tier: "opus", role: "planner" }] }) }), { params: Promise.resolve({ id: prof.id }) });
    expect(bad.status).toBe(409);
    const missing = await DERIVE(req("/api/provider-profiles/nope/derive", { method: "POST", body: JSON.stringify({ selections: [{ tier: "primary", role: "executor" }] }) }), { params: Promise.resolve({ id: "nope" }) });
    expect(missing.status).toBe(409);
  });
  it("derive:缺 selections 400", async () => {
    const res = await DERIVE(req("/api/provider-profiles/x/derive", { method: "POST", body: JSON.stringify({}) }), { params: Promise.resolve({ id: "x" }) });
    expect(res.status).toBe(400);
  });
});
