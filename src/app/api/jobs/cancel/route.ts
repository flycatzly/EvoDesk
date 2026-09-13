import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { cancelCurrentRun } from "@/lib/domain/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 取消当前运行中的 jobs 任务(等待登录/卡死时解锁;杀子进程 + 落库 canceled)
export async function POST() {
  const ok = cancelCurrentRun(getDb());
  return NextResponse.json({ ok }, { status: ok ? 200 : 409 });
}
