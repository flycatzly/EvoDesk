import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { links } from "@/lib/db/schema";
import { autoCategoryFor, findDuplicateGroups, isJunkCategory, proposeRenames } from "@/lib/domain/link-organize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LinkRow = typeof links.$inferSelect;
const sorted = (rows: LinkRow[]) => [...rows].sort((a, b) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt));

// 目录整理(POST {action, scope?}):
//   preview              → 三类提案(自动分类/归纳合并/重复链接),不改数据
//                          scope="all" 时自动分类面向全库(重新智能分类,划分到规则类目);
//                          缺省仅重排杂物分类(收藏夹/书签栏/已导入等)
//   auto                 → 应用自动分类(scope 同步生效;规则未命中的链接保持原分类)
//   dedupe               → 按 URL/同标题同站 去重,每组保留最早一条
//   rename               → 应用归纳合并 {pairs:[{from,to}]}
export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const action = body && typeof body.action === "string" ? body.action : "";
  const scopeAll = body?.scope === "all";
  const db = await getAnyDb();
  const rows = sorted(db.select().from(links).all() as LinkRow[]);

  const autoTargets = (all: boolean) =>
    rows.filter((l) => (all ? true : isJunkCategory(l.category))).map((l) => {
      const to = autoCategoryFor(l.title, l.url);
      return { id: l.id, title: l.title, url: l.url, from: l.category, to };
    });

  if (action === "preview") {
    const auto = autoTargets(scopeAll)
      .filter((p): p is typeof p & { to: string } => p.to !== null && p.to !== p.from);
    const renames = proposeRenames(rows);
    const duplicateGroups = findDuplicateGroups(rows).map((g) => ({
      key: g.key,
      kind: g.kind,
      links: g.ids.map((id) => {
        const l = rows.find((r) => r.id === id)!;
        return { id: l.id, title: l.title, category: l.category };
      }),
    }));
    return NextResponse.json({ auto, renames, duplicateGroups });
  }

  if (action === "auto") {
    let updated = 0;
    for (const p of autoTargets(scopeAll)) {
      if (p.to && p.to !== p.from) {
        db.update(links).set({ category: p.to }).where(eq(links.id, p.id)).run();
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
