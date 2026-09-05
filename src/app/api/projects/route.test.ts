import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, POST } from "./route";

type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
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
