import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { canvases } from "@/lib/db/schema";
import { layoutSchema } from "@/lib/domain/canvas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getDb().select().from(canvases).where(eq(canvases.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "画布不存在" }, { status: 404 });
  return NextResponse.json({ canvas: row });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const patch: Partial<typeof canvases.$inferInsert> = {};
  if ("layout" in body) {
    const parsed = layoutSchema.safeParse(body.layout);
    if (!parsed.success) return NextResponse.json({ error: "layout 结构非法" }, { status: 400 });
    patch.layout = JSON.stringify(parsed.data);
  }
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (body.columns === "2" || body.columns === "3") patch.columns = body.columns;
  if (typeof body.locked === "boolean") patch.locked = body.locked;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  patch.updatedAt = new Date().toISOString();
  const db = getDb();
  db.update(canvases).set(patch).where(eq(canvases.id, id)).run();
  const row = db.select().from(canvases).where(eq(canvases.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "画布不存在" }, { status: 404 });
  return NextResponse.json({ canvas: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.select().from(canvases).where(eq(canvases.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "画布不存在" }, { status: 404 });
  if (row.isTemplate) return NextResponse.json({ error: "内置模板不可删除" }, { status: 400 });
  db.delete(canvases).where(eq(canvases.id, id)).run();
  return NextResponse.json({ ok: true });
}
