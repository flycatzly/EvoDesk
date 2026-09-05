import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, PUT } from "./route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
beforeEach(() => { const db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });

describe("settings", () => {
  it("GET 返回 KV 对象;PUT 更新一个键", async () => {
    const s1 = await (await GET(req("/api/settings"))).json();
    expect(s1.settings.theme).toBe("dark");
    const r = await (await PUT(req("/api/settings", { method: "PUT", body: JSON.stringify({ cost_budget_usd: 20 }) }))).json();
    expect(r.settings.cost_budget_usd).toBe(20);
  });
});
