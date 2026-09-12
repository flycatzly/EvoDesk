import { getDb } from "@/lib/db/client";
import { tasks, flowTemplates } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";
import { TriageCard } from "@/components/TriageCard";
import { InboxQuickInput } from "@/components/InboxQuickInput";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  const db = getDb();
  tickRecurring(db);
  const queue = (db.select().from(tasks).all() as (typeof tasks.$inferSelect)[])
    .filter((t) => t.status === "inbox" || t.status === "triaging");
  const templates = db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[];

  return (
    <div className="max-w-3xl">
      <h1 className="text-xl font-bold mb-4">收件箱</h1>
      <InboxQuickInput />
      <div className="mt-6">
        {queue.length === 0
          ? <div className="surface p-4 text-sm" style={{ color: "var(--muted)" }}>收件箱已清空。用顶部快速新增,或 POST /api/tasks 投递任务。</div>
          : queue.map((t) => <TriageCard key={t.id} task={t} templates={templates} />)}
      </div>
    </div>
  );
}
