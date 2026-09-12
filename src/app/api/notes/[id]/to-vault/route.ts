import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { notes } from "@/lib/db/schema";
import { buildVaultPath, noteToMarkdown } from "@/lib/domain/notes";
import { getVaultRoot } from "@/lib/domain/vault";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOTE_SUB_DIR = "02_笔记";

// 笔记存入 Obsidian:固定落 <vault>/02_笔记/ 下(子目录不存在则递归创建——路径由固定常量拼出,天然仅限 vault 根内);
// 同名文件不覆盖(400 提示),写入成功后回写 notes.vaultPath。
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const note = db.select().from(notes).where(eq(notes.id, id)).all()[0];
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  // getVaultRoot 对缺失/非法 JSON/空白/非字符串一律返回 null(同原私有 readVaultPath 语义),null 或目录不存在 → 400
  const vault = getVaultRoot(db);
  if (!vault || !fs.existsSync(vault)) {
    return NextResponse.json({ error: "请先在设置页配置有效的 Obsidian vault 路径" }, { status: 400 });
  }

  const dir = path.join(vault, NOTE_SUB_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const target = buildVaultPath(vault, NOTE_SUB_DIR, note.title);
  if (fs.existsSync(target)) {
    return NextResponse.json({ error: `vault 中已存在同名文件:${path.basename(target)}` }, { status: 400 });
  }
  fs.writeFileSync(target, noteToMarkdown(note), "utf8");

  const nowIso = new Date().toISOString();
  db.update(notes).set({ vaultPath: target, updatedAt: nowIso }).where(eq(notes.id, id)).run();
  const updated = db.select().from(notes).where(eq(notes.id, id)).all()[0];
  return NextResponse.json({ note: updated, vaultPath: target });
}
