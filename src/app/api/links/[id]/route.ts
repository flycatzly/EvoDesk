import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { links } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isHttpUrl = (v: unknown): v is string => typeof v === "string" && /^https?:\/\/\S+/.test(v);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const patch: Partial<typeof links.$inferInsert> = {};
  if (typeof body.title === "string" && body.title.trim()) patch.title = body.title.trim();
  if ("url" in body) {
    if (!isHttpUrl(body.url)) return NextResponse.json({ error: "url 须为 http(s) 链接" }, { status: 400 });
    patch.url = (body.url as string).trim();
  }
  if (typeof body.category === "string" && body.category.trim()) patch.category = body.category.trim();
  if (typeof body.sort === "number" && Number.isFinite(body.sort)) patch.sort = body.sort;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  const db = getDb();
  db.update(links).set(patch).where(eq(links.id, id)).run();
  const row = db.select().from(links).where(eq(links.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "链接不存在" }, { status: 404 });
  return NextResponse.json({ link: row });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const row = db.select().from(links).where(eq(links.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "链接不存在" }, { status: 404 });
  db.delete(links).where(eq(links.id, id)).run();
  return NextResponse.json({ ok: true });
}
