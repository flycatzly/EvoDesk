import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveOrganizeDir, assertWithin, scanDir } from "../scan/route";
import { planClassification, dedupeTargetName, PROTECTED_DIRS } from "@/lib/domain/file-organize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 移动文件;目标重名自动加序号;返回新相对路径 */
function moveFile(root: string, fromRel: string, toDirName: string): string {
  const from = assertWithin(root, fromRel);
  const destDir = assertWithin(root, toDirName);
  fs.mkdirSync(destDir, { recursive: true });
  const finalName = dedupeTargetName(fs.readdirSync(destDir), fromRel.split("/").pop()!);
  fs.renameSync(from, path.join(destDir, finalName));
  return `${toDirName}/${finalName}`;
}

// POST /api/files/classify {dir, apply?}:把根目录散文件按类型移动到 <dir>/<分类>/(默认仅预览)
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const root = await resolveOrganizeDir(body && typeof body.dir === "string" ? body.dir : null);
  if (!root) return NextResponse.json({ error: "目录不在整理白名单内" }, { status: 400 });
  const apply = body?.apply === true;

  const names = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, isFile: true }));
  const plan = planClassification(names);

  if (!apply) {
    return NextResponse.json({ planned: plan.length, plan });
  }
  let applied = 0;
  const moved: { from: string; to: string }[] = [];
  for (const p of plan) {
    if (PROTECTED_DIRS.includes(p.toDir)) continue;
    try {
      const to = moveFile(root, p.from, p.toDir);
      moved.push({ from: p.from, to });
      applied++;
    } catch { /* 单个失败跳过,不中断整批 */ }
  }
  const { stats } = scanDir(root, false);
  return NextResponse.json({ ok: true, applied, moved, stats });
}
