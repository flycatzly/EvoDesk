import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getDb } from "@/lib/db/client";
import { getVaultRoot, resolveVaultPath, listTree } from "@/lib/domain/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vault/tree?path=(相对路径,空=根):目录/md/文件列表(dir 前,md 标注)
export async function GET(req: NextRequest) {
  const db = getDb();
  const vaultRoot = getVaultRoot(db);
  if (!vaultRoot) return NextResponse.json({ error: "请先在设置页配置 Obsidian vault 路径" }, { status: 400 });
  if (!fs.existsSync(vaultRoot)) return NextResponse.json({ error: "vault 目录不存在,请检查设置" }, { status: 400 });

  // searchParams.get 已做 URL 解码
  const rel = req.nextUrl.searchParams.get("path") ?? "";
  try {
    resolveVaultPath(vaultRoot, rel);
  } catch {
    return NextResponse.json({ error: `路径越界:${rel}` }, { status: 403 });
  }
  return NextResponse.json({ entries: listTree(vaultRoot, rel) });
}
