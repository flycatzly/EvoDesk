import { desc, eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats, chatMessages, executors, providerProfiles } from "@/lib/db/schema";
import { ChatView } from "@/components/ChatView";

export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const db = getDb();
  const chatRows = db.select().from(chats).orderBy(desc(chats.updatedAt)).all() as (typeof chats.$inferSelect)[];
  const active = chatRows.find((x) => x.id === c) ?? chatRows[0] ?? null;
  const messages = active
    ? (db.select().from(chatMessages).where(eq(chatMessages.chatId, active.id)).orderBy(asc(chatMessages.createdAt)).all() as (typeof chatMessages.$inferSelect)[])
    : [];
  const exRows = (db.select().from(executors).all() as (typeof executors.$inferSelect)[]).filter((e) => e.type === "llm" && e.enabled);
  const profRows = db.select().from(providerProfiles).all() as (typeof providerProfiles.$inferSelect)[];
  const groups = exRows.map((e) => {
    const prof = profRows.find((p) => p.id === e.providerProfileId);
    return { executorId: e.id, label: `${e.name} · ${e.model ?? ""}`, group: prof?.name ?? "独立执行器" };
  });

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">AI 对话台</h1>
      {/* key 绑定会话 id:切换会话时强制重挂载,确保 initialMessages 状态随之刷新 */}
      <ChatView
        key={active?.id ?? "none"}
        chats={chatRows.map((x) => ({ id: x.id, title: x.title }))}
        activeId={active?.id ?? null}
        initialMessages={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, model: m.model, costUsd: m.costUsd }))}
        modelGroups={groups}
        hasAnyModel={groups.length > 0}
      />
    </div>
  );
}
