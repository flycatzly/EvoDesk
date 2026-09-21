import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { q } from "@/lib/db/q";
import { chats } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  const db = await getAnyDb();
  const rows = await q.all(db.select().from(chats).orderBy(desc(chats.updatedAt)));
  return NextResponse.json({ chats: rows });
}

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const nowIso = new Date().toISOString();
  const chat = {
    id: crypto.randomUUID(),
    title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : "新对话",
    mode: body.mode === "coach" ? "coach" : "chat",
    workdir: typeof body.workdir === "string" && body.workdir.trim() ? body.workdir.trim() : null,
    defaultExecutorId: typeof body.default_executor_id === "string" ? body.default_executor_id : null,
    createdAt: nowIso, updatedAt: nowIso,
  };
  const db = await getAnyDb();
  await q.run(db.insert(chats).values(chat));
  return NextResponse.json({ chat }, { status: 201 });
}
