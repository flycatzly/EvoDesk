import { NextRequest, NextResponse } from "next/server";
import { getAnyDb, dbDialect } from "@/lib/db/data-source";
import { parseBackup, importData, exportData, createSnapshot, cleanSnapshots, backupDir } from "@/lib/domain/backup";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 导入:multipart 文件 → 校验 → 自动快照当前库(MySQL 模式降级为 JSON 预备份)→ 事务全量替换 → 返回逐表统计
export async function POST(req: NextRequest) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请求须为 multipart 表单(字段名 file)" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "缺少备份文件(字段名 file)" }, { status: 400 });
  }
  let parsed;
  try {
    parsed = parseBackup(await file.text());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "备份文件校验失败" }, { status: 400 });
  }
  const db = await getAnyDb();
  try {
    let snapshotName: string;
    if (dbDialect() === "mysql") {
      // MySQL 无文件级快照:导入前把当前数据全量导出为 JSON 存入备份目录,等价可回退
      fs.mkdirSync(backupDir(), { recursive: true });
      snapshotName = `pre-import-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      const current = await exportData(db, { includeSecrets: true });
      fs.writeFileSync(path.join(backupDir(), snapshotName), JSON.stringify(current));
    } else {
      snapshotName = await createSnapshot(db, undefined, "pre-import");
    }
    const { perTable } = await importData(db, parsed);
    cleanSnapshots(20);
    return NextResponse.json({ ok: true, snapshot: snapshotName, perTable });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "导入失败,原数据未受影响" }, { status: 500 });
  }
}
