import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest) {
  return NextResponse.json({ chats: getDb().select().from(chats).orderBy(desc(chats.updatedAt)).all() });
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
  getDb().insert(chats).values(chat).run();
  return NextResponse.json({ chat }, { status: 201 });
}
