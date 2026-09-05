import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { canTransition, TASK_STATUSES, type TaskStatus } from "@/lib/domain/status";
import { toApiTask } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// 与 POST /api/tasks 的 due_date 归一保持一致(Task 10 评审引入;后续 zod 化时抽到共享模块)
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const normDate = (v: unknown): string | null =>
  typeof v === "string" && dateRe.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;

// tags 列存 JSON 字符串;对外 API 统一还原为 string[](契约见 @/lib/api/serialize,Task 11 评审抽出共享)。
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const row = (await getDb().select().from(tasks).where(eq(tasks.id, id)).all())[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ task: toApiTask(row) });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const db = getDb();
  const rows = db.select().from(tasks).where(eq(tasks.id, id)).all();
  const current = rows[0];
  if (!current) return NextResponse.json({ error: "not found" }, { status: 404 });
  // body 可能是 null/数字/字符串等非对象 JSON,直接 "in" 会抛错 → 500;先归一为空对象
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? raw : {};

  const patch: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date().toISOString() };
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.description === "string") patch.description = body.description;
  if (Array.isArray(body.tags)) patch.tags = JSON.stringify(body.tags.slice(0, 5));
  if (["S", "M", "L"].includes(body.complexity)) patch.complexity = body.complexity;
  if (Number.isInteger(body.priority)) patch.priority = Math.min(3, Math.max(0, body.priority));
  if ("due_date" in body) patch.dueDate = normDate(body.due_date);
  if ("project_id" in body) patch.projectId = typeof body.project_id === "string" ? body.project_id : null;
  if ("flow_template_id" in body) patch.flowTemplateId = typeof body.flow_template_id === "string" ? body.flow_template_id : null;

  if (typeof body.status === "string") {
    if (!TASK_STATUSES.includes(body.status as TaskStatus)) return NextResponse.json({ error: "未知状态" }, { status: 400 });
    if (!canTransition(current.status as TaskStatus, body.status as TaskStatus)) {
      return NextResponse.json({ error: `非法流转 ${current.status} → ${body.status}` }, { status: 422 });
    }
    patch.status = body.status;
  }

  db.update(tasks).set(patch).where(eq(tasks.id, id)).run();
  const updated = db.select().from(tasks).where(eq(tasks.id, id)).all()[0];
  return NextResponse.json({ task: toApiTask(updated) });
}
