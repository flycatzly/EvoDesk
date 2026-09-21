import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getAnyDb } from "@/lib/db/data-source";
import { q } from "@/lib/db/q";
import { canvases } from "@/lib/db/schema";
import { layoutSchema, parseLayout, deepCopyLayout, type CanvasLayout } from "@/lib/domain/canvas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const withTemplates = new URL(req.url).searchParams.get("with_templates") === "1";
  type CanvasRow = typeof canvases.$inferSelect;
  const db = await getAnyDb();
  const rows = await q.all<CanvasRow>(db.select().from(canvases));
  const filtered = rows.filter((c) => withTemplates || !c.isTemplate);
  const sorted = [...filtered].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return NextResponse.json({ canvases: sorted });
}

export async function POST(req: NextRequest) {
  type CanvasRow = typeof canvases.$inferSelect;
  const raw = await req.json().catch(() => null);
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const nowIso = new Date().toISOString();
  const name = body && typeof body.name === "string" && body.name.trim() ? body.name.trim() : "新工作台";

  let layout: CanvasLayout = [];
  // from_template:深拷贝模板画布的 layout 并重写组件 id
  if (body && typeof body.from_template === "string" && body.from_template) {
    const postDb = await getAnyDb();
    const tpl = await q.one<CanvasRow>(postDb.select().from(canvases).where(eq(canvases.id, body.from_template)));
    if (!tpl || !tpl.isTemplate) return NextResponse.json({ error: "模板不存在" }, { status: 404 });
    layout = deepCopyLayout(parseLayout(tpl.layout));
  } else if (body && "layout" in body) {
    const parsed = layoutSchema.safeParse(body.layout);
    if (!parsed.success) return NextResponse.json({ error: "layout 结构非法" }, { status: 400 });
    layout = parsed.data;
  }

  const canvas = {
    id: crypto.randomUUID(),
    name,
    columns: body?.columns === "3" ? "3" : "2",
    locked: false,
    layout: JSON.stringify(layout),
    isTemplate: false,
    shareToken: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  await q.run((await getAnyDb()).insert(canvases).values(canvas));
  const created = await q.one((await getAnyDb()).select().from(canvases).where(eq(canvases.id, canvas.id)));
  return NextResponse.json({ canvas: created }, { status: 201 });
}
