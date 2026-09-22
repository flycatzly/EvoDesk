import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { notes, tasks, flowTemplates } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";
import { TriageCard } from "@/components/TriageCard";
import { InboxQuickInput, type InboxPrefill } from "@/components/InboxQuickInput";

export const dynamic = "force-dynamic";

// ?note=<id>:笔记速记「转任务」跳转而来,把笔记标题/内容预填进快速录入,
// 用户确认后创建任务,并自动回写 notes.taskId 建立双向关联。
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ note?: string }> }) {
  const { note: noteId } = await searchParams;
  const db = getDb();
  tickRecurring(db);
  const queue = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[])
    .filter((t) => t.status === "inbox" || t.status === "triaging");
  const templates = db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[];

  let prefill: InboxPrefill | null = null;
  if (noteId) {
    const n = db.select().from(notes).where(eq(notes.id, noteId)).all()[0];
    if (n) prefill = { noteId: n.id, title: n.title, body: n.body };
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-4">收件箱</h1>
      <InboxQuickInput prefill={prefill} />
      <div className="mt-6">
        {queue.length === 0
          ? <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>收件箱已清空。用顶部快速新增,或 POST /api/tasks 投递任务。</div>
          : queue.map((t) => <TriageCard key={t.id} task={t} templates={templates} />)}
      </div>
    </div>
  );
}
