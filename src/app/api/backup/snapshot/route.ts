import { NextResponse } from "next/server";
import { getAnyDb, dbDialect } from "@/lib/db/data-source";
import { createSnapshot, listSnapshots, cleanSnapshots } from "@/lib/domain/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ snapshots: listSnapshots() });
}

// 手动创建快照(data/backups/*.db),超出 20 份自动清理;MySQL 模式不支持文件级快照
export async function POST() {
  if (dbDialect() === "mysql") {
    return NextResponse.json({ error: "MySQL 模式不支持文件级快照;请使用 JSON 导出/导入备份数据" }, { status: 501 });
  }
  try {
    const name = await createSnapshot(await getAnyDb());
    cleanSnapshots(20);
    return NextResponse.json({ ok: true, name });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "快照创建失败" }, { status: 500 });
  }
}
