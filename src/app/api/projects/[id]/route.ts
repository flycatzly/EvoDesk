import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { projects } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = await req.json().catch(() => null);
  // 对象守卫:非对象 body(字符串/数字/数组)按空补丁处理,走 400 而不是在字段检查时误判
  const body = raw && typeof raw === "object" ? raw : {};
  const patch: Partial<typeof projects.$inferInsert> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim();
  if (typeof body.color === "string") patch.color = body.color;
  if (typeof body.archived === "boolean") patch.archived = body.archived;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "无可更新字段" }, { status: 400 });
  await (await getAnyDb()).update(projects).set(patch).where(eq(projects.id, id));
  const row = (await (await getAnyDb()).select().from(projects).where(eq(projects.id, id)))[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project: row });
}
