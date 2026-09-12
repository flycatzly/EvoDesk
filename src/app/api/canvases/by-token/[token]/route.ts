import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { canvases } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 分享只读端点:仅返回展示所需字段;模板画布不参与 token 查找
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const row = getDb().select().from(canvases)
    .where(and(eq(canvases.shareToken, token), eq(canvases.isTemplate, false)))
    .all()[0];
  if (!row) return NextResponse.json({ error: "分享链接无效或已吊销" }, { status: 404 });
  return NextResponse.json({ canvas: { id: row.id, name: row.name, columns: row.columns, layout: row.layout } });
}
