import { NextRequest, NextResponse } from "next/server";
import { getAnyDb, dbDialect } from "@/lib/db/data-source";
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
  if (dbDialect() === "mysql") {
    return NextResponse.json({ error: "MySQL 模式不支持文件级恢复;请使用 JSON 导出/导入迁移数据" }, { status: 501 });
  }
  try {
    const snapshotPath = resolveSnapshotName(body.name);
    const db = await getAnyDb();
    await createSnapshot(db, undefined, "pre-restore");
    restoreSnapshotFile(db, snapshotPath);
    return NextResponse.json({ ok: true, restart: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "恢复失败,原数据未受影响" }, { status: 400 });
  }
}
