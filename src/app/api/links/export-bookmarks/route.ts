import { getDb } from "@/lib/db/client";
import { links } from "@/lib/db/schema";
import { toNetscapeHtml } from "@/lib/domain/bookmarks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 导出常用链接为 Netscape 书签 HTML(Chrome/Edge「导入收藏夹」可直接识别)
export async function GET() {
  const rows = getDb().select().from(links).all() as (typeof links.$inferSelect)[];
  const sorted = [...rows].sort((a, b) => a.category.localeCompare(b.category) || a.sort - b.sort);
  const html = toNetscapeHtml(sorted.map((l) => ({ title: l.title, url: l.url, folder: l.category })));
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": 'attachment; filename="evodesk-bookmarks.html"',
    },
  });
}
