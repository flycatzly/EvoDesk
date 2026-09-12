import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { notes, tasks } from "@/lib/db/schema";
import { toApiTask } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 笔记一键转任务:复刻 POST /api/tasks 的直接落库路径(title=笔记标题,description=body,tags 继承,status inbox),
// 其余字段走 schema 默认(complexity M / priority 1);成功后回写 notes.taskId 建立关联,重复转换 409 拦截。
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const note = db.select().from(notes).where(eq(notes.id, id)).all()[0];
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });
  if (note.taskId) return NextResponse.json({ error: "该笔记已关联任务" }, { status: 409 });

  const nowIso = new Date().toISOString();
  const taskId = crypto.randomUUID();
  db.insert(tasks).values({
    id: taskId,
    title: note.title,
    description: note.body,
    tags: note.tags, // JSON 文本原样继承
    status: "inbox",
    createdAt: nowIso,
    updatedAt: nowIso,
  }).run();
  db.update(notes).set({ taskId, updatedAt: nowIso }).where(eq(notes.id, id)).run();

  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).all()[0];
  const updated = db.select().from(notes).where(eq(notes.id, id)).all()[0];
  return NextResponse.json({ task: toApiTask(task), note: updated }, { status: 201 });
}
