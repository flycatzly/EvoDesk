import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { jobs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAnyDb();
  const row = db.select().from(jobs).where(eq(jobs.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  db.delete(jobs).where(eq(jobs.id, id)).run();
  return NextResponse.json({ ok: true });
}
