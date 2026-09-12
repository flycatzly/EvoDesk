import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { links } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 批量重命名分类(POST {from, to}):一条 UPDATE 全量替换,用于整理浏览器导入产生的杂乱分类
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const from = body && typeof body.from === "string" ? body.from.trim() : "";
  const to = body && typeof body.to === "string" ? body.to.trim() : "";
  if (!from || !to) {
    return NextResponse.json({ error: "from 与 to 均必填" }, { status: 400 });
  }
  if (to.length > 50) {
    return NextResponse.json({ error: "分类名最长 50 字" }, { status: 400 });
  }
  const result = getDb().update(links).set({ category: to }).where(eq(links.category, from)).run();
  return NextResponse.json({ ok: true, updated: result.changes });
}
