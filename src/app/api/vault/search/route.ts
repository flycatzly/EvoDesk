import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getDb } from "@/lib/db/client";
import { getVaultRoot, searchNotes } from "@/lib/domain/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vault/search?q=:递归搜索 vault 内全部 md,返回前 50 个 {path, snippet}
export async function GET(req: NextRequest) {
  const db = getDb();
  const vaultRoot = getVaultRoot(db);
  if (!vaultRoot) return NextResponse.json({ error: "请先在设置页配置 Obsidian vault 路径" }, { status: 400 });
  if (!fs.existsSync(vaultRoot)) return NextResponse.json({ error: "vault 目录不存在,请检查设置" }, { status: 400 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (!q) return NextResponse.json({ error: "q 必填" }, { status: 400 });
  return NextResponse.json({ hits: searchNotes(vaultRoot, q) });
}
