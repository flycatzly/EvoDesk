import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { evolutionEvents, flowTemplates } from "@/lib/db/schema";
import { FlowsView } from "@/components/FlowsView";

export const dynamic = "force-dynamic";

// active → experimental → retired;组内 updatedAt desc(ISO 字符串字典序即时间序)
const STATUS_RANK: Record<string, number> = { active: 0, experimental: 1, retired: 2 };

export default function FlowsPage() {
  const db = getDb();
  const templates = (db.select().from(flowTemplates).all() as (typeof flowTemplates.$inferSelect)[]).sort((a, b) => {
    const d = (STATUS_RANK[a.status] ?? 3) - (STATUS_RANK[b.status] ?? 3);
    if (d !== 0) return d;
    return a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0;
  });
  const events = (db.select().from(evolutionEvents).orderBy(desc(evolutionEvents.ts)).all() as (typeof evolutionEvents.$inferSelect)[]).slice(0, 50);
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">流程库</h1>
      <FlowsView templates={templates} events={events} />
    </div>
  );
}
