import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { POST } from "./route";
import { POST as POST_LIST } from "../../route";

// Next 16 的 NextRequest 使用自带 RequestInit(signal 不允许 null),从构造器反推类型以通过 next build 的全量类型检查
type ReqInit = ConstructorParameters<typeof NextRequest>[1];
function req(url: string, init?: ReqInit) {
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
    // 通过全局 stub 注入 fetch(callLlmWithRetry 默认参数在调用时取全局 fetch)
    vi.stubGlobal("fetch", f);
    const res = await POST(req(`/api/tasks/${taskId}/triage`), { params: Promise.resolve({ id: taskId }) });
    const data = await res.json();
    vi.unstubAllGlobals();
    expect(data.degraded).toBe(false);
    expect(data.task.tags).toEqual(["研究"]);
    expect(data.task.flowTemplateId).toBeTruthy();
  });
});
