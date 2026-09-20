import { NextResponse } from "next/server";
import { dbDialect } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 当前数据源方言(GET):前端据此显示/隐藏 MySQL 迁移卡
export async function GET() {
  return NextResponse.json({ dialect: dbDialect() });
}
