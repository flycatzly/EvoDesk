import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { q } from "@/lib/db/q";
import { tasks } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";
import { toApiTask } from "@/lib/api/serialize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 到期日只接受 yyyy-mm-dd(schema 头注的 UTC-ISO 约定:领域代码依赖字典序比较)。
// 空串/垃圾值静默归一为 null 而非 400,保持个人工具的录入摩擦最小。
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const normDate = (v: unknown): string | null =>
  typeof v === "string" && dateRe.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;

type TaskRow = typeof tasks.$inferSelect;

export async function GET(req: NextRequest) {
  // 读接口内有写副作用(tickRecurring 到期补投);统一走 await 数据访问,双方言一致。
  const db = await getAnyDb();
  tickRecurring(db as never);
  const status = req.nextUrl.searchParams.get("status");
  const projectId = req.nextUrl.searchParams.get("project_id");
  const rows = status
    ? await q.all<TaskRow>(db.select().from(tasks).where(eq(tasks.status, status)).orderBy(desc(tasks.createdAt)))
    : await q.all<TaskRow>(db.select().from(tasks).orderBy(desc(tasks.createdAt)));
  const filtered = projectId ? rows.filter((t) => t.projectId === projectId) : rows;
  return NextResponse.json({ tasks: filtered.map(toApiTask) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title 必填" }, { status: 400 });
  }
  const db = await getAnyDb();
  const nowIso = new Date().toISOString();
  const task = {
    id: crypto.randomUUID(),
    title: body.title.trim(),
    description: typeof body.description === "string" ? body.description : "",
    tags: JSON.stringify(Array.isArray(body.tags) ? body.tags.slice(0, 5) : []),
    complexity: ["S", "M", "L"].includes(body.complexity) ? body.complexity : "M",
    priority: Number.isInteger(body.priority) ? Math.min(3, Math.max(0, body.priority)) : 1,
    dueDate: normDate(body.due_date),
    projectId: typeof body.project_id === "string" ? body.project_id : null,
    status: "inbox" as const,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await q.run(db.insert(tasks).values(task));
  // 回读补全 DB 默认列(flowTemplateId 等)并统一 tags 数组契约(与 PATCH / [id] 的回读模式一致)
  const created = await q.one<TaskRow>(db.select().from(tasks).where(eq(tasks.id, task.id)));
  return NextResponse.json({ task: toApiTask(created!) }, { status: 201 });
}
