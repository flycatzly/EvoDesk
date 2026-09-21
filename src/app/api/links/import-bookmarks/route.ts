import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import { getAnyDb } from "@/lib/db/data-source";
import { links } from "@/lib/db/schema";
import { parseBookmarksJson, pickCategory } from "@/lib/domain/bookmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 从指定 Bookmarks 文件导入(POST {bookmarksPath, folders?}):按 URL 去重(跳过库内已有),
// 分类 = 直接父目录名;仅导入 folders 里列出的目录(缺省全部)
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const bookmarksPath = body && typeof body.bookmarksPath === "string" ? body.bookmarksPath.trim() : "";
  if (!bookmarksPath || !bookmarksPath.endsWith("Bookmarks") || !fs.existsSync(bookmarksPath)) {
    return NextResponse.json({ error: "bookmarksPath 无效(须指向浏览器 Bookmarks 文件)" }, { status: 400 });
  }
  const folderSet = Array.isArray(body?.folders)
    ? new Set((body.folders as unknown[]).filter((f): f is string => typeof f === "string"))
    : null;

  let items;
  try {
    items = parseBookmarksJson(fs.readFileSync(bookmarksPath, "utf-8"));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Bookmarks 解析失败" }, { status: 400 });
  }
  if (folderSet) items = items.filter((i) => folderSet.has(i.folder));

  const db = await getAnyDb();
  const existingUrls = new Set((db.select().from(links).all() as (typeof links.$inferSelect)[]).map((l) => l.url));
  const nowIso = new Date().toISOString();
  let added = 0;
  let skipped = 0;
  for (const it of items) {
    if (existingUrls.has(it.url)) {
      skipped++;
      continue;
    }
    existingUrls.add(it.url);
    db.insert(links).values({
      id: crypto.randomUUID(),
      title: it.title || it.url,
      url: it.url,
      category: pickCategory(it.folder),
      sort: added,
      createdAt: nowIso,
    }).run();
    added++;
  }
  return NextResponse.json({ ok: true, added, skipped });
}
