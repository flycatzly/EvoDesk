import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { q } from "@/lib/db/q";
import { memories } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 记忆库管理:GET 列表;POST 手动添加;PATCH 置顶/编辑;DELETE 删除
export async function GET() {
  const db = await getAnyDb();
  const rows = await q.all(db.select().from(memories).orderBy(desc(memories.pinned), desc(memories.createdAt)));
  return NextResponse.json({ memories: rows });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const content = body && typeof body.content === "string" ? body.content.trim() : "";
  if (!content) return NextResponse.json({ error: "content 必填" }, { status: 400 });
  const db = await getAnyDb();
  const id = crypto.randomUUID();
  db.insert(memories).values({ id, content: content.slice(0, 200), sourceChatId: null, pinned: false, hits: 0, createdAt: new Date().toISOString() }).run();
  return NextResponse.json({ ok: true, id });
}

export async function PATCH(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id 必填" }, { status: 400 });
  const patch: Partial<typeof memories.$inferInsert> = { };
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (typeof body.content === "string" && body.content.trim()) patch.content = body.content.trim().slice(0, 200);
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  (await getAnyDb()).update(memories).set(patch).where(eq(memories.id, body.id)).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || typeof body.id !== "string") return NextResponse.json({ error: "id 必填" }, { status: 400 });
  (await getAnyDb()).delete(memories).where(eq(memories.id, body.id)).run();
  return NextResponse.json({ ok: true });
}
