import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/client";
import { links } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 导出按目录分组的链接数据(JSON 附件),与书签 HTML 导出互补
export async function GET() {
  const rows = getDb().select().from(links).all() as (typeof links.$inferSelect)[];
  const sorted = [...rows].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));
  const byCat = new Map<string, { title: string; url: string; sort: number }[]>();
  for (const l of sorted) {
    const list = byCat.get(l.category) ?? [];
    list.push({ title: l.title, url: l.url, sort: l.sort });
    byCat.set(l.category, list);
  }
  const file = {
    exportedAt: new Date().toISOString(),
    total: rows.length,
    groups: [...byCat.entries()].map(([category, ls]) => ({ category, count: ls.length, links: ls })),
  };
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="evodesk-links-${ts}.json"`,
    },
  });
}
