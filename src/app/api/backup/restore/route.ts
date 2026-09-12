import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { resolveSnapshotName, restoreSnapshotFile, createSnapshot } from "@/lib/domain/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 从快照恢复:先自动做一次 pre-restore 快照 → 覆盖库文件 → 重开连接
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!body || typeof body.name !== "string") {
    return NextResponse.json({ error: "缺少 name(快照文件名)" }, { status: 400 });
  }
  try {
    const snapshotPath = resolveSnapshotName(body.name);
    await createSnapshot(getDb(), undefined, "pre-restore");
    restoreSnapshotFile(getDb(), snapshotPath);
    return NextResponse.json({ ok: true, restart: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "恢复失败,原数据未受影响" }, { status: 400 });
  }
}
