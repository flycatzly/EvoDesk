import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { q } from "@/lib/db/q";
import { goals } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORIES = ["reading", "fitness", "project", "custom"] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const patch: Partial<typeof goals.$inferInsert> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if (CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) patch.category = body.category as string;
  if ("target" in body) {
    if (typeof body.target !== "number" || !Number.isFinite(body.target) || body.target <= 0) {
      return NextResponse.json({ error: "target 须为正数" }, { status: 400 });
    }
    patch.target = Math.round(body.target);
  }
  if ("current" in body) {
    if (typeof body.current !== "number" || !Number.isFinite(body.current) || body.current < 0) {
      return NextResponse.json({ error: "current 不可为负" }, { status: 400 });
    }
    patch.current = Math.round(body.current);
  }
  if (typeof body.unit === "string") patch.unit = body.unit;
  if ("deadline" in body) {
    if (body.deadline !== null && (typeof body.deadline !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.deadline))) {
      return NextResponse.json({ error: "deadline 须为 yyyy-mm-dd 或 null" }, { status: 400 });
    }
    patch.deadline = (body.deadline as string) || null;
  }
  if ("color" in body) {
    if (body.color !== null && (typeof body.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(body.color))) {
      return NextResponse.json({ error: "color 须为 #rrggbb 或 null" }, { status: 400 });
    }
    patch.color = (body.color as string) || null;
  }
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  patch.updatedAt = new Date().toISOString();
  const db = await getAnyDb();
  await q.run(db.update(goals).set(patch).where(eq(goals.id, id)));
  const row = await q.one(db.select().from(goals).where(eq(goals.id, id)));
  if (!row) return NextResponse.json({ error: "目标不存在" }, { status: 404 });
  return NextResponse.json({ goal: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAnyDb();
  const row = await q.one(db.select().from(goals).where(eq(goals.id, id)));
  if (!row) return NextResponse.json({ error: "目标不存在" }, { status: 404 });
  await q.run(db.delete(goals).where(eq(goals.id, id)));
  return NextResponse.json({ ok: true });
}
