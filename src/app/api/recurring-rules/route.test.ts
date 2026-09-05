import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb, type Db } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { recurringRules } from "@/lib/db/schema";
import { GET, POST } from "./route";
import { POST as POST_TICK } from "./tick/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: Db;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

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
  it("POST 归一化:priority 截到 0-3、tags 截到 5 个、非 weekly 规则 weekday 存 null", async () => {
    // tickRecurring 会把规则的 priority/tags 原样复制进生成的任务,绕过任务级校验,必须在规则入口归一
    const res = await POST(req("/api/recurring-rules", { method: "POST", body: JSON.stringify({ title: "杂务", freq: "daily", priority: 9, tags: ["一","二","三","四","五","六","七"], weekday: 4 }) }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.rule.priority).toBe(3);
    expect(JSON.parse(data.rule.tags)).toEqual(["一","二","三","四","五"]);
    expect(data.rule.weekday).toBeNull();
  });
  it("tick 幂等:种子规则均在明天,生成 0;到期规则生成 1 后再次 tick 为 0", async () => {
    const r1 = await (await POST_TICK(req("/api/recurring-rules/tick", { method: "POST" }))).json();
    expect(r1.created).toBe(0); // 种子的 next_run_at 都是明天,不会误触发生成
    // 直接入库一条已到期规则(绕过入口的"明天"归一),验证 tick 真正生成且幂等
    db.insert(recurringRules).values({
      id: crypto.randomUUID(), title: "到期规则", freq: "daily", enabled: true,
      nextRunAt: new Date().toISOString(), createdAt: new Date().toISOString(),
    }).run();
    const r2 = await (await POST_TICK(req("/api/recurring-rules/tick", { method: "POST" }))).json();
    expect(r2.created).toBe(1);
    const r3 = await (await POST_TICK(req("/api/recurring-rules/tick", { method: "POST" }))).json();
    expect(r3.created).toBe(0);
  });
});
