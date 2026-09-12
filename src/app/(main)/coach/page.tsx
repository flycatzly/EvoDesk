import { desc, eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats, chatMessages, executors, providerProfiles } from "@/lib/db/schema";
import { ChatView } from "@/components/ChatView";

export const dynamic = "force-dynamic";

// 需求教练:复用对话台(chats.mode='coach'),教练提示词在 messages API 按会话模式注入;
// 无教练会话时在此播种一个(收敛式,不与用户会话混排重复)
export default async function CoachPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const db = getDb();
  const allChats = db.select().from(chats).orderBy(desc(chats.updatedAt)).all() as (typeof chats.$inferSelect)[];
  let coachChats = allChats.filter((x) => x.mode === "coach");
  if (coachChats.length === 0) {
    const nowIso = new Date().toISOString();
    db.insert(chats).values({ id: crypto.randomUUID(), title: "需求教练", mode: "coach", createdAt: nowIso, updatedAt: nowIso }).run();
    coachChats = (db.select().from(chats).all() as (typeof chats.$inferSelect)[]).filter((x) => x.mode === "coach");
  }
  const active = coachChats.find((x) => x.id === c) ?? coachChats[0];
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
      <h1 className="text-xl font-bold mb-4">需求教练</h1>
      <ChatView
        key={active?.id ?? "none"}
        mode="coach"
        basePath="/coach"
        chats={coachChats.map((x) => ({ id: x.id, title: x.title, workdir: x.workdir }))}
        activeId={active?.id ?? null}
        initialMessages={messages.map((m) => ({ id: m.id, role: m.role, content: m.content, model: m.model, costUsd: m.costUsd }))}
        modelGroups={groups}
        hasAnyModel={groups.length > 0}
      />
    </div>
  );
}
