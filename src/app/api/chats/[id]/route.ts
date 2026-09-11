import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chats, chatMessages } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const chat = db.select().from(chats).where(eq(chats.id, id)).all()[0];
  if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = db.select().from(chatMessages).where(eq(chatMessages.chatId, id)).orderBy(asc(chatMessages.createdAt)).all();
  return NextResponse.json({ chat, messages });
}
