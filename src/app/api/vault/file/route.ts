import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getDb } from "@/lib/db/client";
import { getVaultRoot, resolveVaultPath, readNoteFile, writeNoteFile } from "@/lib/domain/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/vault/file?path=:读取 vault 内 md/txt 笔记内容
export async function GET(req: NextRequest) {
  const db = getDb();
  const vaultRoot = getVaultRoot(db);
  if (!vaultRoot) return NextResponse.json({ error: "请先在设置页配置 Obsidian vault 路径" }, { status: 400 });
  if (!fs.existsSync(vaultRoot)) return NextResponse.json({ error: "vault 目录不存在,请检查设置" }, { status: 400 });

  const rel = req.nextUrl.searchParams.get("path") ?? "";
  try {
    resolveVaultPath(vaultRoot, rel);
  } catch {
    return NextResponse.json({ error: `路径越界:${rel}` }, { status: 403 });
  }
  try {
    const content = readNoteFile(vaultRoot, rel);
    return NextResponse.json({ path: rel, content });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

// PUT /api/vault/file:body {path, content} → 写回(仅 .md/.txt;≤1MB;父目录自动创建)
export async function PUT(req: NextRequest) {
  const db = getDb();
  const vaultRoot = getVaultRoot(db);
  if (!vaultRoot) return NextResponse.json({ error: "请先在设置页配置 Obsidian vault 路径" }, { status: 400 });
  if (!fs.existsSync(vaultRoot)) return NextResponse.json({ error: "vault 目录不存在,请检查设置" }, { status: 400 });

  const raw: unknown = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const rel = typeof body?.path === "string" && body.path ? body.path : null;
  const content = typeof body?.content === "string" ? body.content : null;
  if (!rel || content === null) return NextResponse.json({ error: "path 与 content 必填" }, { status: 400 });

  try {
    resolveVaultPath(vaultRoot, rel);
  } catch {
    return NextResponse.json({ error: `路径越界:${rel}` }, { status: 403 });
  }
  try {
    writeNoteFile(vaultRoot, rel, content);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
