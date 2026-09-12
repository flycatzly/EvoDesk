import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { buildStats } from "@/lib/domain/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 统计聚合(/stats 页与外部调用共用;聚合逻辑在 src/lib/domain/stats.ts,页面直接复用同函数)
export async function GET() {
  const db = getDb();
  return NextResponse.json(buildStats(db));
}
