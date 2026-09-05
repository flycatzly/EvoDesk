import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, POST } from "./route";

// Next 16 的 NextRequest 使用自带 RequestInit(signal 不允许 null),从构造器反推类型以通过 next build 的全量类型检查
type ReqInit = ConstructorParameters<typeof NextRequest>[1];

function req(url: string, init?: ReqInit) {
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
