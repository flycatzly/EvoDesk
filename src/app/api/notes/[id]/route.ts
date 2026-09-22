import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { notes } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/notes/[id]:删除单条笔记(硬删除;含剪藏/速记/对话收集的全部来源)
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const r = db.delete(notes).where(eq(notes.id, id)).run();
  if (r.changes === 0) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
