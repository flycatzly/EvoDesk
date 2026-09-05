import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { GET, PATCH } from "./route";
import { POST as POST_LIST } from "../route";

// Next 16 的 NextRequest 使用自带 RequestInit(signal 不允许 null),从构造器反推类型以通过 next build 的全量类型检查
type ReqInit = ConstructorParameters<typeof NextRequest>[1];

function req(url: string, init?: ReqInit) {
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
  it("running → waiting_human → review 合法(Plan 2 runner 主路径)", async () => {
    // 准备:手动把任务推进到 running(经 ready)
    await PATCH(req(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "ready" }) }), { params: Promise.resolve({ id: taskId }) });
    const r1 = await PATCH(req(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "running" }) }), { params: Promise.resolve({ id: taskId }) });
    expect(r1.status).toBe(200);
    const r2 = await PATCH(req(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "waiting_human" }) }), { params: Promise.resolve({ id: taskId }) });
    expect(r2.status).toBe(200);
    const r3 = await PATCH(req(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify({ status: "review" }) }), { params: Promise.resolve({ id: taskId }) });
    expect(r3.status).toBe(200);
  });
});
