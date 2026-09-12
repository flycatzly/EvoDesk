import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { canvases } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 生成分享 token(?revoke=1 吊销置空);分享链接形如 /share/<token>
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const revoke = new URL(req.url).searchParams.get("revoke") === "1";
  const db = getDb();
  const row = db.select().from(canvases).where(eq(canvases.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "画布不存在" }, { status: 404 });
  if (row.isTemplate) return NextResponse.json({ error: "模板画布不可分享" }, { status: 400 });
  const shareToken = revoke ? null : randomBytes(8).toString("hex");
  db.update(canvases).set({ shareToken, updatedAt: new Date().toISOString() }).where(eq(canvases.id, id)).run();
  return NextResponse.json({ shareToken });
}
