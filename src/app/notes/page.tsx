import { getDb } from "@/lib/db/client";
import { notes } from "@/lib/db/schema";
import { NotesView } from "@/components/NotesView";

export const dynamic = "force-dynamic";

// 与 GET /api/notes 同序:pinned 置顶 → updatedAt desc(UTC-ISO 字典序即时间序),服务端排好再传
export default function NotesPage() {
  const db = getDb();
  const rows = (db.select().from(notes).all() as (typeof notes.$inferSelect)[]).sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold mb-4">笔记速记</h1>
      <NotesView notes={rows} />
    </div>
  );
}
