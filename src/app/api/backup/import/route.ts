import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { parseBackup, importData, createSnapshot, cleanSnapshots } from "@/lib/domain/backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 导入:multipart 文件 → 校验 → 自动快照当前库 → 事务全量替换 → 返回逐表统计
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
  const db = getDb();
  try {
    const snapshotName = await createSnapshot(db, undefined, "pre-import");
    const { perTable } = importData(db, parsed);
    cleanSnapshots(20);
    return NextResponse.json({ ok: true, snapshot: snapshotName, perTable });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "导入失败,原数据未受影响" }, { status: 500 });
  }
}
