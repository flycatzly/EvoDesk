import { NextRequest, NextResponse } from "next/server";
import { eq, asc } from "drizzle-orm";
import fs from "node:fs";
import { getAnyDb } from "@/lib/db/data-source";
import { chats, chatMessages } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = (await getAnyDb());
  const chat = db.select().from(chats).where(eq(chats.id, id)).all()[0];
  if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 });
  const messages = db.select().from(chatMessages).where(eq(chatMessages.chatId, id)).orderBy(asc(chatMessages.createdAt)).all();
  return NextResponse.json({ chat, messages });
}

// 会话管理:重命名 / 绑定工作目录(workdir 存在性在服务端校验并回传 exists 标记)/ 换默认执行器
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const patch: Partial<typeof chats.$inferInsert> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if ("workdir" in body) {
    if (body.workdir === null || body.workdir === "") {
      patch.workdir = null;
    } else if (typeof body.workdir === "string") {
      const dir = body.workdir.trim();
      patch.workdir = dir;
    } else {
      return NextResponse.json({ error: "workdir 须为字符串或 null" }, { status: 400 });
    }
  }
  if (typeof body.default_executor_id === "string") patch.defaultExecutorId = body.default_executor_id;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  patch.updatedAt = new Date().toISOString();
  const db = (await getAnyDb());
  db.update(chats).set(patch).where(eq(chats.id, id)).run();
  const row = db.select().from(chats).where(eq(chats.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const workdirExists = row.workdir ? fs.existsSync(row.workdir) : null;
  return NextResponse.json({ chat: row, workdirExists });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = (await getAnyDb());
  const chat = db.select().from(chats).where(eq(chats.id, id)).all()[0];
  if (!chat) return NextResponse.json({ error: "not found" }, { status: 404 });
  db.delete(chatMessages).where(eq(chatMessages.chatId, id)).run();
  db.delete(chats).where(eq(chats.id, id)).run();
  return NextResponse.json({ ok: true });
}
