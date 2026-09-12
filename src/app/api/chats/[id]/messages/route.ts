import { NextRequest } from "next/server";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats, chatMessages, executors } from "@/lib/db/schema";
import { executorLlmConfig } from "@/lib/llm/client";
import { streamLlm } from "@/lib/llm/stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM = "你是 EvoDesk 本地个人工作台内置的 AI 助手,回答简洁、可直接执行。";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const chat = db.select().from(chats).where(eq(chats.id, id)).all()[0];
  if (!chat) return new Response(JSON.stringify({ error: "会话不存在" }), { status: 404, headers: { "content-type": "application/json" } });
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return new Response(JSON.stringify({ error: "content 必填" }), { status: 400, headers: { "content-type": "application/json" } });

  // 执行器选择:指定 executor_id(须为启用的 llm)→ 会话默认 → executor 角色 → 首个启用
  const allEx = db.select().from(executors).all() as (typeof executors.$inferSelect)[];
  const enabledLlm = allEx.filter((e) => e.type === "llm" && e.enabled);
  const requested = typeof body.executor_id === "string" ? enabledLlm.find((e) => e.id === body.executor_id) : undefined;
  const ex = requested
    ?? (chat.defaultExecutorId ? enabledLlm.find((e) => e.id === chat.defaultExecutorId) : undefined)
    ?? enabledLlm.find((e) => e.role === "executor") ?? enabledLlm[0];
  if (!ex) return new Response(JSON.stringify({ error: "未配置可用模型:请在执行器页启用一个 LLM 执行器,或导入供应商档案后派生" }), { status: 400, headers: { "content-type": "application/json" } });
  // 配置校验必须先于用户消息落库:所有 400 均为 pre-persist,客户端"移除乐观消息"的契约才始终成立
  let cfg;
  try { cfg = executorLlmConfig(ex); } catch (e) {
    return new Response(JSON.stringify({ error: `执行器配置错误:${String(e)}` }), { status: 400, headers: { "content-type": "application/json" } });
  }

  // 用户消息先落库(诚实历史):随后流式失败也不回滚,仅以 {done:true,error} 收尾、无 assistant 行
  const nowIso = new Date().toISOString();
  const userMsg = { id: crypto.randomUUID(), chatId: id, role: "user", content, executorId: null, model: null, tokensIn: 0, tokensOut: 0, costUsd: 0, createdAt: nowIso };
  db.insert(chatMessages).values(userMsg).run();
  const history = db.select().from(chatMessages).where(eq(chatMessages.chatId, id)).orderBy(asc(chatMessages.createdAt)).all() as (typeof chatMessages.$inferSelect)[];
  // 历史窗口:只送最近 40 条,防 token 随会话长度线性增长;system 始终单独保留,不占窗口
  const windowed = history.slice(-40);
  const llmMessages = [{ role: "system" as const, content: SYSTEM }, ...windowed.map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))];
  // streamLlm 内置 120s abort(chats 无 runner 清扫耦合,无阈值约束)
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // 断连安全:客户端断开后 enqueue 会抛,置 closed 后静默丢弃后续事件
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { closed = true; }
      };
      const gen = streamLlm(cfg, llmMessages);
      let completed = false;
      try {
        for (;;) {
          const r = await gen.next();
          if (r.done) {
            if (closed) break; // 客户端已断开:回复从未送达,不落 assistant 行(仅用户消息保留),上游已完整消费、无需 gen.return
            const result = r.value;
            const finishedAt = new Date().toISOString();
            const assistantMsg = {
              id: crypto.randomUUID(), chatId: id, role: "assistant", content: result.text,
              executorId: ex.id, model: result.model, tokensIn: result.tokensIn, tokensOut: result.tokensOut,
              costUsd: (result.tokensIn / 1000) * ex.costPer1kInput + (result.tokensOut / 1000) * ex.costPer1kOutput,
              createdAt: finishedAt,
            };
            db.insert(chatMessages).values(assistantMsg).run();
            db.update(chats).set({ updatedAt: finishedAt }).where(eq(chats.id, id)).run();
            send({ done: true, message: assistantMsg });
            break;
          }
          send({ delta: r.value });
        }
        completed = true;
      } catch (e) {
        if (closed) {
          // 客户端已断开:断开不是失败,用户消息已落库保留,不发事件、不落 assistant 行,释放上游 reader 即可
          return;
        }
        send({ done: true, error: String(e).slice(0, 300) });
      } finally {
        // streamLlm 消费契约:未完整消费(断开/上游异常)须 gen.return() 释放底层 reader
        if (!completed) { try { await gen.return(undefined as never); } catch { /* 已终止 */ } }
      }
      try { controller.close(); } catch { /* 客户端已断开,流已被取消 */ }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" } });
}
