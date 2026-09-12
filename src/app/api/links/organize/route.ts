import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { links } from "@/lib/db/schema";
import { autoCategoryFor, findDuplicateGroups, isJunkCategory, proposeRenames } from "@/lib/domain/link-organize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkRow = typeof links.$inferSelect;
const sorted = (rows: LinkRow[]) => [...rows].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));

// 目录整理(POST {action}):
//   preview     → 三类提案(自动分类/归纳合并/重复链接),不改数据
//   auto        → 应用自动分类(仅杂物分类下的链接,规则命中才动)
//   dedupe      → 按 URL 去重,每组保留最早一条
//   rename      → 应用归纳合并 {pairs:[{from,to}]}
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const action = body && typeof body.action === "string" ? body.action : "";
  const db = getDb();
  const rows = sorted(db.select().from(links).all() as LinkRow[]);

  if (action === "preview") {
    const auto = rows
      .filter((l) => isJunkCategory(l.category))
      .map((l) => ({ id: l.id, title: l.title, url: l.url, from: l.category, to: autoCategoryFor(l.title, l.url) }))
      .filter((p): p is typeof p & { to: string } => p.to !== null && p.to !== p.from);
    const renames = proposeRenames(rows);
    const duplicateGroups = findDuplicateGroups(rows).map((g) => ({
      key: g.key,
      links: g.ids.map((id) => {
        const l = rows.find((r) => r.id === id)!;
        return { id: l.id, title: l.title, category: l.category };
      }),
    }));
    return NextResponse.json({ auto, renames, duplicateGroups });
  }

  if (action === "auto") {
    let updated = 0;
    for (const l of rows) {
      if (!isJunkCategory(l.category)) continue;
      const to = autoCategoryFor(l.title, l.url);
      if (to && to !== l.category) {
        db.update(links).set({ category: to }).where(eq(links.id, l.id)).run();
        updated++;
      }
    }
    return NextResponse.json({ ok: true, updated });
  }

  if (action === "dedupe") {
    const removeIds = findDuplicateGroups(rows).flatMap((g) => g.ids.slice(1));
    if (removeIds.length > 0) db.delete(links).where(inArray(links.id, removeIds)).run();
    return NextResponse.json({ ok: true, removed: removeIds.length });
  }

  if (action === "rename") {
    const pairs = Array.isArray(body?.pairs) ? body.pairs : null;
    if (!pairs) return NextResponse.json({ error: "pairs 必填" }, { status: 400 });
    let updated = 0;
    for (const p of pairs) {
      const o = p as Record<string, unknown>;
      if (typeof o.from !== "string" || typeof o.to !== "string" || !o.from.trim() || !o.to.trim()) continue;
      const r = db.update(links).set({ category: o.to.trim() }).where(eq(links.category, o.from.trim())).run();
      updated += r.changes;
    }
    return NextResponse.json({ ok: true, updated });
  }

  return NextResponse.json({ error: "未知 action(preview|auto|dedupe|rename)" }, { status: 400 });
}
