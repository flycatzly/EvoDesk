import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { tickRecurring } from "@/lib/domain/recurring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 幂等补投:扫描到期规则生成任务并推进 next_run_at,返回本次生成数(无到期规则时为 0)
export async function POST(_req: NextRequest) {
  const created = tickRecurring(getDb());
  return NextResponse.json({ created });
}
