import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { createSnapshot, listSnapshots, cleanSnapshots } from "@/lib/domain/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ snapshots: listSnapshots() });
}

// 手动创建快照(data/backups/*.db),超出 20 份自动清理
export async function POST() {
  try {
    const name = await createSnapshot(getDb());
    cleanSnapshots(20);
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "快照创建失败" }, { status: 500 });
  }
}
