import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, POST } from "./route";
import { POST as POST_TICK } from "./tick/route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
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
