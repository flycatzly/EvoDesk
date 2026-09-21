import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { getAnyDb } from "@/lib/db/data-source";
import { canvases } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 生成分享 token(?revoke=1 吊销置空;?rotate=1 强制换新);分享链接形如 /share/<token>
// 已有 token 时原样返回——「分享」按钮也是查看既有链接的入口,重复点击不得作废旧链接
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const query = new URL(req.url).searchParams;
  const revoke = query.get("revoke") === "1";
  const rotate = query.get("rotate") === "1";
  const db = await getAnyDb();
  const row = db.select().from(canvases).where(eq(canvases.id, id)).all()[0];
  if (!row) return NextResponse.json({ error: "画布不存在" }, { status: 404 });
  if (row.isTemplate) return NextResponse.json({ error: "模板画布不可分享" }, { status: 400 });

  if (revoke) {
    db.update(canvases).set({ shareToken: null, updatedAt: new Date().toISOString() }).where(eq(canvases.id, id)).run();
    return NextResponse.json({ shareToken: null });
  }
  if (row.shareToken && !rotate) {
    return NextResponse.json({ shareToken: row.shareToken });
  }
  const shareToken = randomBytes(8).toString("hex");
  db.update(canvases).set({ shareToken, updatedAt: new Date().toISOString() }).where(eq(canvases.id, id)).run();
  return NextResponse.json({ shareToken });
}
