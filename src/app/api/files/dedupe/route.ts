import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveOrganizeDir, assertWithin, scanDir } from "../scan/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/files/dedupe {dir, apply?}:同内容重复文件(精确哈希)每组保留最早修改的一条,
// 其余移动到 <dir>/_重复文件/<时间戳>/(可随时人工找回,不直接删除)。默认仅预览。
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const root = resolveOrganizeDir(body && typeof body.dir === "string" ? body.dir : null);
  if (!root) return NextResponse.json({ error: "目录不在整理白名单内" }, { status: 400 });
  const apply = body?.apply === true;

  const { duplicateGroups } = scanDir(root, true);
  const groups = duplicateGroups.map((g) => {
    const sorted = [...g.files].sort((a, b) => {
      const ma = fs.statSync(path.resolve(root, a.relPath)).mtimeMs;
      const mb = fs.statSync(path.resolve(root, b.relPath)).mtimeMs;
      return ma - mb;
    });
    return { hash: g.hash, keep: sorted[0].relPath, duplicates: sorted.slice(1).map((f) => f.relPath) };
  });
  const dupCount = groups.reduce((n, g) => n + g.duplicates.length, 0);

  if (!apply) {
    return NextResponse.json({ groups, duplicateCount: dupCount });
  }
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const destDir = assertWithin(root, `_重复文件/${stamp}`);
  fs.mkdirSync(destDir, { recursive: true });
  let moved = 0;
  const movedFiles: string[] = [];
  for (const g of groups) {
    for (const rel of g.duplicates) {
      try {
        const from = assertWithin(root, rel);
        const finalName = rel.split("/").join("__");
        let target = path.join(destDir, finalName);
        if (fs.existsSync(target)) target = path.join(destDir, `${Date.now()}-${finalName}`);
        fs.renameSync(from, target);
        movedFiles.push(rel);
        moved++;
      } catch { /* 单个失败跳过 */ }
    }
  }
  return NextResponse.json({ ok: true, moved, movedFiles, dest: `_重复文件/${stamp}` });
}
