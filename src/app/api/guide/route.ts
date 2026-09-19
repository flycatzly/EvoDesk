import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import fs from "node:fs";
import path from "node:path";
import { readSettingsKv } from "@/lib/db/read-settings";
import { expandHome } from "@/lib/domain/skills";
import { scanGuide, readGuideDoc } from "@/lib/domain/guide";
import { isPathWithin } from "@/lib/domain/script-security";


export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 宝典源目录(settings.guide_dirs 数组,白名单)。 */
export function guideDirsFromDb(): string[] {
  const kv = readSettingsKv(getDb());
  const raw = kv.guide_dirs;
  if (!Array.isArray(raw)) return [];
  return raw.filter((d): d is string => typeof d === "string" && d.trim().length > 0).map(expandHome);
}

export function resolveGuideDir(dir: string | null): string | null {
  const list = guideDirsFromDb();
  if (!dir) return list[0] ?? null;
  const abs = expandHome(dir);
  return list.find((w) => path.resolve(w) === path.resolve(abs)) ?? null;
}

// 面试宝典(GET):
//   无 dir 参数 → 返回 {dirs}(源目录列表,供页面下拉)
//   有 dir      → 扫描该源:{root, categories, entries, ...}(cat/folder/q 过滤)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // 源目录列表模式:页面首次加载用
  if (url.searchParams.get("list") === "1") {
    return NextResponse.json({ dirs: guideDirsFromDb() });
  }
  const root = resolveGuideDir(url.searchParams.get("dir"));
  if (!root) return NextResponse.json({ error: "目录不在宝典白名单内:先在下方添加文档源目录" }, { status: 400 });
  if (!fs.existsSync(root)) return NextResponse.json({ error: "目录不存在" }, { status: 400 });

  const cat = url.searchParams.get("cat") ?? "";
  const folder = url.searchParams.get("folder") ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();

  const tree = scanGuide(root);
  let entries = tree.entries;
  if (cat) entries = entries.filter((e) => e.category === cat);
  if (folder) entries = entries.filter((e) => e.folder === folder);
  if (q) {
    entries = entries.filter((e) => {
      if (e.title.toLowerCase().includes(q) || e.headline.toLowerCase().includes(q)) return true;
      // 正文命中(限量扫描防慢)
      try { return readGuideDoc(root, e.relPath).toLowerCase().includes(q); } catch { return false; }
    });
  }
  return NextResponse.json({ root, categories: tree.categories, total: tree.entries.length, truncated: tree.truncated, entries });
}

// 单篇全文(GET ?dir=&path=)
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const root = resolveGuideDir(body && typeof body.dir === "string" ? body.dir : null);
  if (!root) return NextResponse.json({ error: "目录不在宝典白名单内" }, { status: 400 });
  const relPath = body && typeof body.path === "string" ? body.path : "";
  try {
    return NextResponse.json({ path: relPath, content: readGuideDoc(root, relPath) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "读取失败" }, { status: 400 });
  }
}

// 保存编辑(PUT {dir, path, content}):写回源目录原文件(白名单 + 原子写,覆盖前备份 .bak)
export async function PUT(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const root = resolveGuideDir(body && typeof body.dir === "string" ? body.dir : null);
  if (!root) return NextResponse.json({ error: "目录不在宝典白名单内" }, { status: 400 });
  const relPath = body && typeof body.path === "string" ? body.path : "";
  const content = body && typeof body.content === "string" ? body.content : null;
  if (content === null) return NextResponse.json({ error: "content 必填" }, { status: 400 });
  if (content.length > 1_048_576) return NextResponse.json({ error: "内容超过 1MB 上限" }, { status: 400 });
  const abs = path.resolve(root, relPath);
  if (!isPathWithin(abs, root)) return NextResponse.json({ error: `路径越界:${relPath}` }, { status: 403 });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return NextResponse.json({ error: `文件不存在:${relPath}` }, { status: 404 });
  // 备份原文件为 .bak(同目录,便于找回)
  fs.copyFileSync(abs, `${abs}.bak`);
  const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, content, "utf8");
  try {
    fs.renameSync(tmp, abs);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* 清理失败忽略 */ }
    return NextResponse.json({ error: e instanceof Error ? e.message : "写入失败" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, backup: `${relPath}.bak` });
}
