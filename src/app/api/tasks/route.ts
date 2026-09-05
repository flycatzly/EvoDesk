import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { tasks } from "@/lib/db/schema";
import { tickRecurring } from "@/lib/domain/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 到期日只接受 yyyy-mm-dd(schema 头注的 UTC-ISO 约定:领域代码依赖字典序比较)。
// 空串/垃圾值静默归一为 null 而非 400,保持个人工具的录入摩擦最小。
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const normDate = (v: unknown): string | null =>
  typeof v === "string" && dateRe.test(v) && !Number.isNaN(Date.parse(v)) ? v : null;

export async function GET(req: NextRequest) {
  // 注意:读接口内有写副作用(tickRecurring 到期补投)。同步 better-sqlite3 下无并发交错风险,前提是单进程。
  const db = getDb();
  tickRecurring(db);
  const status = req.nextUrl.searchParams.get("status");
  const projectId = req.nextUrl.searchParams.get("project_id");
  const rows = status
    ? db.select().from(tasks).where(eq(tasks.status, status)).orderBy(desc(tasks.createdAt)).all()
    : db.select().from(tasks).orderBy(desc(tasks.createdAt)).all();
  const filtered = projectId ? rows.filter((t) => t.projectId === projectId) : rows;
  return NextResponse.json({ tasks: filtered });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body.title !== "string" || !body.title.trim()) {
    return NextResponse.json({ error: "title 必填" }, { status: 400 });
  }
  const db = getDb();
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
  db.insert(tasks).values(task).run();
  return NextResponse.json({ task }, { status: 201 });
}
