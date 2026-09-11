import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createTestDb } from "@/lib/db/test-util";
import { __setDbForTests } from "@/lib/db/client";
import { seedIfEmpty } from "@/lib/db/seed";
import { executors, chatMessages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { GET as LIST, POST as CREATE } from "./route";
import { GET as ONE } from "./[id]/route";
import { POST as SEND } from "./[id]/messages/route";

// Next 16 的 NextRequest 使用自带 RequestInit(signal 不允许 null),从构造器反推类型以通过 next build 的全量类型检查
type ReqInit = ConstructorParameters<typeof NextRequest>[1];
const req = (url: string, init?: ReqInit) => new NextRequest(`http://localhost${url}`, init);
let db: ReturnType<typeof createTestDb>;
beforeEach(() => { db = createTestDb(); seedIfEmpty(db); __setDbForTests(db); });
afterEach(() => { vi.unstubAllGlobals(); });

const exByName = (name: string) =>
  (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).find((e) => e.name === name)!;
/** 启用并绑定 executor 角色;成本 > 0 以断言 costUsd 落库 */
const enable = (name: string) =>
  db.update(executors).set({ enabled: true, role: "executor", costPer1kInput: 1, costPer1kOutput: 2 }).where(eq(executors.name, name)).run();

/** openai 形态 SSE 分片 */
const DELTA = (t: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`;
const USAGE = 'data: {"choices":[],"usage":{"prompt_tokens":6,"completion_tokens":2}}\n\n';
const DONE = "data: [DONE]\n\n";

/** openai 形态上游:单个文本 delta + usage(prompt 6 / completion 2)+ [DONE] */
function stubLlm(delta: string) {
  const enc = new TextEncoder();
  const f = vi.fn().mockResolvedValue(new Response(
    new ReadableStream({
      start(c) {
        c.enqueue(enc.encode(DELTA(delta)));
        c.enqueue(enc.encode(USAGE));
        c.enqueue(enc.encode(DONE));
        c.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  ));
  vi.stubGlobal("fetch", f);
  return f;
}
/** 两段式上游:release 前放行 part1,release 后放行 part2 —— 用于断连时序控制 */
function gatedUpstream(part1: string[], part2: string[]) {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const enc = new TextEncoder();
  const f = vi.fn().mockImplementation(async () => new Response(new ReadableStream({
    async start(c) {
      part1.forEach((s) => c.enqueue(enc.encode(s)));
      await gate;
      part2.forEach((s) => c.enqueue(enc.encode(s)));
      c.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } }));
  return { f, release };
}
function parseSse(text: string): Record<string, unknown>[] {
  return text.split("\n\n").filter((b) => b.startsWith("data: ")).map((b) => JSON.parse(b.slice(6)) as Record<string, unknown>);
}
async function createChat(body: Record<string, unknown> = {}) {
  const res = await CREATE(req("/api/chats", { method: "POST", body: JSON.stringify(body) }));
  expect(res.status).toBe(201);
  return (await res.json() as { chat: { id: string; title: string; defaultExecutorId: string | null } }).chat;
}
const SEND_MSG = (chatId: string, body: Record<string, unknown>) =>
  SEND(req(`/api/chats/${chatId}/messages`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: chatId }) });
const chatRowsOf = (chatId: string) =>
  db.select().from(chatMessages).where(eq(chatMessages.chatId, chatId)).all() as (typeof chatMessages.$inferSelect)[];

describe("chats CRUD", () => {
  it("POST 创建会话;GET 列表;GET 单个含消息", async () => {
    const chat = await createChat({ title: "新对话" });
    expect(chat.title).toBe("新对话");
    const list = (await (await LIST(req("/api/chats"))).json() as { chats: { id: string }[] });
    expect(list.chats.length).toBeGreaterThanOrEqual(1);
    const one = await (await ONE(req(`/api/chats/${chat.id}`), { params: Promise.resolve({ id: chat.id }) })).json() as { chat: { id: string }; messages: unknown[] };
    expect(one.chat.id).toBe(chat.id);
    expect(one.messages).toEqual([]);
  });
  it("POST 无标题 → 默认 新对话;default_executor_id 透传", async () => {
    const target = exByName("强模型");
    const chat = await createChat({ default_executor_id: target.id });
    expect(chat.title).toBe("新对话");
    expect(chat.defaultExecutorId).toBe(target.id);
  });
  it("GET 不存在的会话 → 404", async () => {
    const res = await ONE(req("/api/chats/no-such-chat"), { params: Promise.resolve({ id: "no-such-chat" }) });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/chats/[id]/messages", () => {
  it("发消息:启用执行器 → SSE 回复 + 双消息落库 + 成本记录", async () => {
    const chat = await createChat({});
    enable("快速模型");
    stubLlm("回答");
    const res = await SEND_MSG(chat.id, { content: "你好" });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const events = parseSse(await res.text());
    expect(events.filter((e) => "delta" in e).map((e) => e.delta)).toEqual(["回答"]);
    const done = events.at(-1) as { done: boolean; message: { role: string; content: string; tokensOut: number; costUsd: number } };
    expect(done.done).toBe(true);
    expect(done.message.role).toBe("assistant");
    const one = await (await ONE(req(`/api/chats/${chat.id}`), { params: Promise.resolve({ id: chat.id }) })).json() as {
      messages: { role: string; content: string; tokensOut: number; costUsd: number }[];
    };
    expect(one.messages.length).toBe(2);
    expect(one.messages[0].role).toBe("user");
    expect(one.messages[1].role).toBe("assistant");
    expect(one.messages[1].content).toBe("回答");
    expect(one.messages[1].tokensOut).toBe(2);
    expect(one.messages[1].costUsd).toBeGreaterThan(0);
  });
  it("指定 executor_id:两个启用执行器时使用指定者", async () => {
    const chat = await createChat({});
    enable("快速模型");
    enable("强模型");
    const second = exByName("强模型");
    stubLlm("回答");
    const res = await SEND_MSG(chat.id, { content: "你好", executor_id: second.id });
    await res.text();
    const one = await (await ONE(req(`/api/chats/${chat.id}`), { params: Promise.resolve({ id: chat.id }) })).json() as {
      messages: { role: string; executorId: string | null }[];
    };
    expect(one.messages[1].executorId).toBe(second.id);
  });
  it("指定的执行器已禁用 → 回退到另一个启用执行器", async () => {
    const chat = await createChat({});
    enable("强模型"); // 仅启用强模型;快速模型保持种子默认禁用
    const disabled = exByName("快速模型");
    stubLlm("回答");
    const res = await SEND_MSG(chat.id, { content: "你好", executor_id: disabled.id });
    expect(res.status).toBe(200);
    await res.text();
    const one = await (await ONE(req(`/api/chats/${chat.id}`), { params: Promise.resolve({ id: chat.id }) })).json() as {
      messages: { role: string; executorId: string | null }[];
    };
    expect(one.messages[1].executorId).toBe(exByName("强模型").id);
  });
  it("无可用模型 → 400 明确错误", async () => {
    const chat = await createChat({});
    const res = await SEND_MSG(chat.id, { content: "hi" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("未配置可用模型");
  });
  it("会话 default_executor_id 生效:未指定 executor_id 时使用会话默认(链第二位)", async () => {
    enable("快速模型");
    enable("强模型");
    const strong = exByName("强模型");
    const chat = await createChat({ default_executor_id: strong.id });
    stubLlm("回答");
    const res = await SEND_MSG(chat.id, { content: "你好" });
    expect(res.status).toBe(200);
    await res.text();
    const one = await (await ONE(req(`/api/chats/${chat.id}`), { params: Promise.resolve({ id: chat.id }) })).json() as {
      messages: { role: string; executorId: string | null }[];
    };
    expect(one.messages[1].executorId).toBe(strong.id);
  });
  it("启用执行器缺模型配置 → 400 且用户消息不落库(配置校验先于持久化)", async () => {
    const chat = await createChat({});
    enable("快速模型");
    db.update(executors).set({ model: null }).where(eq(executors.name, "快速模型")).run();
    const res = await SEND_MSG(chat.id, { content: "你好" });
    expect(res.status).toBe(400);
    expect((await res.json() as { error: string }).error).toContain("执行器配置错误");
    expect(chatRowsOf(chat.id)).toHaveLength(0);
  });
  it("客户端中途断开:assistant 不落库,仅用户消息保留(诚实历史),无未处理拒绝", async () => {
    const chat = await createChat({});
    enable("快速模型");
    const { f, release } = gatedUpstream([DELTA("你")], [DELTA("好"), USAGE, DONE]);
    vi.stubGlobal("fetch", f);
    const res = await SEND_MSG(chat.id, { content: "你好" });
    expect(f).toHaveBeenCalled();
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value!)).toContain('"delta":"你"');
    await reader.cancel(); // 客户端断开:此后 enqueue 会抛出
    release();
    await new Promise((r) => setTimeout(r, 20)); // 断连分支全在微任务/IO 内完成,留出事件循环时间
    const rows = chatRowsOf(chat.id);
    expect(rows).toHaveLength(1); // 仅用户消息,无 assistant 行
    expect(rows[0].role).toBe("user");
  });
  it("上游流中报错:done 事件含 error,用户消息保留,无 assistant 行", async () => {
    const chat = await createChat({});
    enable("快速模型");
    const enc = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(DELTA("你")));
          c.enqueue(enc.encode('data: {"error":{"message":"上游炸了"}}\n\n'));
          c.close();
        },
      }),
      { status: 200, headers: { "content-type": "text/event-stream" } },
    )));
    const res = await SEND_MSG(chat.id, { content: "你好" });
    const events = parseSse(await res.text());
    const done = events.at(-1) as { done: boolean; error?: string };
    expect(done.done).toBe(true);
    expect(done.error).toContain("上游炸了");
    const rows = chatRowsOf(chat.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("user");
  });
});
